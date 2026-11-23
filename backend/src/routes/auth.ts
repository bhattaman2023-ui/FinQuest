import { Router } from 'express';
import bcrypt from 'bcrypt';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool';
import { signToken, requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createError } from '../middleware/errorHandler';

export const authRouter = Router();

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH || '20', 10),
  message: { error: 'TOO_MANY_REQUESTS', message: 'Too many auth attempts. Wait 15 minutes.' },
});

// ── Schemas ──────────────────────────────────────────────────────
const RegisterSchema = z.object({
  email:       z.string().email('Invalid email address.'),
  password:    z.string().min(8, 'Password must be at least 8 characters.').max(128),
  displayName: z.string().min(2, 'Display name must be at least 2 characters.').max(50).trim(),
});

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// ── Helpers ──────────────────────────────────────────────────────
function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function cookieOpts() {
  return {
    httpOnly: true,
    secure:   process.env.COOKIE_SECURE === 'true',
    sameSite: (process.env.COOKIE_SAME_SITE || 'lax') as 'lax' | 'strict' | 'none',
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
    path:     '/',
  };
}

// ── POST /api/auth/register ────────────────────────────────────
authRouter.post('/register', authLimit, validate(RegisterSchema), async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body;

    // Check duplicate
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      throw createError('An account with this email already exists.', 409, 'EMAIL_TAKEN');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const initials = getInitials(displayName);
    const initialBalance = parseFloat(process.env.INITIAL_WALLET_BALANCE || '100000');

    await withTransaction(async (client) => {
      // Create user
      const ur = await client.query(
        `INSERT INTO users (email, password_hash, display_name, avatar_initials)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [email.toLowerCase(), passwordHash, displayName, initials]
      );
      const userId = ur.rows[0].id;

      // Create wallet
      await client.query(
        `INSERT INTO virtual_wallets (user_id, balance) VALUES ($1, $2)`,
        [userId, initialBalance]
      );

      // Create XP record
      await client.query(`INSERT INTO user_xp (user_id) VALUES ($1)`, [userId]);

      // Create streak record
      await client.query(`INSERT INTO user_streaks (user_id) VALUES ($1)`, [userId]);

      // Initial wallet transaction
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_after, description)
         VALUES ($1, 'INITIAL_DEPOSIT', $2, $2, 'Starting virtual cash')`,
        [userId, initialBalance]
      );

      const token = signToken({ sub: userId, email: email.toLowerCase(), displayName, role: 'user' });

      res.cookie('fq_token', token, cookieOpts());
      res.status(201).json({
        user: { id: userId, email: email.toLowerCase(), displayName, role: 'user', avatarInitials: initials },
        token,
      });
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ────────────────────────────────────────
authRouter.post('/login', authLimit, validate(LoginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    type UserRow = { id: string; email: string; password_hash: string; display_name: string; role: string; avatar_initials: string };
    const { rows } = await query<UserRow>(
      'SELECT id, email, password_hash, display_name, role, avatar_initials FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (rows.length === 0) {
      throw createError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw createError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }

    const token = signToken({
      sub:         user.id,
      email:       user.email,
      displayName: user.display_name,
      role:        user.role,
    });

    res.cookie('fq_token', token, cookieOpts());
    res.json({
      user: {
        id:             user.id,
        email:          user.email,
        displayName:    user.display_name,
        role:           user.role,
        avatarInitials: user.avatar_initials,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/logout ───────────────────────────────────────
authRouter.post('/logout', requireAuth, (req, res) => {
  res.clearCookie('fq_token', { path: '/' });
  res.json({ message: 'Logged out.' });
});

// ── GET /api/auth/me ────────────────────────────────────────────
authRouter.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    type UserRow = { id: string; email: string; display_name: string; role: string; avatar_initials: string; created_at: string };
    const { rows } = await query<UserRow>(
      'SELECT id, email, display_name, role, avatar_initials, created_at FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (rows.length === 0) throw createError('User not found.', 404, 'NOT_FOUND');
    const u = rows[0];
    res.json({
      id:             u.id,
      email:          u.email,
      displayName:    u.display_name,
      role:           u.role,
      avatarInitials: u.avatar_initials,
      createdAt:      u.created_at,
    });
  } catch (err) {
    next(err);
  }
});
