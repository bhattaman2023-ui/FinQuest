import { Router } from 'express';
import { query } from '../db/pool';
import { requireAuth } from '../middleware/auth';

export const marketRouter = Router();

// ── GET /api/market/ticker ────────────────────────────────────────
// Called by the TickerStrip component
marketRouter.get('/ticker', async (_req, res, next) => {
  try {
    // Get latest price for each stock from historical_prices
    type TickerRow = { symbol: string; close: string; prev_close: string; data_source: string };
    const { rows } = await query<TickerRow>(
      `SELECT DISTINCT ON (symbol) symbol, close, data_source,
         LAG(close) OVER (PARTITION BY symbol ORDER BY trade_date) AS prev_close
       FROM historical_prices
       ORDER BY symbol, trade_date DESC`
    );

    const tickers = rows.map(r => {
      const close = parseFloat(r.close);
      const prev  = parseFloat(r.prev_close ?? r.close);
      const change = prev > 0 ? ((close - prev) / prev) * 100 : 0;
      return {
        symbol: r.symbol,
        value:  close,
        change: Math.round(change * 100) / 100,
        type:   r.data_source === 'SYNTHETIC_SAMPLE' ? 'SIMULATED' : 'HISTORICAL',
      };
    });

    // Add index placeholders (always HISTORICAL)
    const indices = [
      { symbol: 'NIFTY 50',   value: 24180.80, change: 0.62,  type: 'HISTORICAL' },
      { symbol: 'SENSEX',     value: 79748.63, change: 0.58,  type: 'HISTORICAL' },
      { symbol: 'NIFTY BANK', value: 51842.30, change: -0.21, type: 'HISTORICAL' },
    ];

    res.json({ tickers: [...indices, ...tickers] });
  } catch (err) { next(err); }
});

// ── GET /api/market/stocks ────────────────────────────────────────
marketRouter.get('/stocks', requireAuth, async (_req, res, next) => {
  try {
    type StockRow = { symbol: string; name: string; sector: string; close: string; prev_close: string; data_source: string; trade_date: string };
    const { rows } = await query<StockRow>(
      `SELECT s.symbol, s.name, s.sector,
         hp.close, hp.data_source, hp.trade_date,
         LAG(hp.close) OVER (PARTITION BY hp.symbol ORDER BY hp.trade_date) AS prev_close
       FROM stocks s
       JOIN (
         SELECT DISTINCT ON (symbol) symbol, close, data_source, trade_date
         FROM historical_prices ORDER BY symbol, trade_date DESC
       ) hp ON hp.symbol = s.symbol
       WHERE s.is_active = true
       ORDER BY s.symbol`
    );

    res.json(rows.map(r => {
      const close = parseFloat(r.close);
      const prev  = parseFloat(r.prev_close ?? r.close);
      const change = prev > 0 ? ((close - prev) / prev) * 100 : 0;
      return {
        symbol:     r.symbol,
        name:       r.name,
        sector:     r.sector,
        price:      close,
        change:     Math.round(change * 100) / 100,
        priceType:  r.data_source === 'SYNTHETIC_SAMPLE' ? 'SIMULATED' : 'HISTORICAL',
        lastUpdated: r.trade_date,
      };
    }));
  } catch (err) { next(err); }
});

// ── GET /api/market/stocks/:symbol ───────────────────────────────
marketRouter.get('/stocks/:symbol', requireAuth, async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    type StockRow = { symbol: string; name: string; sector: string; description: string };
    const sr = await query<StockRow>(
      `SELECT symbol, name, sector, description FROM stocks WHERE symbol=$1 AND is_active=true`,
      [symbol]
    );
    if (sr.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Stock not found.' });
    }

    // Price history (last 365 days)
    type PriceRow = { trade_date: string; open: string; high: string; low: string; close: string; volume: string; data_source: string };
    const pr = await query<PriceRow>(
      `SELECT trade_date, open, high, low, close, volume, data_source
       FROM historical_prices WHERE symbol=$1 ORDER BY trade_date ASC`,
      [symbol]
    );

    const prices = pr.rows.map(p => ({
      date:       p.trade_date,
      open:       parseFloat(p.open),
      high:       parseFloat(p.high),
      low:        parseFloat(p.low),
      close:      parseFloat(p.close),
      volume:     parseInt(p.volume, 10),
      dataSource: p.data_source,
    }));

    const latest = prices.at(-1);
    const prevDay = prices.at(-2);
    const change = latest && prevDay ? ((latest.close - prevDay.close) / prevDay.close) * 100 : 0;

    res.json({
      ...sr.rows[0],
      price:    latest?.close ?? 0,
      change:   Math.round(change * 100) / 100,
      priceType: latest?.dataSource === 'SYNTHETIC_SAMPLE' ? 'SIMULATED' : 'HISTORICAL',
      prices,
    });
  } catch (err) { next(err); }
});

// ── GET /api/market/events ────────────────────────────────────────
marketRouter.get('/events', requireAuth, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, title, description, event_date, event_type FROM market_events ORDER BY event_date DESC LIMIT 20`
    );
    res.json(rows);
  } catch (err) { next(err); }
});
