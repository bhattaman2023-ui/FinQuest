# FINQUEST ML — MODEL CARD

## Model: Random Forest Classifier (Educational)
**Version:** v1
**Trained:** 2026-11-27T17:59:48.073761+00:00

---

## Purpose
Educational classification of near-future stock movement direction: UP / DOWN / SIDEWAYS.

**This is not investment advice. This model does not predict prices.**

---

## Data
- **Source:** YFINANCE_NS
- **Training period:** 2019-03-13 to 2023-10-13
- **Test period:** 2023-10-23 to 2024-12-20
- **Symbols:** RELIANCE.NS, TCS.NS, INFY.NS, HDFCBANK.NS, ICICIBANK.NS, ITC.NS, SBIN.NS, LT.NS

> ⚠️ If data_source is SYNTHETIC_SAMPLE, all results are illustrative only and do not reflect real market behaviour.

---

## Label Definition
- **UP:** forward 5-day return > 2.0%
- **DOWN:** forward 5-day return < -2.0%
- **SIDEWAYS:** otherwise

---

## Features
- daily_return
- rsi
- macd
- macd_signal
- macd_hist
- volatility
- volume_change
- ma_5_ratio
- ma_10_ratio
- ma_20_ratio
- ma_50_ratio

---

## Results
| Metric | Value |
|--------|-------|
| Test accuracy | 0.5297 |
| Macro F1 | 0.2318 |
| Baseline accuracy (majority class) | 0.5293 |
| Beats baseline | ✅ Yes |

**Classification Report:**
```
              precision    recall  f1-score   support

        DOWN       0.00      0.00      0.00       430
    SIDEWAYS       0.53      1.00      0.69      1211
          UP       1.00      0.00      0.00       647

    accuracy                           0.53      2288
   macro avg       0.51      0.33      0.23      2288
weighted avg       0.56      0.53      0.37      2288

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
Random seed: 42
