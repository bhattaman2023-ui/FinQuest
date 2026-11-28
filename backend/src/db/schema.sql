-- ============================================================
-- FINQUEST — Complete Database Schema
-- Run via: node --require ts-node/register src/db/migrate.ts
-- All migrations are ADDITIVE (no drops, no data loss).
-- ============================================================

-- ── Auth ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  avatar_initials TEXT,
  leaderboard_opt_in BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Learning ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lessons (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  slug             TEXT NOT NULL,
  title            TEXT NOT NULL,
  read_time_min    INTEGER NOT NULL DEFAULT 10,
  objectives       JSONB NOT NULL DEFAULT '[]',
  body_md          TEXT NOT NULL DEFAULT '',
  key_terms        JSONB NOT NULL DEFAULT '[]',
  key_takeaways    JSONB NOT NULL DEFAULT '[]',
  diagram_type     TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_published     BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(course_id, slug)
);

CREATE TABLE IF NOT EXISTS quizzes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id   UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  pass_mark   INTEGER NOT NULL DEFAULT 70,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  options       JSONB NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS glossary_terms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term        TEXT NOT NULL,
  definition  TEXT NOT NULL,
  category    TEXT NOT NULL,
  example     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS glossary_term_lower ON glossary_terms (LOWER(term));

CREATE TABLE IF NOT EXISTS user_lesson_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id    UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed    BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id     UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  passed      BOOLEAN NOT NULL,
  answers     JSONB NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id);

CREATE TABLE IF NOT EXISTS certificates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verification_id TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Market data ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol      TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  exchange    TEXT NOT NULL DEFAULT 'NSE',
  sector      TEXT,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS historical_prices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol      TEXT NOT NULL,
  trade_date  DATE NOT NULL,
  open        NUMERIC(14,2) NOT NULL,
  high        NUMERIC(14,2) NOT NULL,
  low         NUMERIC(14,2) NOT NULL,
  close       NUMERIC(14,2) NOT NULL,
  volume      BIGINT NOT NULL DEFAULT 0,
  data_source TEXT NOT NULL DEFAULT 'SYNTHETIC_SAMPLE',
  price_adjustment TEXT NOT NULL DEFAULT 'not_applicable',
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(symbol, trade_date),
  CHECK (high >= low),
  CHECK (high >= open),
  CHECK (high >= close),
  CHECK (low  <= open),
  CHECK (low  <= close),
  CHECK (volume >= 0)
);
-- Safe for existing databases created before Yahoo price provenance was added.
ALTER TABLE historical_prices
  ADD COLUMN IF NOT EXISTS price_adjustment TEXT NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_hist_prices_symbol_date ON historical_prices(symbol, trade_date DESC);

CREATE TABLE IF NOT EXISTS market_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  event_date  DATE NOT NULL,
  event_type  TEXT NOT NULL DEFAULT 'EDUCATIONAL',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Simulation ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS virtual_wallets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance    NUMERIC(14,2) NOT NULL DEFAULT 100000.00,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  price           NUMERIC(14,2) NOT NULL CHECK (price > 0),
  total           NUMERIC(14,2) NOT NULL CHECK (total > 0),
  status          TEXT NOT NULL DEFAULT 'FILLED' CHECK (status IN ('FILLED', 'REJECTED', 'CANCELLED')),
  idempotency_key TEXT,
  price_type      TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (price_type IN ('SIMULATED', 'HISTORICAL')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS holdings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  avg_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, symbol)
);

CREATE TABLE IF NOT EXISTS transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id     UUID REFERENCES orders(id),
  type         TEXT NOT NULL,
  amount       NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);

-- ── Portfolio snapshots ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL,
  total_value     NUMERIC(14,2) NOT NULL,
  cash_balance    NUMERIC(14,2) NOT NULL,
  invested_value  NUMERIC(14,2) NOT NULL,
  unrealised_pnl  NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_date ON portfolio_snapshots(user_id, snapshot_date DESC);

-- ── Gamification ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_xp (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  total_xp   INTEGER NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  level      INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS xp_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  xp_amount   INTEGER NOT NULL CHECK (xp_amount > 0),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_xp_tx_user ON xp_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS badges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '🏆',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_badges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id   UUID NOT NULL REFERENCES badges(id),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  xp_reward    INTEGER NOT NULL DEFAULT 100,
  challenge_type TEXT NOT NULL DEFAULT 'one_time',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id),
  progress     INTEGER NOT NULL DEFAULT 0,
  completed    BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, challenge_id)
);

CREATE TABLE IF NOT EXISTS user_streaks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  current_streak   INTEGER NOT NULL DEFAULT 0,
  longest_streak   INTEGER NOT NULL DEFAULT 0,
  last_activity_date DATE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Insights / ML ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prediction_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          TEXT NOT NULL,
  prediction      TEXT NOT NULL CHECK (prediction IN ('UP', 'DOWN', 'SIDEWAYS')),
  confidence_up   NUMERIC(5,4),
  confidence_down NUMERIC(5,4),
  confidence_side NUMERIC(5,4),
  model_version   TEXT NOT NULL,
  data_source     TEXT NOT NULL,
  last_data_date  DATE,
  predicted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pred_symbol_time ON prediction_results(symbol, predicted_at DESC);

CREATE TABLE IF NOT EXISTS model_metadata (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version   TEXT NOT NULL,
  trained_at      TIMESTAMPTZ NOT NULL,
  train_start     DATE,
  train_end       DATE,
  test_accuracy   NUMERIC(6,4),
  macro_f1        NUMERIC(6,4),
  feature_list    JSONB,
  class_weights   JSONB,
  label_config    JSONB,
  data_source     TEXT,
  library_versions JSONB,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_data  JSONB NOT NULL,
  reviewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AI Mentor ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at ASC);
