"""
FINQUEST ML — Training Script
Run: python train.py --config config.yaml

Reproducible: fixed random seeds, chronological split, no data leakage.
Outputs: model_<version>.joblib, meta_<version>.json, MODEL_CARD.md
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import yaml
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, classification_report, confusion_matrix, f1_score
)
from sklearn.model_selection import TimeSeriesSplit
from sklearn.preprocessing import StandardScaler
from sklearn.dummy import DummyClassifier

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("finquest.train")

# ── Args ─────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = SCRIPT_DIR / "config.yaml"


def load_config(path: str | Path = DEFAULT_CONFIG_PATH) -> dict:
    with Path(path).open(encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    if not isinstance(cfg, dict):
        raise ValueError("Configuration must be a YAML mapping")
    return cfg


CONFIG = load_config()
MODEL_DIR = SCRIPT_DIR / CONFIG["output"]["model_dir"]
VERSION = CONFIG["output"]["model_version"]
SEED = CONFIG["model"]["random_state"]
np.random.seed(SEED)


# ── Feature engineering (matches serve.py exactly) ──────────────
def compute_features(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    df = df.copy().sort_values("Date").reset_index(drop=True)
    df["daily_return"] = df["Close"].pct_change(fill_method=None)

    for w in cfg["moving_averages"]:
        df[f"ma_{w}"]       = df["Close"].rolling(w).mean()
        df[f"ma_{w}_ratio"] = df["Close"] / df[f"ma_{w}"]

    rsi_w = cfg["rsi_window"]
    delta = df["Close"].diff()
    gain  = delta.clip(lower=0).rolling(rsi_w).mean()
    loss  = (-delta.clip(upper=0)).rolling(rsi_w).mean()
    rs    = gain / loss.replace(0, np.nan)
    df["rsi"] = 100 - (100 / (1 + rs))
    df.loc[(loss == 0) & (gain > 0), "rsi"] = 100
    df.loc[(loss == 0) & (gain == 0), "rsi"] = 50

    fast, slow, sig = cfg["macd_fast"], cfg["macd_slow"], cfg["macd_signal"]
    ema_fast = df["Close"].ewm(span=fast, adjust=False).mean()
    ema_slow = df["Close"].ewm(span=slow, adjust=False).mean()
    df["macd"]        = ema_fast - ema_slow
    df["macd_signal"] = df["macd"].ewm(span=sig, adjust=False).mean()
    df["macd_hist"]   = df["macd"] - df["macd_signal"]

    df["volatility"]    = df["daily_return"].rolling(cfg["volatility_window"]).std()
    df["volume_change"] = df["Volume"].pct_change(cfg["volume_change_window"], fill_method=None)
    return df


def add_labels(df: pd.DataFrame, h: int, up: float, down: float) -> pd.DataFrame:
    """Add forward return label. Features at t, label from t+1...t+h (no leakage)."""
    df = df.copy()
    df["forward_return"] = df["Close"].shift(-h) / df["Close"] - 1
    df["label"] = "SIDEWAYS"
    df.loc[df["forward_return"] >  up,   "label"] = "UP"
    df.loc[df["forward_return"] <  down, "label"] = "DOWN"
    # Drop last h rows — they have no full forward horizon
    if h < 1:
        raise ValueError("Label horizon must be at least one trading day")
    df = df.iloc[:-h] if h < len(df) else df.iloc[0:0]
    return df


# ── Load data ────────────────────────────────────────────────────
def load_data(config: dict | None = None) -> pd.DataFrame:
    config = config or CONFIG
    source = config["data"]["source"]

    if source == "yfinance":
        import yfinance as yf
        # yfinance 1.8.0 deprecates history(raise_errors=...) in favor of this setting.
        yf.config.debug.hide_exceptions = False
        symbols = config["symbols"]
        delay_seconds = float(config["data"].get("request_delay_seconds", 1.0))
        if not math.isfinite(delay_seconds) or delay_seconds < 0:
            raise ValueError("data.request_delay_seconds must be a finite, non-negative number")
        dfs = []
        for index, sym in enumerate(symbols):
            log.info(f"Downloading {sym}...")
            try:
                ticker = yf.Ticker(sym)
                hist = ticker.history(
                    start=config["data"]["start_date"],
                    end=config["data"]["end_date"],
                    auto_adjust=config["data"].get("adjustment", "auto") == "auto",
                )
            except Exception as exc:
                status_code = getattr(getattr(exc, "response", None), "status_code", None)
                error_text = f"{type(exc).__name__}: {exc}"
                error_lower = error_text.lower()
                rate_limited = (
                    status_code == 429
                    or "429" in error_text
                    or "too many requests" in error_lower
                    or "rate limit" in error_lower
                )
                if rate_limited:
                    message = (
                        f"Yahoo Finance rate-limited {sym} (HTTP 429); stopping training. "
                        f"No FINQUEST retry will be attempted. Details: {error_text}"
                    )
                elif isinstance(exc, json.JSONDecodeError):
                    message = (
                        f"Yahoo Finance returned an invalid JSON response for {sym}; "
                        "this may indicate HTTP 429 or another Yahoo response error. "
                        f"Stopping training. Details: {error_text}"
                    )
                else:
                    message = f"Yahoo Finance request failed for {sym}; stopping training. Details: {error_text}"
                log.error(message)
                raise RuntimeError(message) from exc
            if hist.empty:
                message = f"Yahoo Finance returned no historical rows for {sym}; stopping training."
                log.error(message)
                raise RuntimeError(message)
            hist = hist.reset_index()[["Date", "Open", "High", "Low", "Close", "Volume"]]
            hist["symbol"]      = sym.replace(".NS", "")
            hist["data_source"] = "YFINANCE_NS"
            dfs.append(hist)
            if delay_seconds and index < len(symbols) - 1:
                time.sleep(delay_seconds)
        if not dfs:
            raise RuntimeError("No Yahoo Finance data was downloaded; stopping training.")
        df = pd.concat(dfs, ignore_index=True)
        df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None)
        return df

    elif source == "synthetic":
        return _generate_synthetic(config)

    else:
        raise ValueError(f"Unknown data source: {source}")


def _generate_synthetic(config: dict | None = None) -> pd.DataFrame:
    log.warning("⚠️  Using SYNTHETIC data. All ML results are illustrative only.")
    rng   = np.random.default_rng(SEED)
    start_prices = {"RELIANCE": 2500, "TCS": 4000, "INFY": 1800, "HDFCBANK": 1700,
                    "ICICIBANK": 1000, "ITC": 450, "SBIN": 750, "LT": 3600}
    rows = []
    config = config or CONFIG
    dates = pd.bdate_range(config["data"]["start_date"], config["data"]["end_date"])

    for sym, base in start_prices.items():
        price = base
        for d in dates:
            ret   = rng.normal(0.0003, 0.015)
            price = max(price * (1 + ret), 1.0)
            hi    = price * (1 + rng.uniform(0, 0.01))
            lo    = price * (1 - rng.uniform(0, 0.01))
            rows.append({
                "Date": d, "symbol": sym, "Open": round(price, 2),
                "High": round(hi, 2), "Low": round(lo, 2),
                "Close": round(price, 2), "Volume": int(rng.integers(500_000, 2_000_000)),
                "data_source": "SYNTHETIC_SAMPLE",
            })
    return pd.DataFrame(rows)


# ── Main training ────────────────────────────────────────────────
def main(
    diagnostics_only: bool = False,
    calibration_investigation: bool = False,
    performance_investigation: bool = False,
    rolling_validation: bool = False,
    feature_investigation: bool = False,
):
    if sum((diagnostics_only, calibration_investigation, performance_investigation,
            rolling_validation, feature_investigation)) > 1:
        raise ValueError("Choose only one diagnostic mode")
    log.info("=" * 60)
    log.info("FINQUEST ML Training Pipeline")
    log.info(f"Version: {VERSION} | Seed: {SEED}")
    log.info("=" * 60)

    df_raw = load_data(CONFIG)
    raw_rows = len(df_raw)
    data_source = df_raw["data_source"].iloc[0] if "data_source" in df_raw.columns else "UNKNOWN"
    log.info(f"Loaded {len(df_raw)} rows | Data source: {data_source}")

    # Validate: check for missing dates, duplicates
    df_raw["Date"] = pd.to_datetime(df_raw["Date"])
    dupes = df_raw.duplicated(subset=["symbol", "Date"]).sum()
    if dupes:
        log.warning(f"Dropping {dupes} duplicate rows")
        df_raw = df_raw.drop_duplicates(subset=["symbol", "Date"])

    feat_cfg  = CONFIG["features"]
    lbl_cfg   = CONFIG["labels"]
    h, up_t, dn_t = lbl_cfg["horizon_days"], lbl_cfg["up_threshold"], lbl_cfg["down_threshold"]
    if h < 1 or not (dn_t < 0 < up_t):
        raise ValueError("labels require horizon_days >= 1, down_threshold < 0, and up_threshold > 0")
    if not feat_cfg["moving_averages"] or any(int(window) < 1 for window in feat_cfg["moving_averages"]):
        raise ValueError("features.moving_averages must contain positive windows")
    if min(feat_cfg["rsi_window"], feat_cfg["macd_fast"], feat_cfg["macd_slow"],
           feat_cfg["macd_signal"], feat_cfg["volatility_window"], feat_cfg["volume_change_window"]) < 1:
        raise ValueError("All feature windows must be positive integers")
    if feat_cfg["macd_fast"] >= feat_cfg["macd_slow"]:
        raise ValueError("features.macd_fast must be less than macd_slow")

    all_dfs = []
    for sym, grp in df_raw.groupby("symbol"):
        grp = grp.sort_values("Date")
        grp = compute_features(grp, feat_cfg)
        grp = add_labels(grp, h, up_t, dn_t)
        all_dfs.append(grp)

    if not all_dfs:
        raise ValueError("No symbols contained usable price data")
    data = pd.concat(all_dfs, ignore_index=True).dropna()
    log.info(f"After feature engineering: {len(data)} rows")

    FEATURE_COLS = (
        ["daily_return", "rsi", "macd", "macd_signal", "macd_hist", "volatility", "volume_change"] +
        [f"ma_{w}_ratio" for w in feat_cfg["moving_averages"]]
    )
    missing_features = [c for c in FEATURE_COLS if c not in data.columns]
    if missing_features:
        raise ValueError(f"Missing configured features: {missing_features}")
    if data.empty:
        raise ValueError("No rows remain after feature and label warm-up periods")

    # Chronological split — NEVER random split time series
    data = data.sort_values(["Date", "symbol"]).reset_index(drop=True)
    split_cfg = CONFIG["split"]
    if split_cfg.get("method", "chronological") != "chronological":
        raise ValueError("Only chronological splitting is supported")
    if not 0 < split_cfg["test_ratio"] < 1:
        raise ValueError("split.test_ratio must be between 0 and 1")
    horizon = int(CONFIG["labels"]["horizon_days"])
    unique_dates = sorted(data["Date"].drop_duplicates())
    split_pos = int(len(unique_dates) * (1 - split_cfg["test_ratio"]))
    if split_pos <= 0 or split_pos >= len(unique_dates):
        raise ValueError("Not enough unique dates for the configured test split")
    split_date = unique_dates[split_pos]
    purge_pos = max(0, split_pos - horizon)
    train_end_date = unique_dates[purge_pos]
    train_df = data[data["Date"] < train_end_date]
    test_df = data[data["Date"] >= split_date]
    if train_df.empty or test_df.empty:
        raise ValueError("Chronological split leaves an empty training or test set")
    train_start = str(train_df["Date"].min().date())
    train_end   = str(train_df["Date"].max().date())
    test_start  = str(test_df["Date"].min().date())
    test_end    = str(test_df["Date"].max().date())

    X_train = train_df[FEATURE_COLS].replace([np.inf, -np.inf], np.nan).fillna(0)
    y_train = train_df["label"]

    if performance_investigation:
        from diagnostics import run_rf_performance_investigation, write_diagnostic_report

        mcfg = CONFIG["model"]
        if mcfg.get("type") != "RandomForestClassifier":
            raise ValueError("Only model.type=RandomForestClassifier is supported")
        rf = RandomForestClassifier(
            n_estimators=mcfg["n_estimators"],
            max_depth=mcfg["max_depth"],
            min_samples_leaf=mcfg["min_samples_leaf"],
            class_weight=mcfg["class_weight"],
            random_state=SEED,
            n_jobs=mcfg["n_jobs"],
        )
        report = run_rf_performance_investigation(
            estimator=rf,
            X_train=X_train,
            y_train=y_train,
            train_dates=train_df["Date"].to_numpy(),
            train_symbols=train_df["symbol"].to_numpy(),
            config=CONFIG,
            data_source=data_source,
            raw_rows=raw_rows,
            train_dates_full=(train_start, train_end),
        )
        report_path = MODEL_DIR / f"rf_performance_investigation_{VERSION}.json"
        write_diagnostic_report(report, report_path)
        log.info(f"Random Forest performance investigation saved: {report_path}")
        log.info("Investigation complete; final-test rows and production artifacts were not used.")
        return

    if rolling_validation:
        from diagnostics import run_rolling_rf_validation, write_diagnostic_report

        mcfg = CONFIG["model"]
        if mcfg.get("type") != "RandomForestClassifier":
            raise ValueError("Only model.type=RandomForestClassifier is supported")
        rf = RandomForestClassifier(
            n_estimators=mcfg["n_estimators"],
            max_depth=mcfg["max_depth"],
            min_samples_leaf=mcfg["min_samples_leaf"],
            class_weight=mcfg["class_weight"],
            random_state=SEED,
            n_jobs=mcfg["n_jobs"],
        )
        report = run_rolling_rf_validation(
            estimator=rf,
            X_train=X_train,
            y_train=y_train,
            train_dates=train_df["Date"].to_numpy(),
            train_symbols=train_df["symbol"].to_numpy(),
            config=CONFIG,
            data_source=data_source,
            raw_rows=raw_rows,
            train_dates_full=(train_start, train_end),
        )
        report_path = MODEL_DIR / f"rolling_rf_validation_{VERSION}.json"
        write_diagnostic_report(report, report_path)
        log.info(f"Rolling RF validation report saved: {report_path}")
        log.info("Rolling validation complete; final-test features and production artifacts were not used.")
        return

    if feature_investigation:
        from diagnostics import run_feature_engineering_investigation, write_diagnostic_report

        mcfg = CONFIG["model"]
        if mcfg.get("type") != "RandomForestClassifier":
            raise ValueError("Only model.type=RandomForestClassifier is supported")
        rf = RandomForestClassifier(
            n_estimators=mcfg["n_estimators"],
            max_depth=mcfg["max_depth"],
            min_samples_leaf=mcfg["min_samples_leaf"],
            class_weight=mcfg["class_weight"],
            random_state=SEED,
            n_jobs=mcfg["n_jobs"],
        )
        training_endpoint = train_df["Date"].max()
        raw_training_prices = df_raw.loc[
            df_raw["Date"] <= training_endpoint,
            ["Date", "symbol", "High", "Low", "Close"],
        ].copy()
        report = run_feature_engineering_investigation(
            estimator=rf,
            base_features=X_train,
            y_train=y_train,
            train_dates=train_df["Date"].to_numpy(),
            train_symbols=train_df["symbol"].to_numpy(),
            raw_prices=raw_training_prices,
            feature_config=feat_cfg,
            config=CONFIG,
            data_source=data_source,
            raw_rows=raw_rows,
            train_dates_full=(train_start, train_end),
        )
        report_path = MODEL_DIR / f"feature_engineering_investigation_{VERSION}.json"
        write_diagnostic_report(report, report_path)
        log.info(f"Feature engineering investigation saved: {report_path}")
        log.info("Feature investigation complete; final-test rows and production artifacts were not used.")
        return

    X_test  = test_df[FEATURE_COLS].replace([np.inf, -np.inf], np.nan).fillna(0)
    y_test  = test_df["label"]

    log.info(f"Train: {len(X_train)} rows ({train_start} → {train_end})")
    log.info(f"Test:  {len(X_test)} rows ({test_start} → {test_end})")
    log.info(f"Class distribution (train):\n{y_train.value_counts().to_string()}")

    # ── Baselines ──────────────────────────────────────────────
    baseline_majority = DummyClassifier(strategy="most_frequent", random_state=SEED)
    baseline_majority.fit(X_train, y_train)
    baseline_acc = accuracy_score(y_test, baseline_majority.predict(X_test))
    baseline_f1  = f1_score(y_test, baseline_majority.predict(X_test), average="macro", zero_division=0)
    log.info(f"Baseline (majority class): acc={baseline_acc:.4f}, macro-F1={baseline_f1:.4f}")

    # ── Train model ────────────────────────────────────────────
    mcfg = CONFIG["model"]
    if mcfg.get("type") != "RandomForestClassifier":
        raise ValueError("Only model.type=RandomForestClassifier is supported")
    rf   = RandomForestClassifier(
        n_estimators=mcfg["n_estimators"],
        max_depth=mcfg["max_depth"],
        min_samples_leaf=mcfg["min_samples_leaf"],
        class_weight=mcfg["class_weight"],
        random_state=SEED,
        n_jobs=mcfg["n_jobs"],
    )

    if diagnostics_only:
        from diagnostics import run_prediction_collapse_diagnostic, write_diagnostic_report

        diagnostic_report = run_prediction_collapse_diagnostic(
            estimator=rf,
            X_train=X_train,
            y_train=y_train,
            X_test=X_test,
            y_test=y_test,
            test_symbols=test_df["symbol"].to_numpy(),
            baseline=baseline_majority,
            config=CONFIG,
            data_source=data_source,
            raw_rows=raw_rows,
            train_dates=(train_start, train_end),
            test_dates=(test_start, test_end),
            saved_model_path=MODEL_DIR / f"model_{VERSION}.joblib",
        )
        diagnostic_path = MODEL_DIR / f"prediction_collapse_diagnostic_{VERSION}.json"
        write_diagnostic_report(diagnostic_report, diagnostic_path)
        log.info(f"Diagnostic report saved: {diagnostic_path}")
        log.info("Diagnostic-only run complete; production model artifacts were not written.")
        return

    if calibration_investigation:
        from diagnostics import run_calibration_investigation, write_diagnostic_report

        diagnostic_report = run_calibration_investigation(
            estimator=rf,
            X_train=X_train,
            y_train=y_train,
            train_dates=train_df["Date"].to_numpy(),
            train_symbols=train_df["symbol"].to_numpy(),
            X_test=X_test,
            y_test=y_test,
            test_symbols=test_df["symbol"].to_numpy(),
            config=CONFIG,
            data_source=data_source,
            raw_rows=raw_rows,
            train_dates_full=(train_start, train_end),
            test_dates_full=(test_start, test_end),
            saved_model_path=MODEL_DIR / f"model_{VERSION}.joblib",
        )
        diagnostic_path = MODEL_DIR / f"calibration_investigation_{VERSION}.json"
        write_diagnostic_report(diagnostic_report, diagnostic_path)
        log.info(f"Calibration investigation report saved: {diagnostic_path}")
        log.info("Calibration investigation complete; production model artifacts were not written.")
        return

    calibrated_enabled = CONFIG["calibration"]["enabled"]
    if calibrated_enabled:
        log.info("Calibrating probabilities (CalibratedClassifierCV)...")
        # Use TimeSeriesSplit for calibration CV — chronological
        # Purge at least the label horizon across all symbols between folds.
        calibration_gap = horizon * max(1, len(CONFIG["symbols"]))
        tscv  = TimeSeriesSplit(n_splits=5, gap=calibration_gap)
        model = CalibratedClassifierCV(rf, method=CONFIG["calibration"]["method"], cv=tscv)
    else:
        model = rf

    model.fit(X_train, y_train)
    log.info("Training complete.")

    # ── Evaluate ────────────────────────────────────────────────
    y_pred = model.predict(X_test)
    acc    = accuracy_score(y_test, y_pred)
    macro_f1 = f1_score(y_test, y_pred, average="macro", zero_division=0)
    report = classification_report(y_test, y_pred, zero_division=0)
    cm     = confusion_matrix(y_test, y_pred, labels=["UP", "SIDEWAYS", "DOWN"])

    log.info(f"\nTest accuracy:  {acc:.4f}")
    log.info(f"Macro F1:       {macro_f1:.4f}")
    log.info(f"Beats baseline: {acc > baseline_acc}")
    log.info(f"\nClassification Report:\n{report}")
    log.info(f"\nConfusion Matrix (UP / SIDEWAYS / DOWN):\n{cm}")

    # Feature importance (from inner RF if calibrated)
    importances = {}
    if calibrated_enabled:
        fitted_estimators = [
            getattr(calibrated, "estimator", getattr(calibrated, "base_estimator", None))
            for calibrated in model.calibrated_classifiers_
        ]
        fitted_estimators = [est for est in fitted_estimators if hasattr(est, "feature_importances_")]
        if fitted_estimators:
            importances = dict(zip(
                FEATURE_COLS,
                np.mean([est.feature_importances_ for est in fitted_estimators], axis=0).tolist(),
            ))
    elif hasattr(model, "feature_importances_"):
        importances = dict(zip(FEATURE_COLS, model.feature_importances_.tolist()))

    # ── Save artifacts ──────────────────────────────────────────
    model_path = MODEL_DIR / f"model_{VERSION}.joblib"
    meta_path  = MODEL_DIR / f"meta_{VERSION}.json"
    joblib.dump(model, model_path)
    log.info(f"Model saved: {model_path}")

    meta = {
        "model_version":  VERSION,
        "trained_at":     datetime.now(timezone.utc).isoformat(),
        "train_start":    train_start,
        "train_end":      train_end,
        "test_start":     test_start,
        "test_end":       test_end,
        "train_rows":     len(X_train),
        "test_rows":      len(X_test),
        "data_source":    data_source,
        "feature_list":   FEATURE_COLS,
        "label_config":   lbl_cfg,
        "test_accuracy":  round(acc, 4),
        "macro_f1":       round(macro_f1, 4),
        "baseline_accuracy": round(baseline_acc, 4),
        "beats_baseline": acc > baseline_acc,
        "calibrated":     calibrated_enabled,
        "class_distribution": y_train.value_counts().to_dict(),
        "feature_importances": importances,
        "library_versions": {
            "scikit-learn": __import__("sklearn").__version__,
            "pandas":       pd.__version__,
            "numpy":        np.__version__,
        },
    }
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    log.info(f"Meta saved: {meta_path}")

    # ── MODEL_CARD.md ───────────────────────────────────────────
    card = f"""# FINQUEST ML — MODEL CARD

## Model: Random Forest Classifier (Educational)
**Version:** {VERSION}
**Trained:** {meta['trained_at']}

---

## Purpose
Educational classification of near-future stock movement direction: UP / DOWN / SIDEWAYS.

**This is not investment advice. This model does not predict prices.**

---

## Data
- **Source:** {data_source}
- **Training period:** {train_start} to {train_end}
- **Test period:** {test_start} to {test_end}
- **Symbols:** {', '.join(CONFIG['symbols'])}

> ⚠️ If data_source is SYNTHETIC_SAMPLE, all results are illustrative only and do not reflect real market behaviour.

---

## Label Definition
- **UP:** forward {h}-day return > {up_t*100:.1f}%
- **DOWN:** forward {h}-day return < {dn_t*100:.1f}%
- **SIDEWAYS:** otherwise

---

## Features
{chr(10).join(f'- {f}' for f in FEATURE_COLS)}

---

## Results
| Metric | Value |
|--------|-------|
| Test accuracy | {acc:.4f} |
| Macro F1 | {macro_f1:.4f} |
| Baseline accuracy (majority class) | {baseline_acc:.4f} |
| Beats baseline | {'✅ Yes' if acc > baseline_acc else '❌ No'} |

**Classification Report:**
```
{report}
```

---

## Limitations
- Financial time series are non-stationary. Past patterns may not repeat.
- Synthetic data does not reflect actual NSE market dynamics.
- Class imbalance is handled via `class_weight='balanced'` but SIDEWAYS often dominates.
- Model accuracy is NOT a measure of trading profitability.
- Never use this model for real investment decisions.

---

## Reproducibility
```
python train.py --config config.yaml
```
Random seed: {SEED}
"""
    card_path = MODEL_DIR / "MODEL_CARD.md"
    card_path.write_text(card, encoding="utf-8")
    log.info(f"MODEL_CARD.md written: {card_path}")
    log.info("✅ Training pipeline complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH))
    diagnostic_group = parser.add_mutually_exclusive_group()
    diagnostic_group.add_argument(
        "--diagnostics-only", action="store_true",
        help="Compare calibrated and uncalibrated models without writing production model artifacts",
    )
    diagnostic_group.add_argument(
        "--calibration-investigation", action="store_true",
        help="Compare calibration methods on purged chronological validation and score saved production on the locked test set",
    )
    diagnostic_group.add_argument(
        "--performance-investigation", action="store_true",
        help="Investigate RF features and alternatives using only purged chronological validation from outer training data",
    )
    diagnostic_group.add_argument(
        "--rolling-validation", action="store_true",
        help="Compare configured and deeper RF over three or more expanding, purged chronological validation windows",
    )
    diagnostic_group.add_argument(
        "--feature-investigation", action="store_true",
        help="Compare past-only feature sets and RF models over the same purged rolling validation windows",
    )
    cli_args = parser.parse_args()
    CONFIG = load_config(cli_args.config)
    MODEL_DIR = SCRIPT_DIR / CONFIG["output"]["model_dir"]
    VERSION = CONFIG["output"]["model_version"]
    SEED = CONFIG["model"]["random_state"]
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    main(
        diagnostics_only=cli_args.diagnostics_only,
        calibration_investigation=cli_args.calibration_investigation,
        performance_investigation=cli_args.performance_investigation,
        rolling_validation=cli_args.rolling_validation,
        feature_investigation=cli_args.feature_investigation,
    )
