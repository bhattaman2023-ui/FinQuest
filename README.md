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

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env with your DB password and JWT secret
```

### 2 — Install dependencies

```bash
# Frontend
cd frontend && npm install

# Backend
cd backend && npm install
```

### 3 — Set up the database

```bash
cd backend
npm run migrate      # creates all tables
npm run seed         # seeds stocks, lessons, glossary, badges
```

### 4 — Start services

```bash
# Terminal 1 — Backend (port 4000)
cd backend && npm run dev

# Terminal 2 — Frontend (port 3000)
cd frontend && npm run dev

# Terminal 3 — ML service (port 8000, optional)
cd ml
pip install -r requirements.txt
python train.py --config config.yaml   # train model first
uvicorn serve:app --host 0.0.0.0 --port 8000
```

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

```bash
cd ml
python train.py --config config.yaml
```

This downloads NSE historical data via yfinance (or uses synthetic if unavailable), trains the classifier, evaluates against baselines, and writes `models/MODEL_CARD.md` with real metrics.

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
| Insights / ML classifier | ✅ Implemented (synthetic data until Python installed) |
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
