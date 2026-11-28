import json
import sys
from pathlib import Path
from types import SimpleNamespace

import joblib
import numpy as np
import pandas as pd
import pytest
import yfinance as yf
from fastapi.testclient import TestClient

ML_DIR = Path(__file__).resolve().parents[1]
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

import train
import serve
from diagnostics import (
    chronological_validation_indices,
    engineer_experimental_feature_sets,
    evaluate_model,
    evaluate_uncalibrated_fold_ensemble,
    feature_data_quality,
    per_class_reliability,
    rolling_chronological_windows,
)


def sample_prices(rows=100):
    dates = pd.bdate_range("2024-01-01", periods=rows)
    close = 100 * np.exp(np.linspace(0, 0.2, rows) + 0.01 * np.sin(np.arange(rows) / 3))
    return pd.DataFrame({
        "Date": dates,
        "Open": close,
        "High": close * 1.01,
        "Low": close * 0.99,
        "Close": close,
        "Volume": np.arange(rows) * 1000 + 100_000,
    })


def test_training_and_serving_features_match():
    cfg = train.CONFIG["features"]
    prices = sample_prices()
    trained = train.compute_features(prices, cfg)
    served = serve.compute_features(prices)
    cols = ["daily_return", "rsi", "macd", "macd_signal", "macd_hist", "volatility", "volume_change"]
    cols += [f"ma_{w}_ratio" for w in cfg["moving_averages"]]
    pd.testing.assert_frame_equal(trained[cols], served[cols])


def test_labels_use_forward_returns_and_drop_incomplete_horizon():
    frame = pd.DataFrame({"Close": [100, 103, 97, 100, 105, 90]})
    result = train.add_labels(frame, h=2, up=0.02, down=-0.02)
    assert result["label"].tolist() == ["DOWN", "DOWN", "UP", "DOWN"]
    assert len(result) == 4


def test_diagnostic_metrics_confusion_probability_and_stock_breakdown():
    class FixedProbabilityModel:
        classes_ = np.array(["DOWN", "SIDEWAYS", "UP"])

        def predict_proba(self, features):
            return np.array([
                [0.8, 0.1, 0.1],
                [0.1, 0.8, 0.1],
                [0.2, 0.5, 0.3],
                [0.2, 0.3, 0.5],
            ])[:len(features)]

        def predict(self, features):
            probabilities = self.predict_proba(features)
            return self.classes_[np.argmax(probabilities, axis=1)]

    y_true = np.array(["DOWN", "SIDEWAYS", "UP", "DOWN"])
    symbols = np.array(["AAA", "AAA", "BBB", "BBB"])
    result = evaluate_model(
        FixedProbabilityModel(), pd.DataFrame({"feature": [0, 1, 2, 3]}), y_true, symbols
    )

    assert result["accuracy"] == 0.5
    assert result["true_class_counts"] == {"DOWN": 2, "SIDEWAYS": 1, "UP": 1}
    assert result["predicted_class_counts"] == {"DOWN": 1, "SIDEWAYS": 2, "UP": 1}
    assert result["confusion_matrix"]["rows_actual_columns_predicted"] == [
        [1, 0, 1], [0, 1, 0], [0, 1, 0]
    ]
    assert result["per_class"]["DOWN"]["recall"] == 0.5
    assert result["per_class"]["SIDEWAYS"]["recall"] == 1.0
    assert result["per_class"]["UP"]["recall"] == 0.0
    assert result["probability_distributions"]["overall_by_predicted_class"]["UP"]["mean"] == 0.25
    conditional = result["probability_distributions"]["mean_probability_by_actual_class"]
    assert conditional["DOWN"]["DOWN"] == pytest.approx(0.5)
    assert conditional["DOWN"]["SIDEWAYS"] == pytest.approx(0.2)
    assert result["per_stock"]["AAA"]["accuracy"] == 1.0
    assert result["per_stock"]["BBB"]["accuracy"] == 0.0
    assert np.isfinite(result["log_loss"])

    folded_model = SimpleNamespace(calibrated_classifiers_=[
        SimpleNamespace(estimator=FixedProbabilityModel()),
        SimpleNamespace(estimator=FixedProbabilityModel()),
    ])
    raw_folded = evaluate_uncalibrated_fold_ensemble(
        folded_model,
        pd.DataFrame({"feature": [0, 1, 2, 3]}),
        y_true,
        symbols,
    )
    assert raw_folded["predicted_class_counts"] == result["predicted_class_counts"]


def test_chronological_validation_split_purges_horizon_dates():
    dates = np.repeat(pd.bdate_range("2024-01-01", periods=30).to_numpy(), 2)
    fit, validation, details = chronological_validation_indices(
        dates, horizon=3, validation_ratio=0.2
    )
    fit_dates = pd.to_datetime(dates[fit])
    validation_dates = pd.to_datetime(dates[validation])
    assert fit_dates.max() < validation_dates.min()
    assert len(set(pd.to_datetime(dates)) - set(fit_dates) - set(validation_dates)) == 3
    assert details["purged_unique_dates"] == 3
    assert len(fit) == 42
    assert len(validation) == 12


def test_rolling_chronological_windows_expand_and_purge_five_dates():
    dates = np.repeat(pd.bdate_range("2020-01-01", periods=60).to_numpy(), 3)
    windows = rolling_chronological_windows(
        dates, horizon=5, n_windows=3, initial_train_ratio=0.4
    )
    assert len(windows) == 3
    full_dates = pd.to_datetime(dates)
    previous_validation_end = None
    previous_fit_size = 0
    for window in windows:
        fit_dates = full_dates[window["fit_indices"]]
        validation_dates = full_dates[window["validation_indices"]]
        assert len(window["purged_unique_dates"]) == 5
        assert fit_dates.max() < pd.Timestamp(window["purged_unique_dates"][0])
        assert validation_dates.min() > pd.Timestamp(window["purged_unique_dates"][-1])
        assert fit_dates.max() < validation_dates.min()
        assert len(window["fit_indices"]) > previous_fit_size
        if previous_validation_end is not None:
            assert pd.Timestamp(window["purged_unique_dates"][0]) > previous_validation_end
        previous_validation_end = validation_dates.max()
        previous_fit_size = len(window["fit_indices"])


def test_rolling_chronological_windows_require_enough_dates():
    dates = pd.bdate_range("2024-01-01", periods=12)
    with pytest.raises(ValueError, match="Not enough unique dates"):
        rolling_chronological_windows(dates, horizon=5, n_windows=3)


def test_experimental_features_are_aligned_past_only_and_have_expected_sizes():
    dates = pd.bdate_range("2020-01-01", periods=65)
    price_rows = []
    for symbol_index, symbol in enumerate(("AAA", "BBB")):
        for index, date in enumerate(dates):
            close = 80 + symbol_index * 25 + index * 0.15 + np.sin(index / 4)
            price_rows.append({
                "Date": date, "symbol": symbol, "High": close * 1.01,
                "Low": close * 0.99, "Close": close,
            })
    raw = pd.DataFrame(price_rows)
    row_keys = [(date, symbol) for date in dates[25:] for symbol in ("AAA", "BBB")]
    row_dates = np.array([date for date, _ in row_keys])
    row_symbols = np.array([symbol for _, symbol in row_keys])
    base_columns = [
        "daily_return", "rsi", "macd", "macd_signal", "macd_hist", "volatility",
        "volume_change", "ma_5_ratio", "ma_10_ratio", "ma_20_ratio", "ma_50_ratio",
    ]
    base = pd.DataFrame(np.arange(len(row_keys) * len(base_columns)).reshape(len(row_keys), -1), columns=base_columns)
    config = {
        "macd_fast": 12, "macd_slow": 26, "macd_signal": 9,
    }
    feature_sets = engineer_experimental_feature_sets(base, row_dates, row_symbols, raw, config)
    assert list(feature_sets) == [
        "existing_11", "normalized_macd", "simplified_macd", "market_relative",
        "additional_technical", "combined_normalized_market_technical",
    ]
    assert [len(matrix.columns) for matrix in feature_sets.values()] == [11, 11, 10, 15, 16, 20]
    assert all(np.isfinite(matrix.to_numpy(dtype=float)).all() for matrix in feature_sets.values())
    relative = feature_sets["market_relative"]["relative_return_1d"].to_numpy().reshape(-1, 2)
    np.testing.assert_allclose(relative[1:].mean(axis=1), 0.0, atol=1e-12)

    changed_future = raw.copy()
    future_mask = changed_future["Date"] >= dates[50]
    changed_future.loc[future_mask, ["High", "Low", "Close"]] *= 1.7
    changed_sets = engineer_experimental_feature_sets(
        base, row_dates, row_symbols, changed_future, config
    )
    before_pivot = pd.to_datetime(row_dates) < dates[50]
    for feature_set in feature_sets:
        np.testing.assert_allclose(
            feature_sets[feature_set].loc[before_pivot].to_numpy(),
            changed_sets[feature_set].loc[before_pivot].to_numpy(),
            rtol=0,
            atol=1e-12,
        )


def test_experimental_features_reject_raw_prices_after_training_endpoint():
    dates = pd.bdate_range("2020-01-01", periods=3)
    rows = pd.DataFrame({"Date": dates, "symbol": ["AAA"] * 3,
                         "High": [2, 3, 4], "Low": [1, 2, 3], "Close": [1.5, 2.5, 3.5]})
    base = pd.DataFrame({name: [1.0] for name in (
        "daily_return", "rsi", "macd", "macd_signal", "macd_hist", "volatility",
        "volume_change", "ma_5_ratio", "ma_10_ratio", "ma_20_ratio", "ma_50_ratio",
    )})
    with pytest.raises(ValueError, match="bounded by the labeled training endpoint"):
        engineer_experimental_feature_sets(
            base, dates[:1], ["AAA"], rows,
            {"macd_fast": 2, "macd_slow": 3, "macd_signal": 2},
        )


def test_per_class_reliability_returns_expected_binary_metrics_and_bins():
    y_true = np.array(["DOWN", "SIDEWAYS", "UP"] * 4)
    probabilities = np.tile([0.7, 0.2, 0.1], (len(y_true), 1))
    result = per_class_reliability(y_true, probabilities, n_bins=5)
    down = result["per_class"]["DOWN"]
    assert down["support_positive"] == 4
    assert down["support_negative"] == 8
    assert down["brier_score"] == pytest.approx(((1 - 0.7) ** 2 + 2 * 0.7**2) / 3)
    assert down["reliability_diagram"]["binning"] == "5 equal-width probability bins"
    assert sum(item["count"] for item in down["reliability_diagram"]["bins"]) == len(y_true)
    assert result["macro_brier_score"] >= 0
    assert result["multiclass_brier_score"] >= 0


def test_per_class_reliability_rejects_invalid_multiclass_probabilities():
    with pytest.raises(ValueError, match="sum to one"):
        per_class_reliability(
            np.array(["DOWN"]), np.array([[0.5, 0.5, 0.5]])
        )


def test_feature_data_quality_detects_missing_constant_and_correlated_features():
    values = pd.DataFrame({
        "trend": [1.0, 2.0, 3.0, 4.0],
        "trend_scaled": [2.0, 4.0, 6.0, 8.0],
        "constant": [7.0, 7.0, 7.0, 7.0],
        "with_missing": [1.0, np.nan, 3.0, 4.0],
    })
    report = feature_data_quality(values)
    assert report["features"]["constant"]["near_constant"] is True
    assert report["features"]["with_missing"]["missing_count"] == 1
    assert report["features"]["trend"]["maximum_absolute_correlation"] == pytest.approx(1.0)
    assert any(
        {pair["feature_a"], pair["feature_b"]} == {"trend", "trend_scaled"}
        for pair in report["highly_correlated_pairs"]
    )


def test_yahoo_failure_stops_training_with_rate_limit_context(monkeypatch):
    calls = []

    class FailingTicker:
        def __init__(self, symbol):
            self.symbol = symbol

        def history(self, **kwargs):
            calls.append((self.symbol, kwargs))
            raise RuntimeError("HTTP 429 Too Many Requests")

    config = {
        "symbols": ["RELIANCE.NS", "TCS.NS"],
        "data": {
            "source": "yfinance",
            "start_date": "2020-01-01",
            "end_date": "2021-01-01",
            "adjustment": "auto",
            "request_delay_seconds": 0,
        },
    }
    monkeypatch.setattr(yf, "Ticker", FailingTicker)
    monkeypatch.setattr(yf.config.debug, "hide_exceptions", True)
    monkeypatch.setattr(train, "_generate_synthetic", lambda *_args, **_kwargs: pytest.fail("synthetic fallback called"))

    with pytest.raises(RuntimeError, match=r"rate-limited RELIANCE\.NS \(HTTP 429\); stopping training"):
        train.load_data(config)

    assert len(calls) == 1
    assert "raise_errors" not in calls[0][1]
    assert yf.config.debug.hide_exceptions is False


def test_yahoo_downloads_use_raise_errors_and_configured_delay(monkeypatch):
    calls = []
    delays = []

    class SuccessfulTicker:
        def __init__(self, symbol):
            self.symbol = symbol

        def history(self, **kwargs):
            calls.append((self.symbol, kwargs))
            index = pd.DatetimeIndex(["2024-01-02"], name="Date")
            return pd.DataFrame({
                "Open": [10.0], "High": [11.0], "Low": [9.0], "Close": [10.5], "Volume": [100]
            }, index=index)

    config = {
        "symbols": ["RELIANCE.NS", "TCS.NS"],
        "data": {
            "source": "yfinance",
            "start_date": "2020-01-01",
            "end_date": "2021-01-01",
            "adjustment": "auto",
            "request_delay_seconds": 0.25,
        },
    }
    monkeypatch.setattr(yf, "Ticker", SuccessfulTicker)
    monkeypatch.setattr(yf.config.debug, "hide_exceptions", True)
    monkeypatch.setattr(train.time, "sleep", delays.append)

    downloaded = train.load_data(config)

    assert [symbol for symbol, _ in calls] == config["symbols"]
    assert all("raise_errors" not in kwargs for _, kwargs in calls)
    assert yf.config.debug.hide_exceptions is False
    assert delays == [0.25]
    assert {"Date", "Open", "High", "Low", "Close", "Volume"}.issubset(downloaded.columns)


def test_train_saves_loadable_model_and_metadata(tmp_path, monkeypatch):
    cfg = json.loads(json.dumps(train.CONFIG))
    cfg["data"]["source"] = "synthetic"
    cfg["data"]["start_date"] = "2020-01-01"
    cfg["data"]["end_date"] = "2023-12-31"
    cfg["split"]["test_ratio"] = 0.2
    cfg["model"]["n_estimators"] = 8
    cfg["model"]["min_samples_leaf"] = 2
    cfg["calibration"]["enabled"] = True
    monkeypatch.setattr(train, "CONFIG", cfg)
    monkeypatch.setattr(train, "MODEL_DIR", tmp_path)
    monkeypatch.setattr(train, "VERSION", "test")
    monkeypatch.setattr(train, "SEED", 7)
    train.main()
    model_path = tmp_path / "model_test.joblib"
    metadata_path = tmp_path / "meta_test.json"
    model = joblib.load(model_path)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert list(model.feature_names_in_) == metadata["feature_list"]
    assert metadata["data_source"] == "SYNTHETIC_SAMPLE"
    assert metadata["calibrated"] is True
    assert metadata["feature_importances"]
    assert metadata["train_end"] < metadata["test_start"]
    assert (tmp_path / "MODEL_CARD.md").exists()


def test_prediction_requires_database_data_by_default(monkeypatch):
    monkeypatch.setattr(serve, "MODEL_LOADED", True)
    monkeypatch.setattr(serve, "MODEL_TOKEN", "test-token")
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setattr(serve, "ARTIFACTS", {"model": object(), "meta": {}, "version": "test"})
    monkeypatch.setitem(serve.CONFIG, "serving", {"data_source": "db", "allow_synthetic_fallback": False})
    client = TestClient(serve.app)
    response = client.post("/predict", headers={"X-Service-Token": "test-token"}, json={"symbol": "RELIANCE"})
    assert response.status_code == 503
    assert response.json()["detail"] == "DATABASE_URL is not configured"


def test_prediction_response_has_ordered_probabilities_and_confidence(monkeypatch):
    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class FakeModel:
        classes_ = np.array(["DOWN", "SIDEWAYS", "UP"])

        def predict_proba(self, _features):
            return np.array([[0.2, 0.3, 0.5]])

    monkeypatch.setattr(serve, "MODEL_LOADED", True)
    monkeypatch.setattr(serve, "MODEL_TOKEN", "test-token")
    columns = ["daily_return", "rsi", "macd", "macd_signal", "macd_hist", "volatility", "volume_change"]
    columns += [f"ma_{w}_ratio" for w in serve.CONFIG["features"]["moving_averages"]]
    monkeypatch.setattr(serve, "ARTIFACTS", {
        "model": FakeModel(), "version": "test", "meta": {"feature_list": columns, "calibrated": True}
    })
    monkeypatch.setitem(serve.CONFIG, "serving", {"data_source": "db", "allow_synthetic_fallback": False})
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setitem(sys.modules, "psycopg2", type("Psycopg", (), {"connect": staticmethod(lambda _url: FakeConnection())})())
    prices = sample_prices()
    prices["Date"] = pd.bdate_range(end=pd.Timestamp.now(tz="Asia/Kolkata").date(), periods=len(prices))
    prices["data_source"] = "YFINANCE_NS"
    prices["price_adjustment"] = "auto"
    monkeypatch.setattr(pd, "read_sql", lambda *_args, **_kwargs: prices)
    client = TestClient(serve.app)
    response = client.post("/predict", headers={"X-Service-Token": "test-token"}, json={"symbol": "RELIANCE"})
    assert response.status_code == 200
    body = response.json()
    assert body["prediction"] == "UP"
    assert body["probabilities"] == {"UP": 0.5, "DOWN": 0.2, "SIDEWAYS": 0.3}
    assert body["confidence"] == 0.5
    assert body["data_source"] == "YFINANCE_NS"
    assert body["horizon_days"] == 5
    assert body["last_data_date"] == prices["Date"].max().date().isoformat()


@pytest.mark.parametrize("source, age_days", [("SYNTHETIC_SAMPLE", 0), ("YFINANCE_NS", 30)])
def test_prediction_rejects_unapproved_or_stale_database_rows(monkeypatch, source, age_days):
    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class FakeModel:
        classes_ = np.array(["DOWN", "SIDEWAYS", "UP"])

        def predict_proba(self, _features):
            return np.array([[0.2, 0.3, 0.5]])

    monkeypatch.setattr(serve, "MODEL_LOADED", True)
    monkeypatch.setattr(serve, "MODEL_TOKEN", "test-token")
    columns = ["daily_return", "rsi", "macd", "macd_signal", "macd_hist", "volatility", "volume_change"]
    columns += [f"ma_{w}_ratio" for w in serve.CONFIG["features"]["moving_averages"]]
    monkeypatch.setattr(serve, "ARTIFACTS", {
        "model": FakeModel(), "version": "test", "meta": {"feature_list": columns}
    })
    monkeypatch.setitem(serve.CONFIG, "serving", {
        "data_source": "db", "allow_synthetic_fallback": True,
        "approved_data_source": "YFINANCE_NS", "max_data_age_days": 7,
    })
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setitem(sys.modules, "psycopg2", type("Psycopg", (), {"connect": staticmethod(lambda _url: FakeConnection())})())
    prices = sample_prices()
    prices["Date"] = pd.bdate_range(end=(pd.Timestamp.now(tz="Asia/Kolkata").date() - pd.Timedelta(days=age_days)), periods=len(prices))
    prices["data_source"] = source
    prices["price_adjustment"] = "auto"
    monkeypatch.setattr(pd, "read_sql", lambda *_args, **_kwargs: prices)

    client = TestClient(serve.app)
    response = client.post("/predict", headers={"X-Service-Token": "test-token"}, json={"symbol": "RELIANCE"})
    assert response.status_code == 503
    assert "approved Yahoo Finance" in response.json()["detail"] or "stale" in response.json()["detail"]


def test_invalid_symbol_is_rejected(monkeypatch):
    monkeypatch.setattr(serve, "MODEL_TOKEN", "test-token")
    client = TestClient(serve.app)
    response = client.post("/predict", headers={"X-Service-Token": "test-token"}, json={"symbol": "RELIANCE;DROP"})
    assert response.status_code == 422
