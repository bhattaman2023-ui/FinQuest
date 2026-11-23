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
import os
import sys
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
parser = argparse.ArgumentParser()
parser.add_argument("--config", default="config.yaml")
args, _ = parser.parse_known_args()

with open(args.config) as f:
    CONFIG = yaml.safe_load(f)

MODEL_DIR = Path(CONFIG["output"]["model_dir"])
MODEL_DIR.mkdir(exist_ok=True)
VERSION   = CONFIG["output"]["model_version"]
SEED      = CONFIG["model"]["random_state"]
np.random.seed(SEED)


# ── Feature engineering (matches serve.py exactly) ──────────────
def compute_features(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    df = df.copy().sort_values("Date").reset_index(drop=True)
    df["daily_return"] = df["Close"].pct_change()

    for w in cfg["moving_averages"]:
        df[f"ma_{w}"]       = df["Close"].rolling(w).mean()
        df[f"ma_{w}_ratio"] = df["Close"] / df[f"ma_{w}"]

    rsi_w = cfg["rsi_window"]
    delta = df["Close"].diff()
    gain  = delta.clip(lower=0).rolling(rsi_w).mean()
    loss  = (-delta.clip(upper=0)).rolling(rsi_w).mean()
    rs    = gain / loss.replace(0, np.nan)
    df["rsi"] = 100 - (100 / (1 + rs))

    fast, slow, sig = cfg["macd_fast"], cfg["macd_slow"], cfg["macd_signal"]
    ema_fast = df["Close"].ewm(span=fast, adjust=False).mean()
    ema_slow = df["Close"].ewm(span=slow, adjust=False).mean()
    df["macd"]        = ema_fast - ema_slow
    df["macd_signal"] = df["macd"].ewm(span=sig, adjust=False).mean()
    df["macd_hist"]   = df["macd"] - df["macd_signal"]

    df["volatility"]    = df["daily_return"].rolling(cfg["volatility_window"]).std()
    df["volume_change"] = df["Volume"].pct_change(cfg["volume_change_window"])
    return df


def add_labels(df: pd.DataFrame, h: int, up: float, down: float) -> pd.DataFrame:
    """Add forward return label. Features at t, label from t+1...t+h (no leakage)."""
    df = df.copy()
    df["forward_return"] = df["Close"].shift(-h) / df["Close"] - 1
    df["label"] = "SIDEWAYS"
    df.loc[df["forward_return"] >  up,   "label"] = "UP"
    df.loc[df["forward_return"] <  down, "label"] = "DOWN"
    # Drop last h rows — they have no full forward horizon
    df = df.iloc[:-h]
    return df


# ── Load data ────────────────────────────────────────────────────
def load_data() -> pd.DataFrame:
    source = CONFIG["data"]["source"]

    if source == "yfinance":
        import yfinance as yf
        dfs = []
        for sym in CONFIG["symbols"]:
            log.info(f"Downloading {sym}...")
            ticker = yf.Ticker(sym)
            hist   = ticker.history(
                start=CONFIG["data"]["start_date"],
                end=CONFIG["data"]["end_date"],
                auto_adjust=True,
            )
            if hist.empty:
                log.warning(f"No data for {sym}, skipping.")
                continue
            hist = hist.reset_index()[["Date", "Open", "High", "Low", "Close", "Volume"]]
            hist["symbol"]      = sym.replace(".NS", "")
            hist["data_source"] = "YFINANCE_NS"
            dfs.append(hist)
        if not dfs:
            log.error("No data downloaded. Falling back to synthetic.")
            return _generate_synthetic()
        df = pd.concat(dfs, ignore_index=True)
        df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None)
        return df

    elif source == "synthetic":
        return _generate_synthetic()

    else:
        raise ValueError(f"Unknown data source: {source}")


def _generate_synthetic() -> pd.DataFrame:
    log.warning("⚠️  Using SYNTHETIC data. All ML results are illustrative only.")
    rng   = np.random.default_rng(SEED)
    start_prices = {"RELIANCE": 2500, "TCS": 4000, "INFY": 1800, "HDFCBANK": 1700,
                    "ICICIBANK": 1000, "ITC": 450, "SBIN": 750, "LT": 3600}
    rows = []
    dates = pd.bdate_range("2019-01-01", "2024-12-31")

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
def main():
    log.info("=" * 60)
    log.info("FINQUEST ML Training Pipeline")
    log.info(f"Version: {VERSION} | Seed: {SEED}")
    log.info("=" * 60)

    df_raw = load_data()
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

    all_dfs = []
    for sym, grp in df_raw.groupby("symbol"):
        grp = grp.sort_values("Date")
        grp = compute_features(grp, feat_cfg)
        grp = add_labels(grp, h, up_t, dn_t)
        all_dfs.append(grp)

    data = pd.concat(all_dfs, ignore_index=True).dropna()
    log.info(f"After feature engineering: {len(data)} rows")

    FEATURE_COLS = (
        ["daily_return", "rsi", "macd", "macd_signal", "macd_hist", "volatility", "volume_change"] +
        [f"ma_{w}_ratio" for w in feat_cfg["moving_averages"]]
    )
    FEATURE_COLS = [c for c in FEATURE_COLS if c in data.columns]

    # Chronological split — NEVER random split time series
    data = data.sort_values("Date")
    n    = len(data)
    split_cfg = CONFIG["split"]
    test_n  = int(n * split_cfg["test_ratio"])
    train_n = n - test_n

    train_df = data.iloc[:train_n]
    test_df  = data.iloc[train_n:]
    train_start = str(train_df["Date"].min().date())
    train_end   = str(train_df["Date"].max().date())
    test_start  = str(test_df["Date"].min().date())
    test_end    = str(test_df["Date"].max().date())

    X_train = train_df[FEATURE_COLS].fillna(0)
    y_train = train_df["label"]
    X_test  = test_df[FEATURE_COLS].fillna(0)
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
    rf   = RandomForestClassifier(
        n_estimators=mcfg["n_estimators"],
        max_depth=mcfg["max_depth"],
        min_samples_leaf=mcfg["min_samples_leaf"],
        class_weight=mcfg["class_weight"],
        random_state=SEED,
        n_jobs=mcfg["n_jobs"],
    )

    calibrated_enabled = CONFIG["calibration"]["enabled"]
    if calibrated_enabled:
        log.info("Calibrating probabilities (CalibratedClassifierCV)...")
        # Use TimeSeriesSplit for calibration CV — chronological
        tscv  = TimeSeriesSplit(n_splits=5)
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
    inner_rf = getattr(model, "base_estimator", model) if calibrated_enabled else model
    if hasattr(inner_rf, "feature_importances_"):
        importances = dict(zip(FEATURE_COLS, inner_rf.feature_importances_.tolist()))

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
    with open(meta_path, "w") as f:
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
    card_path.write_text(card)
    log.info(f"MODEL_CARD.md written: {card_path}")
    log.info("✅ Training pipeline complete.")


if __name__ == "__main__":
    main()
