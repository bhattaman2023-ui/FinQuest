"""Fetch configured Yahoo Finance OHLCV history and upsert it into PostgreSQL.

This is a manual data-ingestion command, separate from model training. It never
creates synthetic data and commits no rows unless every configured ticker has
downloaded and passed validation.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Callable, Iterable
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yaml

from db_config import DatabaseConfigurationError, get_database_url, validate_database_url


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = SCRIPT_DIR / "config.yaml"
YAHOO_SOURCE = "YFINANCE_NS"
SYNTHETIC_SOURCE = "SYNTHETIC_SAMPLE"
REQUIRED_PRICE_COLUMNS = ("Open", "High", "Low", "Close", "Volume")
PRICE_QUANTUM = Decimal("0.01")
LOG = logging.getLogger("finquest.ingest")
_POSTGRES_URL_PATTERN = re.compile(r"(?:postgres(?:ql)?://)\S+", re.IGNORECASE)

UPSERT_SQL = """
INSERT INTO historical_prices
    (symbol, trade_date, open, high, low, close, volume, data_source,
     price_adjustment)
VALUES %s
ON CONFLICT (symbol, trade_date) DO UPDATE SET
    open = EXCLUDED.open,
    high = EXCLUDED.high,
    low = EXCLUDED.low,
    close = EXCLUDED.close,
    volume = EXCLUDED.volume,
    data_source = EXCLUDED.data_source,
    price_adjustment = EXCLUDED.price_adjustment,
    ingested_at = NOW()
WHERE historical_prices.data_source IN ('SYNTHETIC_SAMPLE', 'YFINANCE_NS')
  AND (historical_prices.data_source = 'SYNTHETIC_SAMPLE'
       OR historical_prices.price_adjustment = EXCLUDED.price_adjustment)
RETURNING symbol, trade_date
""".strip()


class IngestionError(RuntimeError):
    """Raised for failed downloads, invalid rows, or unsafe database conflicts."""


def _database_error_message(exc: Exception, *, stage: str) -> str:
    """Expose useful PostgreSQL diagnostics without leaking connection strings."""
    diag = getattr(exc, "diag", None)
    primary = getattr(diag, "message_primary", None)
    detail = primary or str(exc) or type(exc).__name__
    detail = _POSTGRES_URL_PATTERN.sub("[database URL redacted]", detail)
    detail = " ".join(detail.split())[:1000]
    sqlstate = getattr(exc, "pgcode", None)
    code = f" SQLSTATE {sqlstate}" if sqlstate else ""
    return f"PostgreSQL {stage} failed ({type(exc).__name__}{code}): {detail}"


@dataclass(frozen=True)
class PriceBar:
    symbol: str
    trade_date: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int


def load_config(path: str | Path = DEFAULT_CONFIG_PATH) -> dict:
    with Path(path).open(encoding="utf-8") as config_file:
        config = yaml.safe_load(config_file)
    if not isinstance(config, dict):
        raise IngestionError("Configuration must be a YAML mapping")
    return config


def adjustment_mode(config: dict) -> str:
    """Normalize the existing training adjustment setting for storage."""
    value = config.get("data", {}).get("adjustment", "auto")
    if value is True:
        return "auto"
    if value is False:
        return "raw"
    value = str(value).strip().lower()
    if value not in {"auto", "raw"}:
        raise IngestionError("data.adjustment must be 'auto' or 'raw'")
    return value


def _as_date(value, field_name: str) -> date:
    try:
        result = pd.Timestamp(value)
    except Exception as exc:
        raise IngestionError(f"Invalid {field_name}: {value!r}") from exc
    if pd.isna(result):
        raise IngestionError(f"Invalid {field_name}: {value!r}")
    return result.date()


def default_exclusive_end_date(now: datetime | None = None) -> date:
    """Yahoo's end date is exclusive; include the current NSE date by default."""
    local_now = now or datetime.now(ZoneInfo("Asia/Kolkata"))
    if local_now.tzinfo is None:
        local_now = local_now.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
    return local_now.astimezone(ZoneInfo("Asia/Kolkata")).date() + timedelta(days=1)


def resolve_exclusive_end_date(config: dict, override: str | date | None = None) -> date:
    configured = override
    if configured is None:
        configured = config.get("ingestion", {}).get("end_date_exclusive")
    if configured is None:
        return default_exclusive_end_date()
    return _as_date(configured, "ingestion.end_date_exclusive")


def validate_history(
    history: pd.DataFrame,
    *,
    symbol: str,
    start_date: date,
    end_date_exclusive: date,
) -> list[PriceBar]:
    """Validate and normalize one ticker's daily Yahoo response."""
    if not isinstance(history, pd.DataFrame) or history.empty:
        raise IngestionError(f"Yahoo Finance returned no rows for {symbol}")

    frame = history.copy()
    if isinstance(frame.index, pd.DatetimeIndex):
        frame = frame.reset_index()
    date_column = next((name for name in ("Date", "Datetime") if name in frame.columns), None)
    if date_column is None:
        raise IngestionError(f"Yahoo Finance response for {symbol} has no date column/index")
    missing_columns = [column for column in REQUIRED_PRICE_COLUMNS if column not in frame.columns]
    if missing_columns:
        raise IngestionError(f"Yahoo Finance response for {symbol} is missing columns: {missing_columns}")

    parsed_dates: list[date] = []
    for value in frame[date_column]:
        try:
            timestamp = pd.Timestamp(value)
        except Exception as exc:
            raise IngestionError(f"Invalid date in Yahoo Finance response for {symbol}") from exc
        if pd.isna(timestamp):
            raise IngestionError(f"Missing date in Yahoo Finance response for {symbol}")
        parsed_dates.append(timestamp.date())

    duplicate_dates = pd.Series(parsed_dates).duplicated(keep=False)
    if duplicate_dates.any():
        duplicates = sorted({str(day) for day, duplicate in zip(parsed_dates, duplicate_dates) if duplicate})
        raise IngestionError(f"Duplicate Yahoo Finance dates for {symbol}: {duplicates[:5]}")
    out_of_range = [day for day in parsed_dates if day < start_date or day >= end_date_exclusive]
    if out_of_range:
        raise IngestionError(
            f"Yahoo Finance returned dates outside [{start_date}, {end_date_exclusive}) for {symbol}"
        )

    numeric = {}
    for column in REQUIRED_PRICE_COLUMNS:
        values = pd.to_numeric(frame[column], errors="coerce").to_numpy(dtype=float)
        if pd.isna(values).any() or not np.isfinite(values).all():
            raise IngestionError(f"Missing or non-finite {column} values for {symbol}")
        numeric[column] = values

    bars = []
    for index, trade_date in enumerate(parsed_dates):
        try:
            prices = {
                name.lower(): Decimal(str(numeric[name][index])).quantize(
                    PRICE_QUANTUM, rounding=ROUND_HALF_UP
                )
                for name in ("Open", "High", "Low", "Close")
            }
        except (InvalidOperation, ValueError) as exc:
            raise IngestionError(f"Invalid OHLC price for {symbol} on {trade_date}") from exc
        try:
            volume_decimal = Decimal(str(frame["Volume"].iloc[index]))
        except (InvalidOperation, ValueError) as exc:
            raise IngestionError(f"Invalid Volume for {symbol} on {trade_date}") from exc
        if (
            not volume_decimal.is_finite()
            or volume_decimal < 0
            or volume_decimal != volume_decimal.to_integral_value()
            or volume_decimal > Decimal(np.iinfo(np.int64).max)
        ):
            raise IngestionError(
                f"Volume must fit a non-negative PostgreSQL BIGINT for {symbol} on {trade_date}"
            )
        if any(price <= 0 or price >= Decimal("1000000000000") for price in prices.values()):
            raise IngestionError(f"OHLC prices are outside the supported range for {symbol} on {trade_date}")
        if prices["high"] < max(prices["open"], prices["low"], prices["close"]):
            raise IngestionError(f"High is below another OHLC value for {symbol} on {trade_date}")
        if prices["low"] > min(prices["open"], prices["high"], prices["close"]):
            raise IngestionError(f"Low is above another OHLC value for {symbol} on {trade_date}")
        bars.append(PriceBar(
            symbol=symbol,
            trade_date=trade_date,
            open=prices["open"],
            high=prices["high"],
            low=prices["low"],
            close=prices["close"],
            volume=int(volume_decimal),
        ))
    if not bars:
        raise IngestionError(f"No valid Yahoo Finance rows for {symbol}")
    return bars


def _yahoo_error_message(symbol: str, exc: Exception) -> str:
    detail = f"{type(exc).__name__}: {exc}"
    lowered = detail.lower()
    if "429" in detail or "too many requests" in lowered or "rate limit" in lowered:
        return f"Yahoo Finance rate-limited {symbol} (HTTP 429); ingestion stopped without retry. Details: {detail}"
    if isinstance(exc, json.JSONDecodeError):
        return f"Yahoo Finance returned invalid JSON for {symbol}; ingestion stopped. Details: {detail}"
    return f"Yahoo Finance request failed for {symbol}; ingestion stopped. Details: {detail}"


def download_all_symbols(
    *,
    config: dict,
    start_dates: dict[str, date],
    end_date_exclusive: date,
    ticker_factory: Callable | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, list[PriceBar]]:
    """Download and validate every configured ticker before any database write."""
    data_config = config.get("data", {})
    if data_config.get("source") != "yfinance":
        raise IngestionError("Ingestion requires data.source='yfinance'; synthetic ingestion is not supported")
    symbols = config.get("symbols")
    if not isinstance(symbols, list) or not symbols or len(set(symbols)) != len(symbols):
        raise IngestionError("symbols must be a non-empty list without duplicates")
    delay = float(data_config.get("request_delay_seconds", 1.0))
    if not math.isfinite(delay) or delay < 0:
        raise IngestionError("data.request_delay_seconds must be a finite non-negative number")
    mode = adjustment_mode(config)
    if ticker_factory is None:
        import yfinance as yf

        yf.config.debug.hide_exceptions = False
        ticker_factory = yf.Ticker

    downloaded: dict[str, list[PriceBar]] = {}
    for index, configured_symbol in enumerate(symbols):
        symbol = str(configured_symbol).upper().removesuffix(".NS")
        start = start_dates[symbol]
        if start >= end_date_exclusive:
            raise IngestionError(f"Start date {start} is not before end date {end_date_exclusive} for {symbol}")
        LOG.info("Downloading %s from %s through %s (end exclusive)", symbol, start, end_date_exclusive)
        try:
            history = ticker_factory(configured_symbol).history(
                start=start.isoformat(),
                end=end_date_exclusive.isoformat(),
                auto_adjust=(mode == "auto"),
                raise_errors=True,
            )
        except Exception as exc:
            raise IngestionError(_yahoo_error_message(configured_symbol, exc)) from exc
        downloaded[symbol] = validate_history(
            history,
            symbol=symbol,
            start_date=start,
            end_date_exclusive=end_date_exclusive,
        )
        if delay and index < len(symbols) - 1:
            sleep_fn(delay)
    return downloaded


def _load_incremental_start_dates(
    connection,
    *,
    symbols: Iterable[str],
    bootstrap_start: date,
    adjustment: str,
    overlap_calendar_days: int,
) -> dict[str, date]:
    starts = {}
    with connection.cursor() as cursor:
        for symbol in symbols:
            cursor.execute(
                "SELECT DISTINCT price_adjustment FROM historical_prices "
                "WHERE symbol = %s AND data_source = %s",
                (symbol, YAHOO_SOURCE),
            )
            existing_modes = {row[0] for row in cursor.fetchall()}
            if existing_modes and existing_modes != {adjustment}:
                raise IngestionError(
                    f"Existing Yahoo rows for {symbol} use adjustment mode {sorted(existing_modes)}; "
                    f"configured mode is {adjustment}. Rebuild the series before mixing modes."
                )
            cursor.execute(
                "SELECT MAX(trade_date) FROM historical_prices "
                "WHERE symbol = %s AND data_source = %s AND price_adjustment = %s",
                (symbol, YAHOO_SOURCE, adjustment),
            )
            latest = cursor.fetchone()[0]
            start = bootstrap_start if latest is None else max(
                bootstrap_start, latest - timedelta(days=overlap_calendar_days)
            )
            starts[symbol] = start
    return starts


def upsert_real_prices(connection, records: Iterable[PriceBar], adjustment: str) -> int:
    """Upsert Yahoo-only rows; reject conflicts from other authoritative sources."""
    from psycopg2.extras import execute_values

    records = list(records)
    if not records:
        raise IngestionError("Refusing to upsert an empty price batch")
    values = [
        (bar.symbol, bar.trade_date, bar.open, bar.high, bar.low, bar.close,
         bar.volume, YAHOO_SOURCE, adjustment)
        for bar in records
    ]
    with connection.cursor() as cursor:
        returned = execute_values(
            cursor, UPSERT_SQL, values, page_size=1000, fetch=True
        )
    if len(returned) != len(records):
        raise IngestionError(
            "Some price rows conflicted with a non-Yahoo source or a different adjustment mode; "
            "the complete transaction must be rolled back."
        )
    return len(returned)


def run_ingestion(
    *,
    config: dict,
    database_url: str | None = None,
    end_date_override: str | date | None = None,
    full_history: bool = False,
    dry_run: bool = False,
    ticker_factory: Callable | None = None,
    connect_factory: Callable | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict:
    """Fetch all tickers, then atomically upsert the validated batch."""
    if config.get("data", {}).get("source") != "yfinance":
        raise IngestionError("Ingestion requires data.source='yfinance'; no synthetic fallback is available")
    if database_url is None:
        try:
            database_url = get_database_url()
        except DatabaseConfigurationError as exc:
            raise IngestionError(str(exc)) from exc
    else:
        try:
            database_url = validate_database_url(database_url)
        except DatabaseConfigurationError as exc:
            raise IngestionError(str(exc)) from exc

    stage = "initialization"
    try:
        if connect_factory is None:
            import psycopg2

            connect_factory = psycopg2.connect
        data_config = config["data"]
        symbols = [str(value).upper().removesuffix(".NS") for value in config["symbols"]]
        bootstrap_start = _as_date(data_config["start_date"], "data.start_date")
        settings = config.get("ingestion", {})
        overlap = int(settings.get("overlap_calendar_days", 7))
        if overlap < 0:
            raise IngestionError("ingestion.overlap_calendar_days must be non-negative")
        adjustment = adjustment_mode(config)
        end_date = resolve_exclusive_end_date(config, end_date_override)
        if bootstrap_start >= end_date:
            raise IngestionError("Configured start date must be before the exclusive end date")

        stage = "checking existing Yahoo Finance rows"
        read_connection = connect_factory(database_url)
        try:
            with read_connection:
                start_dates = _load_incremental_start_dates(
                    read_connection,
                    symbols=symbols,
                    bootstrap_start=bootstrap_start,
                    adjustment=adjustment,
                    overlap_calendar_days=overlap,
                )
                if full_history:
                    start_dates = {symbol: bootstrap_start for symbol in symbols}
        finally:
            read_connection.close()

        stage = "downloading and validating Yahoo Finance rows"
        downloaded = download_all_symbols(
            config=config,
            start_dates=start_dates,
            end_date_exclusive=end_date,
            ticker_factory=ticker_factory,
            sleep_fn=sleep_fn,
        )
        flattened = [bar for symbol in symbols for bar in downloaded[symbol]]
        counts = {symbol: len(downloaded[symbol]) for symbol in symbols}
        if dry_run:
            LOG.info("Dry run: validated %d Yahoo rows; no price rows were written", len(flattened))
            return {"rows_validated": len(flattened), "rows_upserted": 0, "rows_by_symbol": counts}

        stage = f"upserting {len(flattened)} validated rows"
        write_connection = connect_factory(database_url)
        try:
            with write_connection:
                applied = upsert_real_prices(write_connection, flattened, adjustment)
        finally:
            write_connection.close()
        LOG.info("Committed %d Yahoo rows for %d configured symbols", applied, len(symbols))
        return {"rows_validated": len(flattened), "rows_upserted": applied, "rows_by_symbol": counts}
    except IngestionError:
        raise
    except Exception as exc:
        raise IngestionError(
            f"{_database_error_message(exc, stage=stage)}; no synthetic fallback was attempted"
        ) from exc


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="YAML configuration path")
    parser.add_argument("--end-date", help="Override the exclusive Yahoo end date (YYYY-MM-DD)")
    parser.add_argument("--full-history", action="store_true", help="Fetch from data.start_date instead of the last real row")
    parser.add_argument("--dry-run", action="store_true", help="Download and validate without writing rows")
    args = parser.parse_args(argv)
    try:
        result = run_ingestion(
            config=load_config(args.config),
            end_date_override=args.end_date,
            full_history=args.full_history,
            dry_run=args.dry_run,
        )
    except IngestionError as exc:
        LOG.error("%s", exc)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
