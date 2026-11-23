"""
FINQUEST ML Service — FastAPI
Serves predictions from trained Scikit-learn model.

Start: uvicorn serve:app --host 0.0.0.0 --port 8000
Internal only — do NOT expose publicly.
"""
from __future__ import annotations

import os
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
import yaml
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ── Logging ─────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("finquest.ml")

# ── Load config ──────────────────────────────────────────────────
CONFIG_PATH = Path(__file__).parent / "config.yaml"
with open(CONFIG_PATH) as f:
    CONFIG = yaml.safe_load(f)

MODEL_DIR   = Path(__file__).parent / CONFIG["output"]["model_dir"]
MODEL_TOKEN = os.environ.get("ML_SERVICE_TOKEN", "dev_ml_token")

# ── Load model artifacts ─────────────────────────────────────────
ARTIFACTS: dict = {}

def load_artifacts():
    global ARTIFACTS
    version = CONFIG["output"]["model_version"]
    model_path = MODEL_DIR / f"model_{version}.joblib"
    meta_path  = MODEL_DIR / f"meta_{version}.json"

    if not model_path.exists():
        log.warning(f"No model found at {model_path}. /predict will return SERVICE_UNAVAILABLE.")
        return False

    ARTIFACTS["model"]   = joblib.load(model_path)
    ARTIFACTS["version"] = version

    if meta_path.exists():
        with open(meta_path) as f:
            ARTIFACTS["meta"] = json.load(f)
    else:
        ARTIFACTS["meta"] = {}

    log.info(f"Model loaded: version={version}")
    return True

MODEL_LOADED = load_artifacts()

# ── App ──────────────────────────────────────────────────────────
app = FastAPI(
    title="FINQUEST ML Service",
    description="Educational movement classifier. NOT investment advice.",
    version="1.0.0",
    docs_url="/docs" if os.environ.get("ML_DOCS_ENABLED") == "true" else None,
)

# ── Auth dependency ──────────────────────────────────────────────
def verify_token(x_service_token: Optional[str] = Header(None)):
    if x_service_token != MODEL_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid service token")

# ── Feature engineering (must match train.py exactly) ───────────
def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute features for the LAST row of a price DataFrame.
    DataFrame must have: Date, Open, High, Low, Close, Volume columns.
    """
    cfg = CONFIG["features"]
    df = df.copy().sort_values("Date").reset_index(drop=True)
    df["daily_return"] = df["Close"].pct_change()

    for w in cfg["moving_averages"]:
        if len(df) >= w:
            df[f"ma_{w}"] = df["Close"].rolling(w).mean()
            df[f"ma_{w}_ratio"] = df["Close"] / df[f"ma_{w}"]

    # RSI
    rsi_w = cfg["rsi_window"]
    delta = df["Close"].diff()
    gain  = delta.clip(lower=0).rolling(rsi_w).mean()
    loss  = (-delta.clip(upper=0)).rolling(rsi_w).mean()
    rs    = gain / loss.replace(0, np.nan)
    df["rsi"] = 100 - (100 / (1 + rs))

    # MACD
    fast, slow, sig = cfg["macd_fast"], cfg["macd_slow"], cfg["macd_signal"]
    ema_fast = df["Close"].ewm(span=fast, adjust=False).mean()
    ema_slow = df["Close"].ewm(span=slow, adjust=False).mean()
    df["macd"]        = ema_fast - ema_slow
    df["macd_signal"] = df["macd"].ewm(span=sig, adjust=False).mean()
    df["macd_hist"]   = df["macd"] - df["macd_signal"]

    # Volatility and volume change
    df["volatility"]    = df["daily_return"].rolling(cfg["volatility_window"]).std()
    df["volume_change"] = df["Volume"].pct_change(cfg["volume_change_window"])

    return df

# ── Schemas ──────────────────────────────────────────────────────
class PredictRequest(BaseModel):
    symbol: str

class PredictResponse(BaseModel):
    symbol: str
    prediction: str           # UP | DOWN | SIDEWAYS
    probabilities: dict       # {UP: float, DOWN: float, SIDEWAYS: float}
    calibrated: bool
    model_version: str
    data_source: str
    last_data_date: Optional[str]
    key_indicators: dict
    predicted_at: str
    disclaimer: str

# ── Endpoints ────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok" if MODEL_LOADED else "degraded",
        "model_loaded": MODEL_LOADED,
        "model_version": ARTIFACTS.get("version"),
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/model/info", dependencies=[Depends(verify_token)])
def model_info():
    if not MODEL_LOADED:
        raise HTTPException(503, "Model not loaded. Run python train.py --config config.yaml")
    return {
        "model_version": ARTIFACTS.get("version"),
        "meta": ARTIFACTS.get("meta", {}),
        "disclaimer": (
            "Educational classification only. Not investment advice. "
            "Model accuracy is limited and does not predict future prices."
        ),
    }


@app.post("/predict", response_model=PredictResponse, dependencies=[Depends(verify_token)])
def predict(req: PredictRequest):
    if not MODEL_LOADED:
        raise HTTPException(503, "Model not loaded. Run python train.py --config config.yaml first.")

    model      = ARTIFACTS["model"]
    meta       = ARTIFACTS.get("meta", {})
    version    = ARTIFACTS.get("version", "unknown")
    features   = meta.get("feature_list", [])
    data_source = meta.get("data_source", "UNKNOWN")

    # ── Load price data from DB ──────────────────────────────────
    # Attempt DB, fall back to synthetic note
    symbol_ns = req.symbol.upper().replace(".NS", "")

    try:
        import psycopg2
        db_url = os.environ.get("DATABASE_URL", "")
        conn   = psycopg2.connect(db_url)
        df     = pd.read_sql(
            "SELECT trade_date AS \"Date\", open AS \"Open\", high AS \"High\", "
            "low AS \"Low\", close AS \"Close\", volume AS \"Volume\" "
            "FROM historical_prices WHERE symbol=%s ORDER BY trade_date",
            conn, params=(symbol_ns,)
        )
        conn.close()
        df["Date"] = pd.to_datetime(df["Date"])
        db_data_source = "DB"
    except Exception as e:
        log.warning(f"DB load failed for {symbol_ns}: {e}. Using synthetic fallback.")
        df = _synthetic_fallback(symbol_ns)
        db_data_source = "SYNTHETIC_SAMPLE"

    if df.empty or len(df) < 60:
        raise HTTPException(422, f"Not enough price data for {symbol_ns} (need ≥60 rows).")

    df_feat   = compute_features(df)
    last_row  = df_feat.dropna(subset=["rsi"]).iloc[-1]
    last_date = str(df["Date"].iloc[-1].date()) if "Date" in df.columns else None

    # Build feature vector
    if features:
        try:
            X = pd.DataFrame([last_row[features]])
        except KeyError as e:
            raise HTTPException(422, f"Feature mismatch: {e}")
    else:
        # Use all numeric columns except label columns
        numeric_cols = df_feat.select_dtypes(include=[np.number]).columns.tolist()
        X = pd.DataFrame([last_row[numeric_cols]])

    X = X.fillna(0)

    # Predict
    class_names = model.classes_
    if hasattr(model, "predict_proba"):
        probs = model.predict_proba(X)[0]
        pred  = class_names[np.argmax(probs)]
        prob_dict = {str(c): round(float(p), 4) for c, p in zip(class_names, probs)}
        calibrated = meta.get("calibrated", False)
    else:
        pred      = model.predict(X)[0]
        prob_dict = {}
        calibrated = False

    indicators = {
        "rsi":          round(float(last_row.get("rsi", 0)), 2),
        "macd":         round(float(last_row.get("macd", 0)), 4),
        "macd_signal":  round(float(last_row.get("macd_signal", 0)), 4),
        "daily_return": round(float(last_row.get("daily_return", 0)) * 100, 3),
        "volatility":   round(float(last_row.get("volatility", 0)) * 100, 3),
    }

    return PredictResponse(
        symbol        = symbol_ns,
        prediction    = str(pred),
        probabilities = prob_dict,
        calibrated    = calibrated,
        model_version = version,
        data_source   = db_data_source,
        last_data_date = last_date,
        key_indicators = indicators,
        predicted_at  = datetime.now(timezone.utc).isoformat(),
        disclaimer    = (
            "EDUCATIONAL ONLY. This is a classification experiment, not price prediction. "
            "Past patterns do not guarantee future prices. Not investment advice."
        ),
    )


@app.post("/train")
def train_endpoint():
    raise HTTPException(
        403,
        "Training via API is disabled. Run: python train.py --config config.yaml"
    )


# ── Synthetic fallback ───────────────────────────────────────────
def _synthetic_fallback(symbol: str) -> pd.DataFrame:
    """Return labelled synthetic price data when DB is unavailable."""
    import numpy as np
    rng  = np.random.default_rng(42)
    n    = 500
    base = {"RELIANCE": 2500, "TCS": 4000, "INFY": 1800, "HDFCBANK": 1700}.get(symbol, 1000)
    closes = [base]
    for _ in range(n - 1):
        closes.append(closes[-1] * (1 + rng.normal(0, 0.015)))
    dates = pd.bdate_range("2022-01-03", periods=n)
    df = pd.DataFrame({
        "Date":   dates,
        "Open":   closes,
        "High":   [c * (1 + rng.uniform(0, 0.01)) for c in closes],
        "Low":    [c * (1 - rng.uniform(0, 0.01)) for c in closes],
        "Close":  closes,
        "Volume": rng.integers(500_000, 2_000_000, n),
    })
    return df
