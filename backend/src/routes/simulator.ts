import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { query, withTransaction } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createError } from '../middleware/errorHandler';

export const simulatorRouter = Router();

const orderLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_ORDERS || '30', 10),
  message: { error: 'TOO_MANY_REQUESTS', message: 'Too many orders. Wait 15 minutes.' },
});

const OrderSchema = z.object({
  symbol:         z.string().min(1).max(20).toUpperCase(),
  side:           z.enum(['BUY', 'SELL']),
  quantity:       z.number().int().min(1).max(10000),
  idempotencyKey: z.string().max(64).optional(),
});

// ── GET /api/simulator/wallet ─────────────────────────────────────
simulatorRouter.get('/wallet', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    type WalletRow = { balance: string; updated_at: string };
    const { rows } = await query<WalletRow>(
      `SELECT balance, updated_at FROM virtual_wallets WHERE user_id=$1`,
      [req.user!.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Wallet not found.' });
    res.json({ balance: parseFloat(rows[0].balance), updatedAt: rows[0].updated_at });
  } catch (err) { next(err); }
});

// ── GET /api/simulator/holdings ───────────────────────────────────
simulatorRouter.get('/holdings', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    type HoldingRow = { symbol: string; quantity: number; avg_cost: string; close: string; data_source: string };
    const { rows } = await query<HoldingRow>(
      `SELECT h.symbol, h.quantity, h.avg_cost,
         hp.close, hp.data_source
       FROM holdings h
       LEFT JOIN (
         SELECT DISTINCT ON (symbol) symbol, close, data_source
         FROM historical_prices ORDER BY symbol, trade_date DESC
       ) hp ON hp.symbol = h.symbol
       WHERE h.user_id=$1 AND h.quantity > 0`,
      [req.user!.id]
    );

    const holdings = rows.map(h => {
      const avgCost     = parseFloat(h.avg_cost);
      const currentPrice = parseFloat(h.close ?? '0');
      const invested    = avgCost * h.quantity;
      const currentVal  = currentPrice * h.quantity;
      const pnl         = currentVal - invested;
      const pnlPct      = invested > 0 ? (pnl / invested) * 100 : 0;
      return {
        symbol:       h.symbol,
        quantity:     h.quantity,
        avgCost,
        currentPrice,
        invested:     Math.round(invested * 100) / 100,
        currentValue: Math.round(currentVal * 100) / 100,
        unrealisedPnl: Math.round(pnl * 100) / 100,
        unrealisedPnlPct: Math.round(pnlPct * 100) / 100,
        priceType:    h.data_source === 'SYNTHETIC_SAMPLE' ? 'SIMULATED' : 'HISTORICAL',
      };
    });

    res.json(holdings);
  } catch (err) { next(err); }
});

// ── GET /api/simulator/orders ─────────────────────────────────────
simulatorRouter.get('/orders', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    type OrderRow = { id: string; symbol: string; side: string; quantity: number; price: string; total: string; status: string; price_type: string; created_at: string };
    const { rows } = await query<OrderRow>(
      `SELECT id, symbol, side, quantity, price, total, status, price_type, created_at
       FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, limit, offset]
    );

    res.json(rows.map(o => ({
      id:        o.id,
      symbol:    o.symbol,
      side:      o.side,
      quantity:  o.quantity,
      price:     parseFloat(o.price),
      total:     parseFloat(o.total),
      status:    o.status,
      priceType: o.price_type,
      createdAt: o.created_at,
    })));
  } catch (err) { next(err); }
});

// ── POST /api/simulator/orders ────────────────────────────────────
simulatorRouter.post('/orders', requireAuth, orderLimit, validate(OrderSchema), async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { symbol, side, quantity, idempotencyKey } = req.body;

    // Check idempotency early (before fetching price)
    if (idempotencyKey) {
      type DupRow = { id: string };
      const dup = await query<DupRow>(
        `SELECT id FROM orders WHERE user_id=$1 AND idempotency_key=$2`,
        [userId, idempotencyKey]
      );
      if (dup.rows.length > 0) {
        return res.status(200).json({ orderId: dup.rows[0].id, duplicate: true });
      }
    }

    // Fetch price server-side — NEVER trust client price
    type PriceRow = { close: string; data_source: string };
    const pr = await query<PriceRow>(
      `SELECT close, data_source FROM historical_prices WHERE symbol=$1 ORDER BY trade_date DESC LIMIT 1`,
      [symbol]
    );
    if (pr.rows.length === 0) {
      throw createError(`No price data for symbol: ${symbol}`, 404, 'SYMBOL_NOT_FOUND');
    }
    const price     = parseFloat(pr.rows[0].close);
    const total     = Math.round(price * quantity * 100) / 100;
    const priceType = pr.rows[0].data_source === 'SYNTHETIC_SAMPLE' ? 'SIMULATED' : 'HISTORICAL';

    const result = await withTransaction(async (client) => {
      // Lock wallet row
      type WalletRow = { balance: string };
      const walletR = await client.query<WalletRow>(
        `SELECT balance FROM virtual_wallets WHERE user_id=$1 FOR UPDATE`,
        [userId]
      );
      if (walletR.rows.length === 0) throw createError('Wallet not found.', 404, 'NOT_FOUND');
      const balance = parseFloat(walletR.rows[0].balance);

      let newBalance: number;

      if (side === 'BUY') {
        if (balance < total) {
          throw createError(
            `Insufficient funds. Need ₹${total.toLocaleString('en-IN')} but only ₹${balance.toLocaleString('en-IN')} available.`,
            422, 'INSUFFICIENT_FUNDS'
          );
        }
        newBalance = Math.round((balance - total) * 100) / 100;

        // Upsert holding (weighted average cost)
        await client.query(
          `INSERT INTO holdings (user_id, symbol, quantity, avg_cost)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, symbol) DO UPDATE SET
             avg_cost = (holdings.avg_cost * holdings.quantity + $4 * $3) / (holdings.quantity + $3),
             quantity = holdings.quantity + $3,
             updated_at = NOW()`,
          [userId, symbol, quantity, price]
        );
      } else { // SELL
        // Check holding
        type HoldRow = { quantity: number; avg_cost: string };
        const holdR = await client.query<HoldRow>(
          `SELECT quantity, avg_cost FROM holdings WHERE user_id=$1 AND symbol=$2 FOR UPDATE`,
          [userId, symbol]
        );
        if (holdR.rows.length === 0 || holdR.rows[0].quantity < quantity) {
          throw createError(
            `Insufficient shares. Have ${holdR.rows[0]?.quantity ?? 0}, need ${quantity}.`,
            422, 'INSUFFICIENT_SHARES'
          );
        }
        newBalance = Math.round((balance + total) * 100) / 100;
        const newQty = holdR.rows[0].quantity - quantity;

        if (newQty === 0) {
          await client.query(`DELETE FROM holdings WHERE user_id=$1 AND symbol=$2`, [userId, symbol]);
        } else {
          await client.query(
            `UPDATE holdings SET quantity=$1, updated_at=NOW() WHERE user_id=$2 AND symbol=$3`,
            [newQty, userId, symbol]
          );
        }
      }

      // Update wallet
      await client.query(
        `UPDATE virtual_wallets SET balance=$1, updated_at=NOW() WHERE user_id=$2`,
        [newBalance, userId]
      );

      // Insert order
      const or = await client.query(
        `INSERT INTO orders (user_id, symbol, side, quantity, price, total, status, idempotency_key, price_type)
         VALUES ($1,$2,$3,$4,$5,$6,'FILLED',$7,$8) RETURNING id`,
        [userId, symbol, side, quantity, price, total, idempotencyKey ?? null, priceType]
      );
      const orderId = or.rows[0].id;

      // Insert transaction
      await client.query(
        `INSERT INTO transactions (user_id, order_id, type, amount, balance_after, description)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, orderId, side === 'BUY' ? 'ORDER_BUY' : 'ORDER_SELL',
         total, newBalance, `${side} ${quantity} × ${symbol} @ ₹${price}`]
      );

      return { orderId, price, total, newBalance, priceType };
    });

    // Award first-trade XP (idempotent)
    const firstTradeXp = parseInt(process.env.XP_FIRST_TRADE || '25', 10);
    await query(
      `INSERT INTO xp_transactions (user_id, source_type, source_id, xp_amount, description)
       VALUES ($1, 'FIRST_TRADE', 'first_trade', $2, 'First virtual trade')
       ON CONFLICT (user_id, source_type, source_id) DO NOTHING`,
      [userId, firstTradeXp]
    );
    await query(
      `UPDATE user_xp SET total_xp = total_xp + CASE WHEN (SELECT COUNT(*) FROM xp_transactions WHERE user_id=$1 AND source_type='FIRST_TRADE') = 1 THEN $2 ELSE 0 END, updated_at=NOW() WHERE user_id=$1`,
      [userId, firstTradeXp]
    );

    // Portfolio snapshot on each trade
    await takeSnapshot(userId);

    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ── Helper: take portfolio snapshot ──────────────────────────────
async function takeSnapshot(userId: string) {
  try {
    type WalletRow = { balance: string };
    const wr = await query<WalletRow>(`SELECT balance FROM virtual_wallets WHERE user_id=$1`, [userId]);
    if (!wr.rows.length) return;
    const cash = parseFloat(wr.rows[0].balance);

    type HoldRow = { quantity: number; avg_cost: string; close: string };
    const hr = await query<HoldRow>(
      `SELECT h.quantity, h.avg_cost, hp.close
       FROM holdings h
       LEFT JOIN (SELECT DISTINCT ON (symbol) symbol, close FROM historical_prices ORDER BY symbol, trade_date DESC) hp
         ON hp.symbol = h.symbol
       WHERE h.user_id=$1 AND h.quantity > 0`,
      [userId]
    );

    let invested = 0, currentVal = 0;
    for (const h of hr.rows) {
      invested   += parseFloat(h.avg_cost) * h.quantity;
      currentVal += parseFloat(h.close ?? h.avg_cost) * h.quantity;
    }

    const totalValue    = Math.round((cash + currentVal) * 100) / 100;
    const unrealisedPnl = Math.round((currentVal - invested) * 100) / 100;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    await query(
      `INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, cash_balance, invested_value, unrealised_pnl)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
         total_value=EXCLUDED.total_value, cash_balance=EXCLUDED.cash_balance,
         invested_value=EXCLUDED.invested_value, unrealised_pnl=EXCLUDED.unrealised_pnl`,
      [userId, today, totalValue, Math.round(cash * 100) / 100, Math.round(invested * 100) / 100, unrealisedPnl]
    );
  } catch (e) {
    console.error('Snapshot failed:', e);
  }
}
