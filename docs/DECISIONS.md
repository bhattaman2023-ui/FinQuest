# DECISIONS.md
# Design and architecture decisions made during FINQUEST build.

## D-001: Greenfield build
**Decision:** The FINQUEST project folder was empty on audit. Built from scratch following the master prompt.
**Rationale:** No existing code to preserve.

## D-002: bcrypt for password hashing (not argon2)
**Decision:** Backend uses `bcrypt` (npm package) instead of `argon2`.
**Rationale:** `argon2` has native module compilation requirements that may fail on Windows without build tools. `bcrypt` is well-tested and secure (cost factor 12). Can swap to `argon2` later.

## D-003: Synthetic price data with SYNTHETIC_SAMPLE label
**Decision:** When yfinance cannot fetch data (network unavailable in sandbox), synthetic OHLCV data is generated and stored with `data_source = 'SYNTHETIC_SAMPLE'`.
**Rationale:** Spec requires this. The label appears on every price shown in the UI.
**To replace with real data:** Run `cd ml && python train.py --config config.yaml` after installing Python and ensuring network access to yfinance.

## D-004: JWT in httpOnly cookie AND Authorization header
**Decision:** Auth accepts JWT from both `fq_token` httpOnly cookie and `Authorization: Bearer` header.
**Rationale:** Cookie for browser security; header for API testing and mobile clients.

## D-005: Courses route mounted at /api/courses (not /api/learn)
**Decision:** Backend uses `/api/courses` while frontend API client uses `/api/learn`.
**Rationale:** Backend was pre-built this way. Frontend client updated to match.
**Action required:** Align the API prefix in a future cleanup phase.

## D-006: ML probabilities labelled "uncalibrated" until CalibratedClassifierCV is used
**Decision:** `calibration.enabled: true` in config. Model wrapped in CalibratedClassifierCV using TimeSeriesSplit (chronological).
**Rationale:** Spec requires calibrated probabilities or explicit "uncalibrated" label.

## D-007: No real-time prices at launch
**Decision:** All prices are SIMULATED (synthetic) or HISTORICAL (yfinance). A PriceProvider interface is documented so a live data provider can be swapped in.
**Rationale:** Spec requires prices to be clearly labelled. Live NSE data requires commercial provider agreement.

## D-008: AI Mentor uses provider-agnostic wrapper
**Decision:** AI Mentor calls any OpenAI-compatible API (set AI_BASE_URL). Defaults to OpenAI GPT if key provided.
**Rationale:** Spec requires provider-agnostic design. No key → graceful fallback to glossary/lesson search.

## D-009: Hindi translations are partial (~60%)
**Decision:** Hindi UI strings cover nav, landing, common, and auth sections. Lesson content stays in English.
**Rationale:** Full translation requires a human translator for financial accuracy. English fallback works automatically via react-i18next.
**Gap documented:** Missing keys: simulator, portfolio, gamification, insights, mentor sections.

## D-010: Portfolio P&L uses weighted average cost (WAC) method
**Decision:** When a user buys more of a stock they already hold, the average cost is recalculated as: `(old_avg_cost × old_qty + new_price × new_qty) / (old_qty + new_qty)`.
**Rationale:** Spec mandates WAC. This is the standard method used by Indian brokers (Zerodha, Groww etc).

## D-011: Streak reset rules (IST midnight)
**Decision:** A streak day counts if the user completes at least one lesson on that calendar day in IST (Asia/Kolkata). Missing a day resets the streak to 0.
**Rationale:** Spec requires IST timezone for streaks.
