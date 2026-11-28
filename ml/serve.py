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
from zoneinfo import ZoneInfo

import joblib
import numpy as np
import pandas as pd
import yaml
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from db_config import DatabaseConfigurationError, get_database_url

# ── Logging ─────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("finquest.ml")

# ── Load config ──────────────────────────────────────────────────
CONFIG_PATH = Path(__file__).parent / "config.yaml"
with open(CONFIG_PATH) as f:
    CONFIG = yaml.safe_load(f)

MODEL_DIR   = Path(__file__).resolve().parent / CONFIG["output"]["model_dir"]
MODEL_TOKEN = os.environ.get("ML_SERVICE_TOKEN")

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

    expected_features = ARTIFACTS["meta"].get("feature_list")
    if not expected_features:
        raise RuntimeError("Model metadata is missing feature_list; refusing unsafe inference")
    model_features = getattr(ARTIFACTS["model"], "feature_names_in_", None)
    if model_features is not None and list(model_features) != expected_features:
        raise RuntimeError("Model and metadata feature order do not match")
    if ARTIFACTS["meta"].get("model_version", version) != version:
        raise RuntimeError("Model version does not match its metadata")

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
    if not MODEL_TOKEN:
        raise HTTPException(status_code=503, detail="ML_SERVICE_TOKEN is not configured")
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
    df["daily_return"] = df["Close"].pct_change(fill_method=None)

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
    df.loc[(loss == 0) & (gain > 0), "rsi"] = 100
    df.loc[(loss == 0) & (gain == 0), "rsi"] = 50

    # MACD
    fast, slow, sig = cfg["macd_fast"], cfg["macd_slow"], cfg["macd_signal"]
    ema_fast = df["Close"].ewm(span=fast, adjust=False).mean()
    ema_slow = df["Close"].ewm(span=slow, adjust=False).mean()
    df["macd"]        = ema_fast - ema_slow
    df["macd_signal"] = df["macd"].ewm(span=sig, adjust=False).mean()
    df["macd_hist"]   = df["macd"] - df["macd_signal"]

    # Volatility and volume change
    df["volatility"]    = df["daily_return"].rolling(cfg["volatility_window"]).std()
    df["volume_change"] = df["Volume"].pct_change(cfg["volume_change_window"], fill_method=None)

    return df

# ── Schemas ──────────────────────────────────────────────────────
class PredictRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$")

class PredictResponse(BaseModel):
    symbol: str
    prediction: str           # UP | DOWN | SIDEWAYS
    probabilities: dict       # {UP: float, DOWN: float, SIDEWAYS: float}
    confidence: Optional[float]
    calibrated: bool
    model_version: str
    data_source: str
    last_data_date: Optional[str]
    horizon_days: int
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

    # ── Load price data from DB ──────────────────────────────────
    # Serve only approved real Yahoo Finance history.
    symbol_ns = req.symbol.upper().replace(".NS", "")
    supported_symbols = {str(symbol).upper().removesuffix(".NS") for symbol in CONFIG.get("symbols", [])}
    if supported_symbols and symbol_ns not in supported_symbols:
        raise HTTPException(422, f"Unsupported symbol: {symbol_ns}")

    if CONFIG.get("serving", {}).get("data_source", "db") != "db":
        raise HTTPException(503, "Serving is configured for a non-database source")
    try:
        db_url = get_database_url()
    except DatabaseConfigurationError as exc:
        raise HTTPException(503, str(exc)) from exc
    serving_cfg = CONFIG.get("serving", {})
    approved_source = serving_cfg.get("approved_data_source", "YFINANCE_NS")
    if approved_source != "YFINANCE_NS":
        raise HTTPException(503, "Serving is configured with an unsupported data source")
    adjustment = CONFIG.get("data", {}).get("adjustment", "auto")
    adjustment = "auto" if adjustment is True else "raw" if adjustment is False else str(adjustment).lower()
    if adjustment not in {"auto", "raw"}:
        raise HTTPException(503, "Configured price adjustment mode is invalid")
    try:
        import psycopg2
        with psycopg2.connect(db_url) as conn:
            df = pd.read_sql(
                "SELECT trade_date AS \"Date\", open AS \"Open\", high AS \"High\", "
                "low AS \"Low\", close AS \"Close\", volume AS \"Volume\", data_source, price_adjustment "
                "FROM historical_prices WHERE symbol=%s AND data_source=%s AND price_adjustment=%s ORDER BY trade_date",
                conn, params=(symbol_ns, approved_source, adjustment)
            )
        if "data_source" not in df.columns:
            raise ValueError("Historical price query did not return data_source")
        sources = sorted({str(source) for source in df["data_source"].dropna()})
        if not sources or sources != [approved_source] or len(df) == 0:
            raise HTTPException(503, "No approved Yahoo Finance price data is available")
        if "price_adjustment" not in df.columns or set(df["price_adjustment"].dropna().astype(str)) != {adjustment}:
            raise HTTPException(503, "Yahoo Finance price adjustment provenance is missing or inconsistent")
        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        latest_data_date = df["Date"].max()
        if pd.isna(latest_data_date):
            raise HTTPException(503, "Yahoo Finance price dates are unavailable")
        latest_date = latest_data_date.date()
        today_nse = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        max_age_days = int(serving_cfg.get("max_data_age_days", 7))
        if max_age_days < 0:
            raise HTTPException(503, "Configured data freshness limit is invalid")
        if latest_date > today_nse or (today_nse - latest_date).days > max_age_days:
            raise HTTPException(503, "Approved Yahoo Finance price data is stale")
        db_data_source = approved_source
    except HTTPException:
        raise
    except Exception as e:
        log.warning("DB load failed for %s (%s)", symbol_ns, type(e).__name__)
        raise HTTPException(503, "Historical approved Yahoo Finance price data is unavailable") from e

    required_columns = ["Date", "Open", "High", "Low", "Close", "Volume"]
    missing_columns = [column for column in required_columns if column not in df.columns]
    if missing_columns:
        raise HTTPException(422, f"Historical data is missing columns: {missing_columns}")
    df = df.replace([np.inf, -np.inf], np.nan).dropna(subset=required_columns)
    df = df[(df["Close"] > 0) & (df["Volume"] >= 0)]
    if df.empty or len(df) < 60:
        raise HTTPException(422, f"Not enough price data for {symbol_ns} (need ≥60 rows).")

    df_feat   = compute_features(df)
    valid_rows = df_feat.dropna(subset=["rsi"])
    if valid_rows.empty:
        raise HTTPException(422, "Price history is insufficient to calculate features")
    last_row  = valid_rows.iloc[-1]
    last_date = str(df["Date"].iloc[-1].date()) if "Date" in df.columns else None

    # Build feature vector
    if not features:
        raise HTTPException(503, "Model metadata has no feature list")
    missing = [name for name in features if name not in df_feat.columns]
    if missing:
        raise HTTPException(503, f"Feature mismatch: missing {missing}")
    X = pd.DataFrame([last_row[features]], columns=features)
    X = X.replace([np.inf, -np.inf], np.nan).fillna(0)

    # Predict
    class_names = model.classes_
    if hasattr(model, "predict_proba"):
        probs = model.predict_proba(X)[0]
        pred  = class_names[np.argmax(probs)]
        prob_dict = {label: round(float(probs[list(class_names).index(label)]), 4)
                     if label in class_names else 0.0 for label in ("UP", "DOWN", "SIDEWAYS")}
        calibrated = meta.get("calibrated", False)
        confidence = round(float(np.max(probs)), 4)
    else:
        pred      = model.predict(X)[0]
        prob_dict = {}
        calibrated = False
        confidence = None

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
        confidence    = confidence,
        calibrated    = calibrated,
        model_version = version,
        data_source   = db_data_source,
        last_data_date = last_date,
        horizon_days  = int(CONFIG["labels"]["horizon_days"]),
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
