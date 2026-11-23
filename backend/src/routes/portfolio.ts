import { Router } from 'express';
import { query } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const portfolioRouter = Router();

// ── GET /api/portfolio/summary ────────────────────────────────────
portfolioRouter.get('/summary', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    // Cash
    type WalletRow = { balance: string };
    const wr = await query<WalletRow>(`SELECT balance FROM virtual_wallets WHERE user_id=$1`, [userId]);
    const cash = parseFloat(wr.rows[0]?.balance ?? '0');

    // Holdings
    type HoldRow = { symbol: string; quantity: number; avg_cost: string; close: string; sector: string };
    const hr = await query<HoldRow>(
      `SELECT h.symbol, h.quantity, h.avg_cost, hp.close, s.sector
       FROM holdings h
       LEFT JOIN (SELECT DISTINCT ON (symbol) symbol, close FROM historical_prices ORDER BY symbol, trade_date DESC) hp ON hp.symbol=h.symbol
       LEFT JOIN stocks s ON s.symbol=h.symbol
       WHERE h.user_id=$1 AND h.quantity>0`,
      [userId]
    );

    let invested = 0, currentVal = 0;
    const holdingsDetail = hr.rows.map(h => {
      const avgCost = parseFloat(h.avg_cost);
      const price   = parseFloat(h.close ?? h.avg_cost);
      const inv     = avgCost * h.quantity;
      const cur     = price * h.quantity;
      invested   += inv;
      currentVal += cur;
      return {
        symbol:    h.symbol,
        quantity:  h.quantity,
        avgCost,
        price,
        invested:  Math.round(inv * 100) / 100,
        currentValue: Math.round(cur * 100) / 100,
        pnl:       Math.round((cur - inv) * 100) / 100,
        pnlPct:    inv > 0 ? Math.round(((cur - inv) / inv) * 10000) / 100 : 0,
        sector:    h.sector ?? 'Other',
      };
    });

    const totalValue    = Math.round((cash + currentVal) * 100) / 100;
    const unrealisedPnl = Math.round((currentVal - invested) * 100) / 100;
    const returnPct     = invested > 0 ? Math.round((unrealisedPnl / invested) * 10000) / 100 : 0;

    // Realised P&L from closed positions
    type RealRow = { total: string };
    const rr = await query<RealRow>(
      `WITH buys AS (
         SELECT symbol, SUM(quantity) AS qty, SUM(total) AS cost
         FROM orders WHERE user_id=$1 AND side='BUY' AND status='FILLED' GROUP BY symbol
       ),
       sells AS (
         SELECT symbol, SUM(quantity) AS qty, SUM(total) AS proceeds
         FROM orders WHERE user_id=$1 AND side='SELL' AND status='FILLED' GROUP BY symbol
       )
       SELECT COALESCE(SUM(s.proceeds - (s.qty * b.cost / NULLIF(b.qty, 0))), 0)::TEXT AS total
       FROM sells s JOIN buys b ON b.symbol = s.symbol`,
      [userId]
    );
    const realisedPnl = parseFloat(rr.rows[0]?.total ?? '0');

    // Sector allocation
    const sectorMap: Record<string, number> = {};
    for (const h of holdingsDetail) {
      sectorMap[h.sector] = (sectorMap[h.sector] ?? 0) + h.currentValue;
    }

    res.json({
      cash:         Math.round(cash * 100) / 100,
      invested:     Math.round(invested * 100) / 100,
      currentValue: Math.round(currentVal * 100) / 100,
      totalValue,
      unrealisedPnl,
      realisedPnl:  Math.round(realisedPnl * 100) / 100,
      returnPct,
      holdings:     holdingsDetail,
      sectorAllocation: Object.entries(sectorMap).map(([sector, value]) => ({
        sector, value: Math.round(value * 100) / 100,
        pct: totalValue > 0 ? Math.round((value / totalValue) * 10000) / 100 : 0,
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /api/portfolio/snapshots ──────────────────────────────────
portfolioRouter.get('/snapshots', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    type SnapRow = { snapshot_date: string; total_value: string; cash_balance: string; invested_value: string; unrealised_pnl: string };
    const { rows } = await query<SnapRow>(
      `SELECT snapshot_date, total_value, cash_balance, invested_value, unrealised_pnl
       FROM portfolio_snapshots WHERE user_id=$1 ORDER BY snapshot_date ASC LIMIT 365`,
      [req.user!.id]
    );

    res.json(rows.map(r => ({
      date:         r.snapshot_date,
      totalValue:   parseFloat(r.total_value),
      cashBalance:  parseFloat(r.cash_balance),
      investedValue: parseFloat(r.invested_value),
      unrealisedPnl: parseFloat(r.unrealised_pnl),
    })));
  } catch (err) { next(err); }
});

// ── GET /api/portfolio/transactions ───────────────────────────────
portfolioRouter.get('/transactions', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    const offset = parseInt((req.query.offset as string) || '0', 10);
    type TxRow = { id: string; type: string; amount: string; balance_after: string; description: string; created_at: string };
    const { rows } = await query<TxRow>(
      `SELECT id, type, amount, balance_after, description, created_at
       FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, limit, offset]
    );
    res.json(rows.map(r => ({
      id:           r.id,
      type:         r.type,
      amount:       parseFloat(r.amount),
      balanceAfter: parseFloat(r.balance_after),
      description:  r.description,
      createdAt:    r.created_at,
    })));
  } catch (err) { next(err); }
});
