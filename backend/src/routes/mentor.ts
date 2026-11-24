import { Router } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { query } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';

export const mentorRouter = Router();

const aiLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AI || '10', 10),
  message: { error: 'TOO_MANY_REQUESTS', message: 'AI Mentor rate limit reached. Wait 15 minutes.' },
});

const MessageSchema = z.object({
  message:   z.string().min(1).max(2000).trim(),
  sessionId: z.string().uuid().optional(),
});

const SYSTEM_PROMPT = `You are the FINQUEST AI Mentor — a friendly, knowledgeable guide for Indian beginner investors.

Your purpose:
- Explain financial concepts clearly (markets, mutual funds, SIP, inflation, compounding, indicators, taxes)
- Review the user's virtual portfolio and trading decisions with educational insights
- Recommend relevant lessons on FINQUEST
- Help beginners understand — not advise them

Your rules (non-negotiable):
- Do NOT give personalised buy/sell/hold advice for real securities
- Do NOT fabricate live market prices or recent news
- Do NOT guarantee any returns
- Always note when data is simulated/educational (not real NSE data)
- Keep responses concise (under 300 words unless a concept requires more)
- If asked about real trading, remind the user this is an educational platform

You speak plain, simple English (or Hindi if the user writes in Hindi). Be warm, honest and helpful.`;

// ── GET /api/mentor/sessions ──────────────────────────────────────
mentorRouter.get('/sessions', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    type SessionRow = { id: string; title: string; created_at: string; updated_at: string; message_count: string };
    const { rows } = await query<SessionRow>(
      `SELECT s.id, s.title, s.created_at, s.updated_at,
         COUNT(m.id)::TEXT AS message_count
       FROM chat_sessions s
       LEFT JOIN chat_messages m ON m.session_id=s.id
       WHERE s.user_id=$1
       GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 20`,
      [req.user!.id]
    );
    res.json(rows.map(s => ({
      id:           s.id,
      title:        s.title ?? 'New conversation',
      createdAt:    s.created_at,
      updatedAt:    s.updated_at,
      messageCount: parseInt(s.message_count, 10),
    })));
  } catch (err) { next(err); }
});

// ── GET /api/mentor/sessions/:id ──────────────────────────────────
mentorRouter.get('/sessions/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    type SessionRow = { id: string; title: string; user_id: string };
    const sr = await query<SessionRow>(
      `SELECT id, title, user_id FROM chat_sessions WHERE id=$1`, [req.params.id]
    );
    if (!sr.rows.length || sr.rows[0].user_id !== req.user!.id) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found.' });
    }

    type MsgRow = { id: string; role: string; content: string; created_at: string };
    const mr = await query<MsgRow>(
      `SELECT id, role, content, created_at FROM chat_messages WHERE session_id=$1 AND role != 'system' ORDER BY created_at ASC`,
      [req.params.id]
    );

    res.json({
      id:       sr.rows[0].id,
      title:    sr.rows[0].title ?? 'New conversation',
      messages: mr.rows,
    });
  } catch (err) { next(err); }
});

// ── POST /api/mentor/chat ─────────────────────────────────────────
mentorRouter.post('/chat', requireAuth, aiLimit, validate(MessageSchema), async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { message, sessionId } = req.body;

    // Check AI key
    const hasKey = !!(process.env.AI_API_KEY && process.env.AI_API_KEY.length > 10);

    if (!hasKey) {
      return res.json({
        response: `I'm sorry — the AI Mentor isn't configured yet. The administrator needs to set an AI provider key.

In the meantime, you can:
- Browse the **Learn** module for structured lessons
- Search the **Glossary** for term definitions
- Use the **Simulator** to practice trading

*FINQUEST is not a financial advisor. All simulator prices are simulated/historical — for education only.*`,
        sessionId: null,
        fallback:  true,
      });
    }

    // Get or create session
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const sr = await query<{ id: string }>(
        `INSERT INTO chat_sessions (user_id) VALUES ($1) RETURNING id`, [userId]
      );
      activeSessionId = sr.rows[0].id;
    } else {
      // Verify ownership
      const check = await query<{ user_id: string }>(`SELECT user_id FROM chat_sessions WHERE id=$1`, [activeSessionId]);
      if (!check.rows.length || check.rows[0].user_id !== userId) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Session not yours.' });
      }
    }

    // Load history (last 10 exchanges = 20 messages)
    type MsgRow = { role: string; content: string };
    const historyR = await query<MsgRow>(
      `SELECT role, content FROM chat_messages WHERE session_id=$1 AND role != 'system' ORDER BY created_at DESC LIMIT 20`,
      [activeSessionId]
    );
    const history = historyR.rows.reverse();

    // Build messages for AI
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: message },
    ];

    // Call AI provider
    const aiBaseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const aiModel   = process.env.AI_MODEL    || 'gpt-4o-mini';

    const aiRes = await axios.post(
      `${aiBaseUrl}/chat/completions`,
      { model: aiModel, messages, max_tokens: 800, temperature: 0.7 },
      {
        headers: {
          'Authorization': `Bearer ${process.env.AI_API_KEY}`,
          'Content-Type':  'application/json',
        },
        timeout: 30_000,
      }
    );

    const response: string = aiRes.data.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response.';

    // Store messages
    await query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1,'user',$2),($1,'assistant',$3)`,
      [activeSessionId, message, response]
    );

    // Update session title (first message)
    if (history.length === 0) {
      const title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
      await query(`UPDATE chat_sessions SET title=$1, updated_at=NOW() WHERE id=$2`, [title, activeSessionId]);
    } else {
      await query(`UPDATE chat_sessions SET updated_at=NOW() WHERE id=$1`, [activeSessionId]);
    }

    res.json({ response, sessionId: activeSessionId, fallback: false });
  } catch (err) {
    // Handle AI provider errors gracefully
    const error = err as {
      response?: { status?: number; data?: { error?: string; message?: string } };
      code?: string;
    };
    const providerDetails = JSON.stringify(error.response?.data ?? '');
    if (
      (error.response?.status === 400 || error.response?.status === 401 || error.response?.status === 403) &&
      /api key/i.test(providerDetails)
    ) {
      return res.status(502).json({ error: 'AI_AUTH_FAILED', message: 'The AI provider rejected the API key. Check that AI_API_KEY and the provider settings in backend/.env are correct.' });
    }
    if (error.response?.status === 429) {
      return res.status(429).json({ error: 'AI_RATE_LIMIT', message: 'AI provider is rate-limited. Try again shortly.' });
    }
    if (error.response?.status === 503) {
      return res.status(503).json({ error: 'AI_UNAVAILABLE', message: 'The AI provider is temporarily overloaded. Please try again shortly.' });
    }
    if (error.response?.status === 404) {
      return res.status(502).json({ error: 'AI_MODEL_UNAVAILABLE', message: 'The configured AI model is unavailable. Check AI_MODEL in backend/.env.' });
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: 'AI_TIMEOUT', message: 'AI provider timed out. Try again.' });
    }
    next(err);
  }
});

// ── DELETE /api/mentor/sessions/:id ──────────────────────────────
mentorRouter.delete('/sessions/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM chat_sessions WHERE id=$1 AND user_id=$2`, [req.params.id, req.user!.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});
