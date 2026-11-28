# FINQUEST

**Learn Finance. Experience Markets. Practise Investing.**

India's educational financial-literacy and stock-market simulation platform for beginners.

> ⚠️ This is a **simulation and education platform only**. All prices are SIMULATED or HISTORICAL. No real money is involved. This is not a SEBI-registered investment adviser.

---

## Quick Start

### Prerequisites
- Node.js 20+ and npm
- PostgreSQL 15+ (create database: `createdb finquest`) or the bundled PGlite local database
- Python 3.11+ (for ML service)

For local development without PostgreSQL, set `DB_DRIVER=pglite` in `backend/.env`.
The embedded database persists under `backend/.local-data/`.

### 1 — Setup environment variables

```powershell
# Backend
Copy-Item backend/.env.example backend/.env
# Edit backend/.env locally; never commit it. Use a strong JWT_SECRET and a URL-encoded PostgreSQL DATABASE_URL.
```

### 2 — Install dependencies

```powershell
# Frontend
cd frontend && npm install

# Backend
cd backend && npm install
```

### 3 — Set up the database

```powershell
Set-Location .\backend
npm.cmd run migrate  # creates/updates tables
npm.cmd run seed     # inserts sample stocks, lessons, glossary and badges
```

### 4 — Start services

```powershell
# Terminal 1 — Backend (port 4000; dotenv loads backend/.env)
Set-Location .\backend
npm.cmd run dev

# Terminal 2 — Frontend (port 3000; proxies /api to port 4000)
Set-Location .\frontend
npm.cmd run dev

# Terminal 3 — ML service (port 8000, local/internal only)
Set-Location .\ml
if (-not (Test-Path .\.venv\Scripts\python.exe)) { python -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
$tokenEntry = Select-String -Path ..\backend\.env -Pattern '^ML_SERVICE_TOKEN=' | Select-Object -First 1
if (-not $tokenEntry) { throw "ML_SERVICE_TOKEN is missing from backend/.env." }
$env:ML_SERVICE_TOKEN = $tokenEntry.Line.Substring('ML_SERVICE_TOKEN='.Length).Trim().Trim('"').Trim("'")
& .\.venv\Scripts\python.exe -m uvicorn serve:app --host 127.0.0.1 --port 8000
```

The ML process reads `DATABASE_URL` from its environment or the ignored `backend/.env` file. Set `ML_SERVICE_TOKEN` in the ML process environment before startup; the backend loads the same token from `backend/.env` and sends it as `x-service-token`. Do not print or commit secrets. A compatible `model_<version>.joblib` and `meta_<version>.json` must exist under `ml/models/` before predictions are available. The checked-in source configuration selects `v1`; model binaries are deliberately not committed.

Open: http://localhost:3000

---

## Architecture

```
frontend/   React 18 + Vite + TypeScript (port 3000)
backend/    Express 4 + TypeScript + PostgreSQL (port 4000)
ml/         FastAPI + Scikit-learn (port 8000, internal only)
docs/       DECISIONS.md, CONTENT_TO_VERIFY.md, MODEL_CARD.md
```

## ML Training (one command)

```powershell
cd ml
python train.py --config config.yaml
```

This downloads NSE historical data via yfinance and stops if that download fails. Synthetic training is available only when explicitly selected in configuration. The command evaluates the classifier and writes `models/MODEL_CARD.md`.

## Testing

Run from the repository root in separate package directories:

```powershell
Set-Location .\ml
& .\.venv\Scripts\python.exe -m pytest tests -q

Set-Location ..\backend
npm.cmd test -- --runInBand
npm.cmd run build

Set-Location ..\frontend
npm.cmd test -- --reporter=dot
npm.cmd run build
```

## Real historical price ingestion

The ML ingestion command downloads the eight symbols in `ml/config.yaml` and upserts validated Yahoo Finance OHLCV rows into PostgreSQL's `historical_prices` table. It never substitutes synthetic data. When `ingestion.end_date_exclusive` is null, it calculates the next calendar date in the Asia/Kolkata timezone each run; Yahoo treats its end date as exclusive, so this requests all market sessions available through today without hardcoding a trading date. Set the optional config value or use `--end-date` to cap an import. Repeated runs re-fetch a configurable overlap (`ingestion.overlap_calendar_days`) to update recent values safely.

1. Run the backend migration against PostgreSQL so the `price_adjustment` and `ingested_at` provenance columns exist. The importer requires PostgreSQL and does not use the backend's PGlite store.
2. Set `DATABASE_URL` in the PowerShell process environment using your local database credentials. Do not put credentials in source files.
3. From the repository root, validate downloads without writing:

```powershell
Set-Location .\ml
python .\ingest_prices.py --dry-run
```

4. When the dry run reports validated rows for every configured ticker, run the import:

```powershell
python .\ingest_prices.py
```

Use `--full-history` to re-fetch from `data.start_date`; use `--end-date YYYY-MM-DD` to override the exclusive end date for one run. Yahoo rows replace matching `SYNTHETIC_SAMPLE` seed rows. Synthetic rows cannot replace Yahoo rows, and rows from other sources or Yahoo rows with a different adjustment mode cause the transaction to roll back.

---

## Feature Status

| Feature | Status |
|---|---|
| Design system + landing page | ✅ Implemented and tested |
| Auth (register/login/JWT) | ✅ Implemented |
| Database schema + migrations | ✅ Implemented |
| Seed data (stocks, lessons, glossary) | ✅ Implemented with sample data |
| Learn module (lessons, quiz) | ✅ Implemented |
| Glossary | ✅ Implemented |
| Certificate PDF | ✅ Implemented |
| Market Simulator (atomic orders) | ✅ Implemented |
| Portfolio analytics | ✅ Implemented |
| Gamification (XP, badges, streaks) | ✅ Implemented |
| Insights / ML classifier | ✅ FastAPI predictions require recent approved Yahoo Finance rows in PostgreSQL and a compatible model artifact |
| AI Mentor | ⚙️ Needs AI_API_KEY in .env |
| Hindi translations | ⚙️ ~60% complete (English fallback active) |
| Live NSE prices | ⚙️ Needs live data provider |
| Dark theme | ✅ Implemented |
| Responsive layout | ✅ Implemented |
| i18n (en + hi) | ✅ Implemented (hi partial) |

---

## Environment Variables

See `backend/.env.example` for all configurable values.

Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Must be changed in production
- `AI_API_KEY` — Optional; enables AI Mentor
- `ML_SERVICE_URL` — FastAPI ML service URL (default: http://localhost:8000)
