import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';

import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { coursesRouter } from './routes/courses';
import { marketRouter } from './routes/market';
import { simulatorRouter } from './routes/simulator';
import { portfolioRouter } from './routes/portfolio';
import { gamificationRouter } from './routes/gamification';
import { insightsRouter } from './routes/insights';
import { mentorRouter } from './routes/mentor';
import { healthRouter } from './routes/health';

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

// ── Security headers ─────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
}));

// ── CORS ────────────────────────────────────────────────────────
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
}));

// ── Body parsing ─────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Logging ──────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// ── General rate limit ───────────────────────────────────────────
const generalLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_GENERAL || '200', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Too many requests, slow down.' },
});
app.use(generalLimit);

// ── Routes ───────────────────────────────────────────────────────
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/market', marketRouter);
app.use('/api/simulator', simulatorRouter);
app.use('/api/portfolio', portfolioRouter);
app.use('/api/gamification', gamificationRouter);
app.use('/api/insights', insightsRouter);
app.use('/api/mentor', mentorRouter);

// ── 404 ──────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Endpoint not found.' });
});

// ── Error handler (must be last) ─────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`FINQUEST Backend running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

export default app;
