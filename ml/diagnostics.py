"""Read-only model comparison helpers for prediction-collapse diagnostics."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.calibration import CalibratedClassifierCV
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    log_loss,
    recall_score,
)
from sklearn.model_selection import TimeSeriesSplit
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


CLASS_ORDER = ("DOWN", "SIDEWAYS", "UP")


def _counts(values, labels=CLASS_ORDER) -> dict[str, int]:
    return {label: int(np.sum(np.asarray(values) == label)) for label in labels}


def _probability_summary(y_true, probabilities, labels=CLASS_ORDER) -> dict:
    quantiles = (0.0, 0.05, 0.25, 0.5, 0.75, 0.95, 1.0)
    quantile_names = ("min", "p05", "p25", "median", "p75", "p95", "max")
    overall = {}
    conditional = {}
    y_true = np.asarray(y_true)
    for index, label in enumerate(labels):
        values = probabilities[:, index]
        overall[label] = {
            "mean": float(np.mean(values)),
            "std": float(np.std(values)),
            **{
                name: float(value)
                for name, value in zip(quantile_names, np.quantile(values, quantiles))
            },
        }
    for actual in labels:
        mask = y_true == actual
        conditional[actual] = {
            predicted: float(np.mean(probabilities[mask, index])) if np.any(mask) else None
            for index, predicted in enumerate(labels)
        }
    return {"overall_by_predicted_class": overall, "mean_probability_by_actual_class": conditional}


def evaluate_predictions(y_true, predictions, probabilities, labels=CLASS_ORDER) -> dict:
    """Return comparable classification and probability diagnostics."""
    y_true = np.asarray(y_true, dtype=str)
    predictions = np.asarray(predictions, dtype=str)
    probabilities = np.asarray(probabilities, dtype=float)
    labels = tuple(labels)
    if y_true.ndim != 1 or predictions.shape != y_true.shape:
        raise ValueError("y_true and predictions must be one-dimensional arrays of equal length")
    if probabilities.shape != (len(y_true), len(labels)):
        raise ValueError("probabilities must have one column per configured label")
    if len(y_true) == 0 or not np.isfinite(probabilities).all():
        raise ValueError("diagnostics require non-empty data and finite probabilities")
    if (probabilities < 0).any() or (probabilities > 1).any():
        raise ValueError("probabilities must be between zero and one")

    report = classification_report(
        y_true, predictions, labels=list(labels), output_dict=True, zero_division=0
    )
    present_labels = [label for label in labels if np.any(y_true == label)]
    return {
        "rows": int(len(y_true)),
        "accuracy": float(accuracy_score(y_true, predictions)),
        "macro_f1": float(f1_score(y_true, predictions, labels=list(labels), average="macro", zero_division=0)),
        "balanced_accuracy": float(recall_score(
            y_true, predictions, labels=present_labels, average="macro", zero_division=0
        )),
        "log_loss": float(log_loss(y_true, probabilities, labels=list(labels))),
        "true_class_counts": _counts(y_true, labels),
        "predicted_class_counts": _counts(predictions, labels),
        "confusion_matrix": {
            "labels_in_row_and_column_order": list(labels),
            "rows_actual_columns_predicted": confusion_matrix(y_true, predictions, labels=list(labels)).tolist(),
        },
        "per_class": {
            label: {
                "precision": float(report[label]["precision"]),
                "recall": float(report[label]["recall"]),
                "f1": float(report[label]["f1-score"]),
                "support": int(report[label]["support"]),
            }
            for label in labels
        },
        "probability_distributions": _probability_summary(y_true, probabilities, labels),
    }


def _align_probabilities(probabilities_raw, model_classes, labels, row_count):
    probabilities = np.zeros((row_count, len(labels)), dtype=float)
    for source_index, label in enumerate(map(str, model_classes)):
        if label in labels:
            probabilities[:, labels.index(label)] = probabilities_raw[:, source_index]
    return probabilities


def _evaluate_outputs(y_true, predictions, probabilities, symbols, labels):
    results = evaluate_predictions(y_true, predictions, probabilities, labels)
    symbols = np.asarray(symbols, dtype=str)
    if symbols.shape != np.asarray(y_true).shape:
        raise ValueError("symbols must have one value per test row")
    results["per_stock"] = {}
    for symbol in sorted(set(symbols)):
        mask = symbols == symbol
        stock_results = evaluate_predictions(
            np.asarray(y_true)[mask], np.asarray(predictions)[mask], probabilities[mask], labels
        )
        stock_results.pop("probability_distributions")
        results["per_stock"][symbol] = stock_results
    return results


def evaluate_model(model, X, y_true, symbols, labels=CLASS_ORDER) -> dict:
    """Evaluate a fitted classifier and break out metrics by stock."""
    probabilities_raw = np.asarray(model.predict_proba(X), dtype=float)
    probabilities = _align_probabilities(
        probabilities_raw, model.classes_, labels, len(y_true)
    )
    predictions = np.asarray(model.predict(X), dtype=str)
    return _evaluate_outputs(y_true, predictions, probabilities, symbols, labels)


def evaluate_uncalibrated_fold_ensemble(calibrated_model, X, y_true, symbols, labels=CLASS_ORDER) -> dict:
    """Score the calibrated model's fitted fold estimators before calibration."""
    fold_probabilities = []
    for calibrated_classifier in calibrated_model.calibrated_classifiers_:
        estimator = getattr(
            calibrated_classifier,
            "estimator",
            getattr(calibrated_classifier, "base_estimator", None),
        )
        if estimator is None:
            raise ValueError("Cannot access a fitted base estimator in the calibrated model")
        probabilities = np.asarray(estimator.predict_proba(X), dtype=float)
        fold_probabilities.append(
            _align_probabilities(probabilities, estimator.classes_, labels, len(y_true))
        )
    mean_probabilities = np.mean(fold_probabilities, axis=0)
    predictions = np.asarray(labels)[np.argmax(mean_probabilities, axis=1)]
    return _evaluate_outputs(y_true, predictions, mean_probabilities, symbols, labels)


def chronological_validation_indices(row_dates, horizon: int, validation_ratio: float = 0.2):
    """Split a chronological training partition into fit and purged validation rows."""
    dates = pd.to_datetime(pd.Series(row_dates)).reset_index(drop=True)
    unique_dates = np.array(sorted(dates.drop_duplicates()))
    if horizon < 1 or not 0 < validation_ratio < 1:
        raise ValueError("horizon must be positive and validation_ratio must be between zero and one")
    validation_start_index = int(len(unique_dates) * (1 - validation_ratio))
    fit_end_index = validation_start_index - horizon
    if fit_end_index <= 0 or validation_start_index >= len(unique_dates):
        raise ValueError("Not enough dates for the purged chronological validation split")

    fit_end_date = unique_dates[fit_end_index]
    validation_start_date = unique_dates[validation_start_index]
    fit_indices = np.flatnonzero((dates < fit_end_date).to_numpy())
    validation_indices = np.flatnonzero((dates >= validation_start_date).to_numpy())
    if not len(fit_indices) or not len(validation_indices):
        raise ValueError("Chronological validation split produced an empty partition")
    return fit_indices, validation_indices, {
        "fit_end_exclusive": str(pd.Timestamp(fit_end_date).date()),
        "validation_start": str(pd.Timestamp(validation_start_date).date()),
        "purged_unique_dates": int(validation_start_index - fit_end_index),
        "validation_ratio_by_unique_dates": float(validation_ratio),
    }


def rolling_chronological_windows(
    row_dates, horizon: int, n_windows: int = 3, initial_train_ratio: float = 0.5,
) -> list[dict]:
    """Create expanding-window folds with a date-level purge before each validation block."""
    dates = pd.to_datetime(pd.Series(row_dates)).reset_index(drop=True)
    unique_dates = np.array(sorted(dates.drop_duplicates()))
    if horizon < 1 or n_windows < 3 or not 0 < initial_train_ratio < 1:
        raise ValueError("horizon must be positive, n_windows at least three, and initial_train_ratio between zero and one")
    initial_end = int(len(unique_dates) * initial_train_ratio)
    available = len(unique_dates) - initial_end - n_windows * horizon
    if initial_end < 1 or available < n_windows:
        raise ValueError("Not enough unique dates for rolling windows and the configured purge gaps")
    base_length, remainder = divmod(available, n_windows)
    windows = []
    cursor = initial_end
    for index in range(n_windows):
        validation_length = base_length + (1 if index < remainder else 0)
        validation_start_index = cursor + horizon
        validation_end_index = validation_start_index + validation_length
        fit_cutoff = unique_dates[cursor]
        validation_start = unique_dates[validation_start_index]
        validation_end_exclusive = (
            unique_dates[validation_end_index]
            if validation_end_index < len(unique_dates) else None
        )
        fit_indices = np.flatnonzero((dates < fit_cutoff).to_numpy())
        gap_indices = np.flatnonzero(
            ((dates >= fit_cutoff) & (dates < validation_start)).to_numpy()
        )
        validation_mask = dates >= validation_start
        if validation_end_exclusive is not None:
            validation_mask &= dates < validation_end_exclusive
        validation_indices = np.flatnonzero(validation_mask.to_numpy())
        if not len(fit_indices) or not len(validation_indices):
            raise ValueError("Rolling chronological split produced an empty fit or validation partition")
        gap_dates = sorted(pd.to_datetime(dates.iloc[gap_indices]).drop_duplicates())
        if len(gap_dates) != horizon:
            raise ValueError("Rolling split failed to preserve the exact date-level purge gap")
        windows.append({
            "window": index + 1,
            "fit_indices": fit_indices,
            "validation_indices": validation_indices,
            "fit_end_exclusive": str(pd.Timestamp(fit_cutoff).date()),
            "purged_unique_dates": [str(pd.Timestamp(day).date()) for day in gap_dates],
            "validation_start": str(pd.Timestamp(validation_start).date()),
            "validation_end": str(pd.Timestamp(dates.iloc[validation_indices].max()).date()),
            "validation_rows": int(len(validation_indices)),
            "fit_rows": int(len(fit_indices)),
        })
        cursor = validation_end_index
    return windows


def _mean_std(values) -> dict:
    values = np.asarray(values, dtype=float)
    return {
        "mean": float(np.mean(values)),
        "std_population": float(np.std(values, ddof=0)),
        "min": float(np.min(values)),
        "max": float(np.max(values)),
    }


def _rolling_metric_summary(window_results: list[dict], labels=CLASS_ORDER) -> dict:
    metrics = ("macro_f1", "balanced_accuracy", "log_loss")
    summary = {metric: _mean_std([result[metric] for result in window_results]) for metric in metrics}
    summary["per_class"] = {
        label: {
            metric: _mean_std([result["per_class"][label][metric] for result in window_results])
            for metric in ("precision", "recall", "f1")
        }
        for label in labels
    }
    summary["predicted_class_counts"] = {
        label: _mean_std([result["predicted_class_counts"][label] for result in window_results])
        for label in labels
    }
    return summary


def engineer_experimental_feature_sets(
    base_features: pd.DataFrame,
    row_dates,
    row_symbols,
    raw_prices: pd.DataFrame,
    feature_config: dict,
) -> dict[str, pd.DataFrame]:
    """Build experimental features using each symbol's current and historical prices only."""
    dates = pd.to_datetime(pd.Series(row_dates)).reset_index(drop=True)
    symbols = np.asarray(row_symbols, dtype=str)
    if len(base_features) != len(dates) or len(symbols) != len(dates):
        raise ValueError("base feature rows, dates, and symbols must have matching lengths")
    required = {"Date", "symbol", "High", "Low", "Close"}
    missing_columns = sorted(required - set(raw_prices.columns))
    if missing_columns:
        raise ValueError(f"raw price data is missing columns: {missing_columns}")
    raw = raw_prices.copy()
    raw["Date"] = pd.to_datetime(raw["Date"])
    raw["symbol"] = raw["symbol"].astype(str)
    if raw.empty or raw["Date"].max() > dates.max():
        raise ValueError("raw price rows must be non-empty and bounded by the labeled training endpoint")

    fast, slow, signal = (
        int(feature_config["macd_fast"]), int(feature_config["macd_slow"]),
        int(feature_config["macd_signal"]),
    )
    derived_frames = []
    for symbol, group in raw.groupby("symbol", sort=False):
        group = group.sort_values("Date").copy()
        close = pd.to_numeric(group["Close"], errors="coerce")
        high = pd.to_numeric(group["High"], errors="coerce")
        low = pd.to_numeric(group["Low"], errors="coerce")
        macd = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
        macd_signal = macd.ewm(span=signal, adjust=False).mean()
        daily_return = close.pct_change(fill_method=None)
        momentum_5 = close.pct_change(5, fill_method=None)
        momentum_20 = close.pct_change(20, fill_method=None)
        previous_close = close.shift(1)
        true_range = pd.concat(
            [(high - low), (high - previous_close).abs(), (low - previous_close).abs()],
            axis=1,
        ).max(axis=1)
        atr_14_pct = true_range.rolling(14, min_periods=14).mean() / close.replace(0, np.nan)
        mean_20 = close.rolling(20, min_periods=20).mean()
        std_20 = close.rolling(20, min_periods=20).std(ddof=0)
        bollinger_position = (close - mean_20) / (2 * std_20.replace(0, np.nan))
        bollinger_width = (4 * std_20) / mean_20.replace(0, np.nan)
        feature_rows = pd.DataFrame({
            "Date": group["Date"].to_numpy(),
            "symbol": symbol,
            "macd_norm": macd.to_numpy() / close.replace(0, np.nan).to_numpy(),
            "macd_signal_norm": macd_signal.to_numpy() / close.replace(0, np.nan).to_numpy(),
            "macd_hist_norm": (macd - macd_signal).to_numpy() / close.replace(0, np.nan).to_numpy(),
            "momentum_5": momentum_5.to_numpy(),
            "momentum_20": momentum_20.to_numpy(),
            "atr_14_pct": atr_14_pct.to_numpy(),
            "bollinger_position_20": bollinger_position.to_numpy(),
            "bollinger_width_20": bollinger_width.to_numpy(),
            "stock_return_1d": daily_return.to_numpy(),
        })
        derived_frames.append(feature_rows)
    derived = pd.concat(derived_frames, ignore_index=True)

    basket = (
        derived.groupby("Date", as_index=False)["stock_return_1d"]
        .mean()
        .rename(columns={"stock_return_1d": "market_return_1d"})
        .sort_values("Date")
        .reset_index(drop=True)
    )
    basket["market_momentum_5"] = (
        (1 + basket["market_return_1d"]).rolling(5, min_periods=5).apply(np.prod, raw=True) - 1
    )
    basket["market_volatility_20"] = basket["market_return_1d"].rolling(20, min_periods=20).std(ddof=0)
    derived = derived.merge(basket, on="Date", how="left", validate="many_to_one")
    derived["relative_return_1d"] = derived["stock_return_1d"] - derived["market_return_1d"]
    derived["relative_momentum_5"] = derived["momentum_5"] - derived["market_momentum_5"]

    keys = pd.DataFrame({"Date": dates, "symbol": symbols, "_row_order": np.arange(len(dates))})
    aligned = keys.merge(derived, on=["Date", "symbol"], how="left", validate="one_to_one")
    if aligned["_row_order"].tolist() != list(range(len(keys))):
        raise ValueError("experimental features could not be aligned to the training rows")
    aligned = aligned.drop(columns=["_row_order", "Date", "symbol"])
    base = base_features.reset_index(drop=True).copy()

    normalized_macd = base.drop(columns=["macd", "macd_signal", "macd_hist"]).copy()
    normalized_macd[["macd_norm", "macd_signal_norm", "macd_hist_norm"]] = aligned[
        ["macd_norm", "macd_signal_norm", "macd_hist_norm"]
    ]
    simplified_macd = base.drop(columns=["macd_signal"]).copy()
    market_relative = base.copy()
    market_columns = ["market_return_1d", "relative_return_1d", "market_volatility_20", "relative_momentum_5"]
    market_relative[market_columns] = aligned[market_columns]
    technical_extended = base.copy()
    technical_columns = [
        "momentum_5", "momentum_20", "atr_14_pct",
        "bollinger_position_20", "bollinger_width_20",
    ]
    technical_extended[technical_columns] = aligned[technical_columns]
    combined = normalized_macd.copy()
    combined[market_columns + technical_columns] = aligned[market_columns + technical_columns]

    sets = {
        "existing_11": base,
        "normalized_macd": normalized_macd,
        "simplified_macd": simplified_macd,
        "market_relative": market_relative,
        "additional_technical": technical_extended,
        "combined_normalized_market_technical": combined,
    }
    cleaned = {}
    for name, matrix in sets.items():
        matrix = matrix.replace([np.inf, -np.inf], np.nan)
        cleaned[name] = matrix.fillna(0)
    return cleaned


def run_feature_engineering_investigation(
    *, estimator, base_features, y_train, train_dates, train_symbols,
    raw_prices: pd.DataFrame, feature_config: dict, config: dict,
    data_source: str, raw_rows: int, train_dates_full: tuple[str, str],
    n_windows: int = 3, initial_train_ratio: float = 0.5,
) -> dict:
    """Compare experimental feature sets and both RF candidates on rolling validation only."""
    if data_source != "YFINANCE_NS":
        raise ValueError("Feature engineering investigation requires real Yahoo Finance data")
    matrices = engineer_experimental_feature_sets(
        base_features, train_dates, train_symbols, raw_prices, feature_config
    )
    horizon = int(config["labels"]["horizon_days"])
    windows = rolling_chronological_windows(
        train_dates, horizon, n_windows=n_windows,
        initial_train_ratio=initial_train_ratio,
    )
    labels = CLASS_ORDER
    y_values = np.asarray(y_train, dtype=str)
    symbols = np.asarray(train_symbols, dtype=str)
    model_config = config["model"]
    seed = int(model_config["random_state"])
    model_templates = {
        "configured_random_forest": clone(estimator),
        "deeper_random_forest": RandomForestClassifier(
            n_estimators=int(model_config["n_estimators"]),
            max_depth=None,
            min_samples_leaf=max(2, int(model_config["min_samples_leaf"]) // 2),
            class_weight=model_config["class_weight"],
            random_state=seed,
            n_jobs=int(model_config["n_jobs"]),
        ),
    }
    result_store = {
        feature_set: {model_name: [] for model_name in model_templates}
        for feature_set in matrices
    }
    window_reports = []
    feature_diagnostics = {}
    for feature_set, matrix in matrices.items():
        first_fit = windows[0]["fit_indices"]
        feature_diagnostics[feature_set] = {
            "feature_names": list(matrix.columns),
            "fit_window_quality": feature_data_quality(matrix.iloc[first_fit]),
            "non_finite_cells_after_preprocessing": int(
                (~np.isfinite(matrix.iloc[first_fit].to_numpy(dtype=float))).sum()
            ),
        }

    for spec in windows:
        fit_idx, val_idx = spec["fit_indices"], spec["validation_indices"]
        y_fit, y_val = y_values[fit_idx], y_values[val_idx]
        val_symbols = symbols[val_idx]
        counts = _class_distribution(y_fit, labels)
        absent = [label for label in labels if counts[label] == 0]
        if absent:
            raise ValueError(f"Rolling window {spec['window']} fit data is missing classes: {absent}")
        per_window_sets = {}
        for feature_set, matrix in matrices.items():
            X_fit, X_val = matrix.iloc[fit_idx], matrix.iloc[val_idx]
            per_window_sets[feature_set] = {}
            for model_name, template in model_templates.items():
                model = clone(template).fit(X_fit, y_fit)
                evaluation = evaluate_model(model, X_val, y_val, val_symbols, labels)
                result_store[feature_set][model_name].append(evaluation)
                per_window_sets[feature_set][model_name] = evaluation
        window_reports.append({
            "window": spec["window"],
            "fit_rows": spec["fit_rows"],
            "validation_rows": spec["validation_rows"],
            "fit_end_exclusive": spec["fit_end_exclusive"],
            "purged_unique_dates": spec["purged_unique_dates"],
            "validation_dates": {"start": spec["validation_start"], "end": spec["validation_end"]},
            "validation_class_counts": _class_distribution(y_val, labels),
            "feature_sets": per_window_sets,
        })

    summaries = {
        feature_set: {
            model_name: _rolling_metric_summary(model_results, labels)
            for model_name, model_results in models.items()
        }
        for feature_set, models in result_store.items()
    }
    per_stock_summary = {}
    for symbol in sorted(set(symbols)):
        per_stock_summary[symbol] = {}
        for feature_set, models in result_store.items():
            per_stock_summary[symbol][feature_set] = {}
            for model_name, evaluations in models.items():
                stock_windows = [item["per_stock"][symbol] for item in evaluations]
                per_stock_summary[symbol][feature_set][model_name] = {
                    metric: _mean_std([stock[metric] for stock in stock_windows])
                    for metric in ("macro_f1", "balanced_accuracy", "log_loss")
                }
                per_stock_summary[symbol][feature_set][model_name]["per_class"] = {
                    label: {
                        metric: _mean_std([stock["per_class"][label][metric] for stock in stock_windows])
                        for metric in ("precision", "recall", "f1")
                    }
                    for label in labels
                }

    import sklearn
    import sys
    import yfinance
    return {
        "diagnostic_type": "rolling_feature_engineering_investigation",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_source": data_source,
        "raw_download_rows": int(raw_rows),
        "outer_training_rows": int(len(base_features)),
        "outer_training_dates": {"start": train_dates_full[0], "end": train_dates_full[1]},
        "data_settings": {
            "start_date": config["data"]["start_date"],
            "end_date_exclusive": config["data"]["end_date"],
            "symbols": list(config["symbols"]),
            "auto_adjust": config["data"].get("adjustment", "auto") == "auto",
            "raw_price_snapshot_persisted": False,
        },
        "software_versions": {
            "python": sys.version.split()[0], "scikit_learn": sklearn.__version__,
            "numpy": np.__version__, "pandas": pd.__version__, "yfinance": yfinance.__version__,
        },
        "final_test_used": False,
        "final_test_note": "The feature diagnostic only receives raw price rows and labels through the outer training endpoint; final-test data are not passed for features, fitting, or scoring.",
        "split_method": "same expanding chronological windows and date-level purge as rolling_rf_validation_v1",
        "purge_gap_unique_dates": horizon,
        "n_windows": int(n_windows),
        "initial_train_ratio": float(initial_train_ratio),
        "model_definitions": {
            "configured_random_forest": _json_safe(model_templates["configured_random_forest"].get_params(deep=False)),
            "deeper_random_forest": _json_safe(model_templates["deeper_random_forest"].get_params(deep=False)),
        },
        "feature_sets": {
            "existing_11": "Current production feature matrix, unchanged.",
            "normalized_macd": "Replace raw MACD, signal, and histogram with each divided by contemporaneous Close.",
            "simplified_macd": "Remove MACD signal, which was highly correlated with MACD in the prior training-window audit.",
            "market_relative": "Add equal-weight configured-stock basket daily return, stock excess return, basket 20-session volatility, and 5-session excess momentum.",
            "additional_technical": "Add 5/20-session momentum, normalized 14-session ATR, and 20-session Bollinger position and width.",
            "combined_normalized_market_technical": "Combine normalized MACD, market-relative features, and the additional past-only technical indicators.",
        },
        "feature_data_quality_first_fit_window": feature_diagnostics,
        "windows": window_reports,
        "summary_across_windows": summaries,
        "per_stock_summary_across_windows": per_stock_summary,
        "leakage_controls": {
            "features_use_future_observations": False,
            "raw_prices_bounded_at_outer_training_endpoint": True,
            "negative_shifts_or_backfills_used": False,
            "labels_or_thresholds_changed": False,
            "market_proxy_definition": "Same-date equal-weight mean return across configured stocks; uses current-day closes only, with no future values.",
            "note": "The basket proxy assumes all configured stocks' current-day closes are available; it is diagnostic-only and does not alter serving features.",
        },
        "reproducibility": {"random_state": seed, "production_artifacts_written": False},
    }


def run_rolling_rf_validation(
    *, estimator, X_train, y_train, train_dates, train_symbols, config: dict,
    data_source: str, raw_rows: int, train_dates_full: tuple[str, str],
    n_windows: int = 3, initial_train_ratio: float = 0.5,
) -> dict:
    """Compare configured and deeper RF over purged rolling validation windows only."""
    import sklearn
    import sys
    import yfinance

    if data_source != "YFINANCE_NS":
        raise ValueError("Rolling RF validation requires real Yahoo Finance data")
    horizon = int(config["labels"]["horizon_days"])
    windows = rolling_chronological_windows(
        train_dates, horizon, n_windows=n_windows,
        initial_train_ratio=initial_train_ratio,
    )
    labels = CLASS_ORDER
    y_values = np.asarray(y_train, dtype=str)
    symbols = np.asarray(train_symbols, dtype=str)
    cfg = config["model"]
    seed = int(cfg["random_state"])
    deeper = RandomForestClassifier(
        n_estimators=int(cfg["n_estimators"]),
        max_depth=None,
        min_samples_leaf=max(2, int(cfg["min_samples_leaf"]) // 2),
        class_weight=cfg["class_weight"],
        random_state=seed,
        n_jobs=int(cfg["n_jobs"]),
    )
    candidates = {
        "configured_random_forest": clone(estimator),
        "deeper_random_forest": deeper,
    }
    results = {name: [] for name in candidates}
    window_reports = []
    for spec in windows:
        fit_idx, val_idx = spec["fit_indices"], spec["validation_indices"]
        X_fit, X_val = X_train.iloc[fit_idx], X_train.iloc[val_idx]
        y_fit, y_val = y_values[fit_idx], y_values[val_idx]
        val_symbols = symbols[val_idx]
        fit_counts = _class_distribution(y_fit, labels)
        missing_fit_classes = [label for label in labels if fit_counts[label] == 0]
        if missing_fit_classes:
            raise ValueError(
                f"Rolling window {spec['window']} fit data is missing classes: {missing_fit_classes}"
            )
        model_results = {}
        for name, prototype in candidates.items():
            model = clone(prototype).fit(X_fit, y_fit)
            result = evaluate_model(model, X_val, y_val, val_symbols, labels)
            results[name].append(result)
            model_results[name] = result
        window_reports.append({
            "window": spec["window"],
            "fit_rows": spec["fit_rows"],
            "validation_rows": spec["validation_rows"],
            "fit_end_exclusive": spec["fit_end_exclusive"],
            "purged_unique_dates": spec["purged_unique_dates"],
            "validation_dates": {
                "start": spec["validation_start"], "end": spec["validation_end"],
            },
            "fit_class_counts": fit_counts,
            "validation_class_counts": _class_distribution(y_val, labels),
            "models": model_results,
        })

    summaries = {name: _rolling_metric_summary(items, labels) for name, items in results.items()}
    metrics_to_compare = {
        "macro_f1": "higher_is_better",
        "balanced_accuracy": "higher_is_better",
        "log_loss": "lower_is_better",
    }
    metric_win_counts = {}
    for metric, direction in metrics_to_compare.items():
        base_values = [item[metric] for item in results["configured_random_forest"]]
        deeper_values = [item[metric] for item in results["deeper_random_forest"]]
        metric_win_counts[metric] = {
            "configured_wins": int(sum(
                b > d if direction == "higher_is_better" else b < d
                for b, d in zip(base_values, deeper_values)
            )),
            "deeper_wins": int(sum(
                d > b if direction == "higher_is_better" else d < b
                for b, d in zip(base_values, deeper_values)
            )),
            "ties": int(sum(b == d for b, d in zip(base_values, deeper_values))),
            "deeper_minus_configured_by_window": [float(d - b) for b, d in zip(base_values, deeper_values)],
        }

    per_stock = {}
    all_stocks = sorted(set(symbols))
    for symbol in all_stocks:
        per_stock[symbol] = {}
        for name, model_results in results.items():
            stock_windows = [result["per_stock"][symbol] for result in model_results]
            per_stock[symbol][name] = {
                metric: _mean_std([stock[metric] for stock in stock_windows])
                for metric in ("macro_f1", "balanced_accuracy", "log_loss")
            }
            per_stock[symbol][name]["per_class"] = {
                label: {
                    metric: _mean_std([stock["per_class"][label][metric] for stock in stock_windows])
                    for metric in ("precision", "recall", "f1")
                }
                for label in labels
            }

    return {
        "diagnostic_type": "rolling_chronological_random_forest_validation",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_source": data_source,
        "raw_download_rows": int(raw_rows),
        "outer_training_rows": int(len(X_train)),
        "outer_training_dates": {"start": train_dates_full[0], "end": train_dates_full[1]},
        "data_settings": {
            "configured_start_date": config["data"]["start_date"],
            "configured_end_date_exclusive": config["data"]["end_date"],
            "symbols": list(config["symbols"]),
            "auto_adjust": config["data"].get("adjustment", "auto") == "auto",
            "raw_price_snapshot_persisted": False,
            "snapshot_note": "Yahoo Finance may revise historical adjusted prices; exact raw download rows are not embedded in this report.",
        },
        "software_versions": {
            "python": sys.version.split()[0],
            "scikit_learn": sklearn.__version__,
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "yfinance": yfinance.__version__,
        },
        "final_test_used": False,
        "final_test_note": "Only the outer training partition was supplied to this diagnostic; final-test features and labels were not read for scoring or selection.",
        "labels": list(labels),
        "feature_names": list(X_train.columns),
        "split_method": "expanding chronological windows, purged by unique dates before each validation block",
        "purge_gap_unique_dates": horizon,
        "initial_train_ratio": float(initial_train_ratio),
        "windows": window_reports,
        "summary_across_windows": summaries,
        "metric_win_counts": metric_win_counts,
        "per_stock_summary_across_windows": per_stock,
        "model_definitions": {
            "configured_random_forest": _json_safe(estimator.get_params(deep=False)),
            "deeper_random_forest": _json_safe(deeper.get_params(deep=False)),
        },
        "reproducibility": {"random_state": seed, "n_windows": int(n_windows)},
        "production_artifacts_written": False,
    }


def per_class_reliability(y_true, probabilities, labels=CLASS_ORDER, n_bins: int = 10) -> dict:
    """Compute one-vs-rest reliability diagram points and calibration metrics."""
    y_true = np.asarray(y_true, dtype=str)
    probabilities = np.asarray(probabilities, dtype=float)
    if probabilities.shape != (len(y_true), len(labels)) or not len(y_true):
        raise ValueError("reliability inputs must be non-empty with one probability column per class")
    if n_bins < 2 or not np.isfinite(probabilities).all():
        raise ValueError("reliability requires finite probabilities and at least two bins")
    if (probabilities < 0).any() or (probabilities > 1).any():
        raise ValueError("reliability probabilities must be between zero and one")
    if not np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-6):
        raise ValueError("multiclass probabilities must sum to one for each row")
    unknown = sorted(set(y_true) - set(labels))
    if unknown:
        raise ValueError(f"y_true contains labels outside configured classes: {unknown}")

    edges = np.linspace(0.0, 1.0, n_bins + 1)
    per_class = {}
    brier_values = []
    for class_index, label in enumerate(labels):
        target = (y_true == label).astype(float)
        score = np.clip(probabilities[:, class_index], 1e-15, 1 - 1e-15)
        bins = []
        ece = 0.0
        max_error = 0.0
        for bin_index, (lower, upper) in enumerate(zip(edges[:-1], edges[1:])):
            in_bin = (score >= lower) & ((score < upper) if bin_index < n_bins - 1 else (score <= upper))
            count = int(in_bin.sum())
            if count:
                predicted_mean = float(np.mean(score[in_bin]))
                observed_rate = float(np.mean(target[in_bin]))
                error = abs(predicted_mean - observed_rate)
                ece += count / len(y_true) * error
                max_error = max(max_error, error)
            else:
                predicted_mean = None
                observed_rate = None
            bins.append({
                "lower": float(lower),
                "upper": float(upper),
                "count": count,
                "mean_predicted_probability": predicted_mean,
                "observed_positive_fraction": observed_rate,
            })
        brier = float(np.mean((probabilities[:, class_index] - target) ** 2))
        brier_values.append(brier)
        binary_logloss = float(np.mean(
            -(target * np.log(score) + (1 - target) * np.log(1 - score))
        ))
        per_class[label] = {
            "support_positive": int(target.sum()),
            "support_negative": int(len(target) - target.sum()),
            "brier_score": brier,
            "binary_log_loss": binary_logloss,
            "expected_calibration_error": float(ece),
            "maximum_calibration_error": float(max_error),
            "reliability_diagram": {"binning": f"{n_bins} equal-width probability bins", "bins": bins},
        }
    return {
        "per_class": per_class,
        "macro_brier_score": float(np.mean(brier_values)),
        "multiclass_brier_score": float(np.mean(np.sum(
            (probabilities - np.eye(len(labels))[np.array([labels.index(v) for v in y_true])]) ** 2,
            axis=1,
        ))),
    }


def _probability_ranking_changes(before, after, y_true, labels=CLASS_ORDER) -> dict:
    before = np.asarray(before, dtype=float)
    after = np.asarray(after, dtype=float)
    before_class = np.asarray(labels)[np.argmax(before, axis=1)]
    after_class = np.asarray(labels)[np.argmax(after, axis=1)]
    return {
        "changed_prediction_count": int(np.sum(before_class != after_class)),
        "changed_prediction_fraction": float(np.mean(before_class != after_class)),
        "prediction_transition_matrix": {
            "row_labels_before_column_labels_after": list(labels),
            "counts": confusion_matrix(before_class, after_class, labels=list(labels)).tolist(),
        },
        "mean_probability_delta_calibrated_minus_raw": {
            label: float(np.mean(after[:, index] - before[:, index]))
            for index, label in enumerate(labels)
        },
        "true_class_counts": _class_distribution(y_true, labels),
    }


def _calibrator_parameters(model) -> list[dict]:
    folds = []
    for fold_index, calibrated_classifier in enumerate(model.calibrated_classifiers_):
        fold = {"fold": fold_index + 1, "classes": {}}
        for label, calibrator in zip(model.classes_, calibrated_classifier.calibrators):
            if hasattr(calibrator, "a_") and hasattr(calibrator, "b_"):
                fold["classes"][str(label)] = {
                    "type": "sigmoid",
                    "a": float(np.asarray(calibrator.a_).reshape(-1)[0]),
                    "b": float(np.asarray(calibrator.b_).reshape(-1)[0]),
                }
            elif hasattr(calibrator, "X_thresholds_"):
                fold["classes"][str(label)] = {
                    "type": "isotonic",
                    "threshold_count": int(len(calibrator.X_thresholds_)),
                    "input_min": float(calibrator.X_thresholds_[0]),
                    "input_max": float(calibrator.X_thresholds_[-1]),
                    "output_min": float(calibrator.y_thresholds_[0]),
                    "output_max": float(calibrator.y_thresholds_[-1]),
                }
            else:
                fold["classes"][str(label)] = {"type": type(calibrator).__name__}
        folds.append(fold)
    return folds


def _time_series_fold_details(cv_splits, dates, y, labels=CLASS_ORDER) -> list[dict]:
    details = []
    dates = pd.Series(pd.to_datetime(dates)).reset_index(drop=True)
    y = np.asarray(y, dtype=str)
    for index, (train_index, calibration_index) in enumerate(cv_splits):
        details.append({
            "fold": index + 1,
            "fit_rows": int(len(train_index)),
            "calibration_rows": int(len(calibration_index)),
            "fit_date_start": str(dates.iloc[train_index].min().date()),
            "fit_date_end": str(dates.iloc[train_index].max().date()),
            "calibration_date_start": str(dates.iloc[calibration_index].min().date()),
            "calibration_date_end": str(dates.iloc[calibration_index].max().date()),
            "calibration_class_counts": _class_distribution(y[calibration_index], labels),
        })
    return details


def feature_data_quality(X_fit: pd.DataFrame, correlation_threshold: float = 0.95) -> dict:
    """Summarize feature missingness, spread, and strong linear correlations."""
    if X_fit.empty or not len(X_fit.columns):
        raise ValueError("feature diagnostics require a non-empty feature matrix")
    numeric = X_fit.apply(pd.to_numeric, errors="coerce")
    missing = numeric.isna().sum()
    non_finite = pd.Series(
        {column: int((~np.isfinite(numeric[column].dropna())).sum()) for column in numeric},
        dtype=int,
    )
    standard_deviation = numeric.std(ddof=0)
    corr = numeric.corr().abs()
    highly_correlated = []
    columns = list(corr.columns)
    for i, left in enumerate(columns):
        for right in columns[i + 1:]:
            value = corr.loc[left, right]
            if pd.notna(value) and value >= correlation_threshold:
                highly_correlated.append({
                    "feature_a": left,
                    "feature_b": right,
                    "absolute_correlation": float(value),
                })
    feature_stats = {
        column: {
            "missing_count": int(missing[column]),
            "missing_fraction": float(missing[column] / len(numeric)),
            "non_finite_count": int(non_finite[column]),
            "standard_deviation": float(standard_deviation[column]) if pd.notna(standard_deviation[column]) else None,
            "near_constant": bool(pd.isna(standard_deviation[column]) or standard_deviation[column] < 1e-12),
            "maximum_absolute_correlation": float(corr[column].drop(labels=[column]).max())
            if len(corr.columns) > 1 and corr[column].drop(labels=[column]).notna().any() else None,
        }
        for column in columns
    }
    return {
        "rows": int(len(numeric)),
        "features": feature_stats,
        "correlation_threshold": float(correlation_threshold),
        "highly_correlated_pairs": highly_correlated,
    }


def run_rf_performance_investigation(
    *, estimator, X_train, y_train, train_dates, train_symbols, config: dict,
    data_source: str, raw_rows: int, train_dates_full: tuple[str, str],
    validation_ratio: float = 0.2,
) -> dict:
    """Run reproducible model and feature diagnostics on purged validation only."""
    if data_source != "YFINANCE_NS":
        raise ValueError("Performance investigation requires real Yahoo Finance data")

    labels = CLASS_ORDER
    horizon = int(config["labels"]["horizon_days"])
    fit_idx, val_idx, split_details = chronological_validation_indices(
        train_dates, horizon, validation_ratio
    )
    X_fit, X_val = X_train.iloc[fit_idx], X_train.iloc[val_idx]
    y_all = np.asarray(y_train, dtype=str)
    y_fit, y_val = y_all[fit_idx], y_all[val_idx]
    fit_dates = pd.to_datetime(np.asarray(train_dates)[fit_idx])
    val_dates = pd.to_datetime(np.asarray(train_dates)[val_idx])
    val_symbols = np.asarray(train_symbols, dtype=str)[val_idx]
    fit_counts = _class_distribution(y_fit, labels)
    if any(fit_counts[label] == 0 for label in labels):
        raise ValueError("Validation fit segment is missing one or more classes")

    cfg = config["model"]
    seed = int(cfg["random_state"])
    base_params = {
        "n_estimators": int(cfg["n_estimators"]),
        "max_depth": cfg["max_depth"],
        "min_samples_leaf": int(cfg["min_samples_leaf"]),
        "random_state": seed,
        "n_jobs": int(cfg["n_jobs"]),
    }
    candidates = {
        "random_forest_configured": (
            clone(estimator),
            "Existing configured RF; unchanged parameters, uncalibrated.",
        ),
        "random_forest_balanced_subsample": (
            RandomForestClassifier(**base_params, class_weight="balanced_subsample"),
            "Same forest settings with per-bootstrap class balancing.",
        ),
        "random_forest_deeper_smaller_leaves": (
            RandomForestClassifier(
                **{**base_params, "max_depth": None, "min_samples_leaf": max(2, int(cfg["min_samples_leaf"]) // 2)},
                class_weight="balanced",
            ),
            "Exploratory capacity increase; validation-only comparison, not production tuning.",
        ),
        "extra_trees": (
            ExtraTreesClassifier(**base_params, class_weight="balanced"),
            "ExtraTrees alternative with the configured tree count, depth, leaf size, and seed.",
        ),
        "scaled_logistic_regression": (
            make_pipeline(
                StandardScaler(),
                LogisticRegression(
                    class_weight="balanced", max_iter=2000, random_state=seed,
                ),
            ),
            "Scaled multinomial linear baseline; scaler is fitted on the fit window only.",
        ),
    }
    candidate_results = {}
    fitted = {}
    for name, (model, description) in candidates.items():
        model.fit(X_fit, y_fit)
        fitted[name] = model
        candidate_results[name] = {
            "description": description,
            "parameters": _json_safe(model.get_params(deep=False)),
            "metrics": evaluate_model(model, X_val, y_val, val_symbols, labels),
        }

    reference = fitted["random_forest_configured"]
    impurity_importance = getattr(reference, "feature_importances_", None)
    impurity = (
        {name: float(value) for name, value in zip(X_fit.columns, impurity_importance)}
        if impurity_importance is not None else {}
    )
    permutation = permutation_importance(
        reference, X_val, y_val, scoring="f1_macro", n_repeats=3,
        random_state=seed, n_jobs=1,
    )
    permutation_importance_by_feature = {
        name: {
            "mean_macro_f1_decrease": float(mean),
            "std_macro_f1_decrease": float(std),
        }
        for name, mean, std in zip(
            X_fit.columns, permutation.importances_mean, permutation.importances_std
        )
    }

    ordered = sorted(
        candidate_results,
        key=lambda name: candidate_results[name]["metrics"]["macro_f1"],
        reverse=True,
    )
    return {
        "diagnostic_type": "chronological_random_forest_performance_investigation",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_source": data_source,
        "raw_download_rows": int(raw_rows),
        "outer_training_rows": int(len(X_train)),
        "outer_training_dates": {"start": train_dates_full[0], "end": train_dates_full[1]},
        "final_test_accessed_for_scoring_or_selection": False,
        "final_test_note": "The diagnostic receives only the existing outer training partition; final-test features, labels, and scores are not passed to this function.",
        "validation_split": split_details,
        "fit_rows": int(len(X_fit)),
        "validation_rows": int(len(X_val)),
        "fit_dates": {"start": str(fit_dates.min().date()), "end": str(fit_dates.max().date())},
        "validation_dates": {"start": str(val_dates.min().date()), "end": str(val_dates.max().date())},
        "fit_class_counts": fit_counts,
        "validation_class_counts": _class_distribution(y_val, labels),
        "feature_names": list(X_train.columns),
        "feature_data_quality_fit_window": feature_data_quality(X_fit),
        "feature_importance": {
            "reference_model": "random_forest_configured",
            "impurity_importance": impurity,
            "validation_permutation_macro_f1": permutation_importance_by_feature,
            "caveat": "Correlated predictors can split or distort importance; permutation is not causal and uses this validation window.",
        },
        "pipeline_audit": {
            "feature_engineering": "Reviewed functions use rolling, differencing, EMA, and percentage-change operations on current and earlier rows; no negative shifts are used for features.",
            "labels": "Forward return uses Close.shift(-h), then drops the last h rows within each symbol before symbols are concatenated.",
            "split": "Outer split is by sorted unique dates, with a horizon-sized purge; diagnostic fit/validation is also chronological with a horizon-sized date purge.",
            "data_cleaning": "Training concatenates per-symbol features and labels, drops rows with missing values, then replaces remaining NaN/infinite feature values with zero before fitting.",
            "identified_leakage": False,
            "limitations": [
                "Moving-average ratios and MACD components are related by construction; feature correlation does not establish harmful leakage.",
                "All securities share a common validation period, but models do not include index, sector, or cross-asset context.",
                "This single validation window is for diagnosis; repeated rolling-origin validation is needed before adopting changes.",
            ],
        },
        "experiments": candidate_results,
        "validation_macro_f1_order": ordered,
        "selection_rule": "Ranked by validation macro-F1 for inspection only; compare balanced accuracy, log loss, and class recalls jointly. No model is selected or deployed by this diagnostic.",
        "reproducibility": {
            "random_state": seed,
            "numpy_seeded_estimators": True,
            "validation_permutation_repeats": 3,
            "no_synthetic_training_data": True,
        },
        "production_artifacts_written": False,
    }


def run_calibration_investigation(
    *, estimator, X_train, y_train, train_dates, train_symbols, X_test, y_test,
    test_symbols, config: dict, data_source: str, raw_rows: int, train_dates_full,
    test_dates_full, saved_model_path: Path, validation_ratio: float = 0.2,
) -> dict:
    """Compare calibration methods on purged validation, then score locked production on test."""
    import joblib

    if data_source != "YFINANCE_NS":
        raise ValueError("Calibration investigation requires real Yahoo Finance data")

    labels = CLASS_ORDER
    horizon = int(config["labels"]["horizon_days"])
    fit_indices, validation_indices, validation_split = chronological_validation_indices(
        train_dates, horizon, validation_ratio
    )
    X_fit, y_fit = X_train.iloc[fit_indices], np.asarray(y_train, dtype=str)[fit_indices]
    X_val, y_val = X_train.iloc[validation_indices], np.asarray(y_train, dtype=str)[validation_indices]
    fit_dates = np.asarray(train_dates)[fit_indices]
    val_dates = np.asarray(train_dates)[validation_indices]
    val_symbols = np.asarray(train_symbols)[validation_indices]
    if any(_class_distribution(y_fit, labels)[label] == 0 for label in labels):
        raise ValueError("Calibration fit segment is missing one or more classes")

    model_cfg = config["model"]
    gap = horizon * max(1, len(config["symbols"]))
    cv = TimeSeriesSplit(n_splits=5, gap=gap)
    cv_splits = list(cv.split(X_fit))
    fold_details = _time_series_fold_details(cv_splits, fit_dates, y_fit, labels)
    isotonic_minimum_fold_rows = min(fold["calibration_rows"] for fold in fold_details)
    isotonic_minimum_class_support = min(
        count
        for fold in fold_details
        for count in fold["calibration_class_counts"].values()
    )
    isotonic_supported = isotonic_minimum_fold_rows >= 1000 and isotonic_minimum_class_support >= 100

    baseline = DummyClassifier(strategy="most_frequent", random_state=model_cfg["random_state"])
    baseline.fit(X_fit, y_fit)
    baseline_result = evaluate_model(baseline, X_val, y_val, val_symbols, labels)

    raw_model = clone(estimator).fit(X_fit, y_fit)
    raw_result = evaluate_model(raw_model, X_val, y_val, val_symbols, labels)
    raw_probabilities = _align_probabilities(raw_model.predict_proba(X_val), raw_model.classes_, labels, len(y_val))
    validation_models = {
        "majority_class_baseline": {
            "metrics": baseline_result,
            "calibration": per_class_reliability(
                y_val, _align_probabilities(baseline.predict_proba(X_val), baseline.classes_, labels, len(y_val)), labels
            ),
        },
        "uncalibrated_random_forest": {
            "metrics": raw_result,
            "calibration": per_class_reliability(y_val, raw_probabilities, labels),
        },
    }

    method_models = {}
    method_results = {}
    methods = {"sigmoid": True, "isotonic": isotonic_supported}
    for method, supported in methods.items():
        if not supported:
            validation_models[f"{method}_calibrated_random_forest"] = {
                "status": "skipped",
                "reason": (
                    "Isotonic requires at least 1,000 rows per chronological calibration fold "
                    "and at least 100 examples of every class per fold."
                ),
            }
            continue
        calibrated = CalibratedClassifierCV(
            clone(estimator), method=method, cv=cv_splits, ensemble=True
        ).fit(X_fit, y_fit)
        metrics = evaluate_model(calibrated, X_val, y_val, val_symbols, labels)
        probabilities = _align_probabilities(
            calibrated.predict_proba(X_val), calibrated.classes_, labels, len(y_val)
        )
        raw_fold_probabilities = np.mean([
            _align_probabilities(
                fitted.estimator.predict_proba(X_val),
                fitted.estimator.classes_, labels, len(y_val),
            )
            for fitted in calibrated.calibrated_classifiers_
        ], axis=0)
        method_models[method] = calibrated
        method_results[method] = metrics
        validation_models[f"{method}_calibrated_random_forest"] = {
            "status": "evaluated",
            "metrics": metrics,
            "calibration": per_class_reliability(y_val, probabilities, labels),
            "calibration_functions": _calibrator_parameters(calibrated),
            "probability_ranking_changes_from_own_fold_estimators": _probability_ranking_changes(
                raw_fold_probabilities, probabilities, y_val, labels
            ),
        }

    # The holdout is not accessed until all validation comparisons and method
    # calibration details have been computed. Production artifacts remain read-only.
    production_result = None
    if saved_model_path.exists():
        production_model = joblib.load(saved_model_path)
        expected_features = getattr(production_model, "feature_names_in_", None)
        if expected_features is not None and list(expected_features) != list(X_test.columns):
            raise ValueError("Saved production model feature order differs from final test features")
        production_probabilities = _align_probabilities(
            production_model.predict_proba(X_test), production_model.classes_, labels, len(y_test)
        )
        production_result = {
            "model_version": config["output"]["model_version"],
            "method": getattr(production_model, "method", "unknown"),
            "metrics": evaluate_model(production_model, X_test, y_test, test_symbols, labels),
            "calibration": per_class_reliability(y_test, production_probabilities, labels),
        }
    else:
        production_result = {"status": "unavailable", "reason": "Saved production model artifact was not found."}

    return {
        "diagnostic_type": "chronological_calibration_investigation",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_source": data_source,
        "raw_download_rows": int(raw_rows),
        "outer_train_rows": int(len(X_train)),
        "outer_test_rows": int(len(X_test)),
        "outer_train_dates": {"start": train_dates_full[0], "end": train_dates_full[1]},
        "outer_test_dates": {"start": test_dates_full[0], "end": test_dates_full[1]},
        "validation_split": validation_split,
        "validation_rows": int(len(X_val)),
        "fit_rows_for_validation_comparison": int(len(X_fit)),
        "fit_class_counts": _class_distribution(y_fit, labels),
        "validation_class_counts": _class_distribution(y_val, labels),
        "validation_dates": {
            "fit_start": str(pd.Timestamp(fit_dates.min()).date()),
            "fit_end": str(pd.Timestamp(fit_dates.max()).date()),
            "validation_start": str(pd.Timestamp(val_dates.min()).date()),
            "validation_end": str(pd.Timestamp(val_dates.max()).date()),
        },
        "features": list(X_train.columns),
        "label_config": config["labels"],
        "model_config": model_cfg,
        "calibration_cv": {
            "method": "TimeSeriesSplit",
            "n_splits": 5,
            "gap_rows": gap,
            "ensemble": True,
            "folds": fold_details,
        },
        "isotonic_data_support": {
            "rule": "run only when each chronological calibration fold has at least 1,000 rows and at least 100 examples per class",
            "minimum_fold_rows": int(isotonic_minimum_fold_rows),
            "minimum_class_support_in_any_fold": int(isotonic_minimum_class_support),
            "evaluated": bool(isotonic_supported),
            "limitation": "Rows across adjacent dates are correlated, so nominal fold counts overstate independent calibration information.",
        },
        "validation_models": validation_models,
        "production_final_test_evaluation": production_result,
        "final_test_usage": "The final test set was not used for fit, calibration, method comparison, or selection; only the saved production model was scored after validation analyses completed.",
        "production_artifact_written": False,
    }


def _class_distribution(values, labels=CLASS_ORDER) -> dict[str, int]:
    return _counts(values, labels)


def _json_safe(value):
    """Convert estimator parameters into JSON-safe summaries."""
    from sklearn.base import BaseEstimator

    if isinstance(value, BaseEstimator):
        return {
            "estimator": type(value).__name__,
            "parameters": _json_safe(value.get_params(deep=False)),
        }
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return repr(value)


def run_prediction_collapse_diagnostic(
    *,
    estimator,
    X_train,
    y_train,
    X_test,
    y_test,
    test_symbols,
    baseline,
    config: dict,
    data_source: str,
    raw_rows: int,
    train_dates: tuple[str, str],
    test_dates: tuple[str, str],
    saved_model_path: Path,
) -> dict:
    """Compare baseline, same-split RF variants, and saved production artifact."""
    from sklearn.calibration import CalibratedClassifierCV
    import joblib

    labels = CLASS_ORDER
    train_counts = _class_distribution(y_train, labels)
    absent = [label for label, count in train_counts.items() if count == 0]
    if absent:
        raise ValueError(f"Cannot compare models; training data is missing classes: {absent}")

    model_cfg = config["model"]
    rf = clone(estimator)
    rf.fit(X_train, y_train)

    calibration_cfg = config["calibration"]
    horizon = int(config["labels"]["horizon_days"])
    gap = horizon * max(1, len(config["symbols"]))
    cv = TimeSeriesSplit(n_splits=5, gap=gap)
    calibrated = CalibratedClassifierCV(
        clone(estimator), method=calibration_cfg["method"], cv=cv
    )
    calibrated.fit(X_train, y_train)

    baseline_result = evaluate_model(baseline, X_test, y_test, test_symbols, labels)
    raw_result = evaluate_model(rf, X_test, y_test, test_symbols, labels)
    calibrated_base_ensemble_result = evaluate_uncalibrated_fold_ensemble(
        calibrated, X_test, y_test, test_symbols, labels
    )
    calibrated_result = evaluate_model(calibrated, X_test, y_test, test_symbols, labels)

    saved_result = None
    saved_model_version = None
    if saved_model_path.exists():
        saved_model = joblib.load(saved_model_path)
        expected_features = getattr(saved_model, "feature_names_in_", None)
        if expected_features is not None and list(expected_features) != list(X_test.columns):
            raise ValueError("Saved production model feature order differs from the diagnostic test data")
        saved_result = evaluate_model(saved_model, X_test, y_test, test_symbols, labels)
        saved_model_version = config["output"]["model_version"]
        saved_uncalibrated_ensemble_result = evaluate_uncalibrated_fold_ensemble(
            saved_model, X_test, y_test, test_symbols, labels
        )
    else:
        saved_uncalibrated_ensemble_result = None

    return {
        "diagnostic_type": "prediction_collapse_calibration_comparison",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_source": data_source,
        "raw_download_rows": int(raw_rows),
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "train_dates": {"start": train_dates[0], "end": train_dates[1]},
        "test_dates": {"start": test_dates[0], "end": test_dates[1]},
        "class_order": list(labels),
        "train_class_counts": train_counts,
        "test_class_counts": _class_distribution(y_test, labels),
        "feature_list": list(X_train.columns),
        "label_config": config["labels"],
        "split_config": config["split"],
        "model_config": model_cfg,
        "calibration_config": calibration_cfg,
        "calibration_cv": {"n_splits": 5, "gap_rows": gap, "method": calibration_cfg["method"]},
        "evaluation_notes": [
            "The standalone uncalibrated forest and calibrated forest use the same current train and test matrices.",
            "The pre-calibration fold-ensemble scores use the exact fitted base estimators inside the corresponding calibrated model, scored before their sigmoid mapping.",
            "The saved production model is additionally evaluated on this test matrix; raw historical rows were not persisted, so Yahoo Finance was downloaded again.",
            "Diagnostic models are fit in memory only. This report does not replace production model artifacts.",
        ],
        "models": {
            "majority_class_baseline": baseline_result,
            "uncalibrated_random_forest": raw_result,
            "sigmoid_calibration_fold_ensemble_before_calibration": calibrated_base_ensemble_result,
            "sigmoid_calibrated_random_forest_same_split": calibrated_result,
            "saved_production_calibrated_model": {
                "model_version": saved_model_version,
                "metrics": saved_result,
                "fold_ensemble_before_calibration": saved_uncalibrated_ensemble_result,
            },
        },
    }


def write_diagnostic_report(report: dict, path: Path) -> None:
    path.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
