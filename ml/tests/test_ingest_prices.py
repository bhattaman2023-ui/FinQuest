from datetime import date
from decimal import Decimal
import os
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ML_DIR = Path(__file__).resolve().parents[1]
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

import ingest_prices as ingestion


def history_frame(index=None, **overrides):
    frame = pd.DataFrame({
        "Open": [10.0, 11.0], "High": [12.0, 13.0], "Low": [9.0, 10.0],
        "Close": [11.0, 12.0], "Volume": [100, 200],
    }, index=index if index is not None else pd.DatetimeIndex(["2024-01-02", "2024-01-03"], name="Date"))
    for column, values in overrides.items():
        frame[column] = values
    return frame


def test_validation_normalizes_valid_ohlcv_and_checks_date_range():
    bars = ingestion.validate_history(
        history_frame(), symbol="AAA", start_date=date(2024, 1, 1),
        end_date_exclusive=date(2024, 2, 1),
    )
    assert len(bars) == 2
    assert bars[0].symbol == "AAA"
    assert bars[0].trade_date == date(2024, 1, 2)
    assert str(bars[0].close) == "11.00"
    assert bars[0].volume == 100


@pytest.mark.parametrize("frame, message", [
    (pd.DataFrame(), "no rows"),
    (history_frame().assign(Volume=[100, np.nan]), "Missing or non-finite Volume"),
    (history_frame().assign(Volume=[-1, 200]), "non-negative PostgreSQL BIGINT"),
    (history_frame().assign(Volume=[2**63, 200]), "PostgreSQL BIGINT"),
    (history_frame().assign(High=[8, 13]), "High is below"),
    (history_frame().assign(Close=[11, np.inf]), "Missing or non-finite Close"),
])
def test_validation_rejects_empty_or_invalid_data(frame, message):
    with pytest.raises(ingestion.IngestionError, match=message):
        ingestion.validate_history(
            frame, symbol="AAA", start_date=date(2024, 1, 1),
            end_date_exclusive=date(2024, 2, 1),
        )


def test_validation_rejects_duplicate_and_out_of_range_dates():
    duplicate = history_frame(index=pd.DatetimeIndex(["2024-01-02", "2024-01-02"], name="Date"))
    with pytest.raises(ingestion.IngestionError, match="Duplicate"):
        ingestion.validate_history(duplicate, symbol="AAA", start_date=date(2024, 1, 1), end_date_exclusive=date(2024, 2, 1))
    with pytest.raises(ingestion.IngestionError, match="outside"):
        ingestion.validate_history(history_frame(), symbol="AAA", start_date=date(2024, 1, 3), end_date_exclusive=date(2024, 2, 1))


def test_download_uses_configured_dates_adjustment_and_pacing():
    requests, delays = [], []

    class Ticker:
        def __init__(self, symbol):
            self.symbol = symbol

        def history(self, **kwargs):
            requests.append((self.symbol, kwargs))
            return history_frame(index=pd.DatetimeIndex(["2024-01-02", "2024-01-03"], name="Date"))

    config = {
        "symbols": ["AAA.NS", "BBB.NS"],
        "data": {"source": "yfinance", "adjustment": "auto", "request_delay_seconds": 0.2},
    }
    downloaded = ingestion.download_all_symbols(
        config=config, start_dates={"AAA": date(2024, 1, 1), "BBB": date(2024, 1, 1)},
        end_date_exclusive=date(2024, 2, 1), ticker_factory=Ticker, sleep_fn=delays.append,
    )
    assert set(downloaded) == {"AAA", "BBB"}
    assert requests[0][1] == {
        "start": "2024-01-01", "end": "2024-02-01", "auto_adjust": True, "raise_errors": True,
    }
    assert delays == [0.2]


def test_download_error_stops_without_synthetic_fallback():
    calls = []

    class BrokenTicker:
        def __init__(self, symbol):
            self.symbol = symbol

        def history(self, **kwargs):
            calls.append(self.symbol)
            raise RuntimeError("HTTP 429 Too Many Requests")

    with pytest.raises(ingestion.IngestionError, match="rate-limited.*HTTP 429"):
        ingestion.download_all_symbols(
            config={"symbols": ["AAA.NS", "BBB.NS"], "data": {"source": "yfinance", "request_delay_seconds": 0}},
            start_dates={"AAA": date(2024, 1, 1), "BBB": date(2024, 1, 1)},
            end_date_exclusive=date(2024, 2, 1), ticker_factory=BrokenTicker,
        )
    assert calls == ["AAA.NS"]


def test_null_ingestion_end_date_tracks_current_nse_calendar(monkeypatch):
    monkeypatch.setattr(ingestion, "default_exclusive_end_date", lambda: date(2030, 1, 2))
    assert ingestion.resolve_exclusive_end_date({"data": {"end_date": "2024-12-31"}}) == date(2030, 1, 2)
    assert ingestion.resolve_exclusive_end_date({}, "2030-01-05") == date(2030, 1, 5)


def test_synthetic_source_is_rejected():
    with pytest.raises(ingestion.IngestionError, match="synthetic ingestion is not supported"):
        ingestion.download_all_symbols(
            config={"symbols": ["AAA.NS"], "data": {"source": "synthetic"}},
            start_dates={"AAA": date(2024, 1, 1)}, end_date_exclusive=date(2024, 2, 1),
            ticker_factory=lambda _: None,
        )


def test_yahoo_source_tag_and_conflict_policy_are_explicit_in_upsert():
    assert "YFINANCE_NS" in ingestion.UPSERT_SQL
    assert "SYNTHETIC_SAMPLE" in ingestion.UPSERT_SQL
    assert "historical_prices.data_source = 'SYNTHETIC_SAMPLE'" in ingestion.UPSERT_SQL
    assert "price_adjustment = EXCLUDED.price_adjustment" in ingestion.UPSERT_SQL


def test_upsert_target_columns_match_execute_values_tuple_width(monkeypatch):
    import psycopg2.extras

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    captured = {}

    def fake_execute_values(cursor, sql, values, **kwargs):
        captured.update(sql=sql, values=values, kwargs=kwargs)
        return [("AAA", date(2024, 1, 2))]

    monkeypatch.setattr(psycopg2.extras, "execute_values", fake_execute_values)
    bar = ingestion.PriceBar(
        "AAA", date(2024, 1, 2), Decimal("10.00"), Decimal("12.00"),
        Decimal("9.00"), Decimal("11.00"), 100,
    )

    assert ingestion.upsert_real_prices(type("Connection", (), {"cursor": lambda _self: Cursor()})(), [bar], "auto") == 1

    column_match = re.search(
        r"INSERT\s+INTO\s+historical_prices\s*\(([^)]+)\)\s*VALUES\s+%s",
        captured["sql"],
        flags=re.IGNORECASE | re.DOTALL,
    )
    assert column_match is not None
    target_columns = [column.strip() for column in column_match.group(1).split(",")]
    assert len(target_columns) == len(captured["values"][0]) == 9
    assert "ingested_at" not in target_columns  # PostgreSQL supplies its NOW() default.
    assert captured["values"][0][-2:] == (ingestion.YAHOO_SOURCE, "auto")


def test_postgres_error_diagnostic_is_useful_and_redacts_connection_urls():
    class FakeDatabaseError(Exception):
        pgcode = "42601"
        diag = type("Diagnostic", (), {"message_primary": "syntax error at or near VALUES"})()

    message = ingestion._database_error_message(
        FakeDatabaseError("postgresql://user:secret@host/db"),
        stage="upserting 42 validated rows",
    )
    assert "PostgreSQL upserting 42 validated rows failed" in message
    assert "FakeDatabaseError" in message
    assert "SQLSTATE 42601" in message
    assert "syntax error at or near VALUES" in message
    assert "secret" not in message


def test_write_failure_rolls_back_and_reports_database_context(monkeypatch):
    states = []

    class Cursor:
        def execute(self, _sql, _params):
            pass

        def fetchall(self):
            return []

        def fetchone(self):
            return (None,)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Connection:
        def __init__(self):
            self.write = len(states) == 1

        def cursor(self):
            return Cursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, _exc, _tb):
            states.append("rollback" if exc_type else "commit")
            return False

        def close(self):
            pass

    def connect_factory(_url):
        return Connection()

    class FakeDatabaseSyntaxError(Exception):
        pgcode = "42601"
        diag = type("Diagnostic", (), {"message_primary": "syntax error at or near VALUES"})()

    monkeypatch.setattr(
        ingestion, "upsert_real_prices",
        lambda *_args: (_ for _ in ()).throw(FakeDatabaseSyntaxError("syntax error at or near VALUES")),
    )
    cfg = {
        "symbols": ["AAA.NS"],
        "data": {"source": "yfinance", "start_date": "2024-01-01", "adjustment": "auto", "request_delay_seconds": 0},
        "ingestion": {"overlap_calendar_days": 7},
    }

    with pytest.raises(ingestion.IngestionError, match=r"SQLSTATE 42601.*syntax error at or near VALUES"):
        ingestion.run_ingestion(
            config=cfg,
            database_url="postgresql://test:test@localhost:5432/test",
            end_date_override="2024-02-01",
            ticker_factory=lambda _symbol: type("Ticker", (), {
                "history": lambda self, **_kwargs: history_frame(index=pd.DatetimeIndex(["2024-01-02", "2024-01-03"], name="Date"))
            })(),
            connect_factory=connect_factory,
            sleep_fn=lambda _delay: None,
        )
    assert states == ["commit", "rollback"]


@pytest.mark.skipif(not os.environ.get("FINQUEST_TEST_DATABASE_URL"), reason="dedicated PostgreSQL test URL not configured")
def test_postgres_upsert_is_idempotent_and_replaces_only_synthetic():
    psycopg2 = pytest.importorskip("psycopg2")
    connection = psycopg2.connect(os.environ["FINQUEST_TEST_DATABASE_URL"])
    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute("""
                    CREATE TEMP TABLE historical_prices (
                      symbol TEXT NOT NULL, trade_date DATE NOT NULL,
                      open NUMERIC(14,2) NOT NULL, high NUMERIC(14,2) NOT NULL,
                      low NUMERIC(14,2) NOT NULL, close NUMERIC(14,2) NOT NULL,
                      volume BIGINT NOT NULL, data_source TEXT NOT NULL,
                      price_adjustment TEXT NOT NULL, ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                      UNIQUE(symbol, trade_date)
                    ) ON COMMIT PRESERVE ROWS
                """)
                cursor.execute("""
                    INSERT INTO historical_prices
                    (symbol, trade_date, open, high, low, close, volume, data_source, price_adjustment)
                    VALUES ('AAA', '2024-01-02', 9, 10, 8, 9, 50, 'SYNTHETIC_SAMPLE', 'not_applicable')
                """)
        bar = ingestion.PriceBar("AAA", date(2024, 1, 2), *[Decimal(v) for v in ("10", "12", "9", "11")], 100)
        assert ingestion.upsert_real_prices(connection, [bar], "auto") == 1
        assert ingestion.upsert_real_prices(connection, [bar], "auto") == 1
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*), MAX(data_source), MAX(price_adjustment), MAX(close) FROM historical_prices")
            assert cursor.fetchone() == (1, ingestion.YAHOO_SOURCE, "auto", bar.close)
            cursor.execute("""
                INSERT INTO historical_prices
                (symbol, trade_date, open, high, low, close, volume, data_source, price_adjustment)
                VALUES ('AAA', '2024-01-02', 8, 9, 7, 8, 40, 'SYNTHETIC_SAMPLE', 'not_applicable')
                ON CONFLICT (symbol, trade_date) DO NOTHING
            """)
            cursor.execute("SELECT data_source, close FROM historical_prices")
            assert cursor.fetchone() == (ingestion.YAHOO_SOURCE, bar.close)
    finally:
        connection.close()
