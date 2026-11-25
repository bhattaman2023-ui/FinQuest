import { Router } from 'express';
import axios from 'axios';
import { query } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const insightsRouter = Router();

const ML_URL   = process.env.ML_SERVICE_URL   || 'http://localhost:8000';
const ML_TOKEN = process.env.ML_SERVICE_TOKEN || '';

// ── GET /api/insights/stock-performance/:symbol ───────────────────
insightsRouter.get('/stock-performance/:symbol', requireAuth, async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    type PriceRow = { trade_date: string; close: string; volume: string };
    const { rows } = await query<PriceRow>(
      `SELECT trade_date, close, volume FROM historical_prices WHERE symbol=$1 ORDER BY trade_date ASC`,
      [symbol]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No data for symbol.' });
    }

    const prices = rows.map(r => ({ date: r.trade_date, close: parseFloat(r.close), volume: parseInt(r.volume, 10) }));
    const closes  = prices.map(p => p.close);
    const first   = closes[0], last = closes.at(-1)!;
    const totalReturn = ((last - first) / first) * 100;

    // Rolling 20-day volatility (annualised)
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    const slice   = returns.slice(-20);
    const mean    = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / slice.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100; // annualised %

    // Max drawdown
    let peak = closes[0], maxDrawdown = 0;
    for (const c of closes) {
      if (c > peak) peak = c;
      const dd = (peak - c) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    res.json({
      symbol,
      dataSource:  'SYNTHETIC_SAMPLE',
      disclaimer:  'Synthetic data for educational use only. Not real NSE historical data.',
      prices,
      metrics: {
        totalReturnPct:   Math.round(totalReturn * 100) / 100,
        volatilityPct:    Math.round(volatility * 100) / 100,
        maxDrawdownPct:   Math.round(maxDrawdown * 10000) / 100,
        currentPrice:     last,
        firstPrice:       first,
        dataPoints:       prices.length,
      },
    });
  } catch (err) { next(err); }
});

// ── GET /api/insights/indicators/:symbol ─────────────────────────
insightsRouter.get('/indicators/:symbol', requireAuth, async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    type PriceRow = { trade_date: string; close: string; volume: string };
    const { rows } = await query<PriceRow>(
      `SELECT trade_date, close, volume FROM historical_prices WHERE symbol=$1 ORDER BY trade_date ASC`,
      [symbol]
    );

    if (rows.length < 50) {
      return res.status(422).json({ error: 'INSUFFICIENT_DATA', message: 'Need at least 50 data points for indicators.' });
    }

    const closes  = rows.map(r => parseFloat(r.close));
    const volumes = rows.map(r => parseInt(r.volume, 10));
    const dates   = rows.map(r => r.trade_date);
    const n       = closes.length;

    // ── SMA ─────────────────────────────────────────────────────
    function sma(arr: number[], period: number): (number | null)[] {
      return arr.map((_, i) => {
        if (i < period - 1) return null;
        return arr.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period;
      });
    }

    const ma5  = sma(closes, 5);
    const ma20 = sma(closes, 20);
    const ma50 = sma(closes, 50);

    // ── RSI(14) ──────────────────────────────────────────────────
    function rsi(arr: number[], period = 14): (number | null)[] {
      const result: (number | null)[] = new Array(arr.length).fill(null);
      if (arr.length < period + 1) return result;

      let gains = 0, losses = 0;
      for (let i = 1; i <= period; i++) {
        const diff = arr[i] - arr[i - 1];
        if (diff > 0) gains += diff; else losses += -diff;
      }
      let avgGain = gains / period, avgLoss = losses / period;
      result[period] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));

      for (let i = period + 1; i < arr.length; i++) {
        const diff = arr[i] - arr[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
        result[i] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));
      }
      return result;
    }

    const rsiValues = rsi(closes);

    // ── MACD (12/26/9) ───────────────────────────────────────────
    function ema(arr: number[], period: number): number[] {
      const k      = 2 / (period + 1);
      const result = new Array(arr.length).fill(0);
      result[0]    = arr[0];
      for (let i = 1; i < arr.length; i++) {
        result[i] = arr[i] * k + result[i - 1] * (1 - k);
      }
      return result;
    }
    const ema12   = ema(closes, 12);
    const ema26   = ema(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signal  = ema(macdLine, 9);
    const histogram = macdLine.map((v, i) => v - signal[i]);

    // Build output: last 100 data points
    const start = Math.max(0, n - 100);
    const output = dates.slice(start).map((date, i) => {
      const idx = start + i;
      return {
        date,
        close:     closes[idx],
        volume:    volumes[idx],
        ma5:       ma5[idx] !== null ? Math.round(ma5[idx]! * 100) / 100 : null,
        ma20:      ma20[idx] !== null ? Math.round(ma20[idx]! * 100) / 100 : null,
        ma50:      ma50[idx] !== null ? Math.round(ma50[idx]! * 100) / 100 : null,
        rsi:       rsiValues[idx] !== null ? Math.round(rsiValues[idx]! * 100) / 100 : null,
        macd:      Math.round(macdLine[idx] * 100) / 100,
        macdSignal: Math.round(signal[idx] * 100) / 100,
        macdHistogram: Math.round(histogram[idx] * 100) / 100,
      };
    });

    // Current values summary
    const latest = output.at(-1)!;
    res.json({
      symbol,
      dataSource: 'SYNTHETIC_SAMPLE',
      disclaimer: 'Synthetic data for educational use only.',
      current: latest,
      history: output,
      education: {
        ma:   'Moving averages smooth out price action. When MA5 crosses above MA20, it\'s a potential upward signal.',
        rsi:  'RSI > 70 is considered overbought; < 30 is oversold. This is a teaching indicator, not a trading signal.',
        macd: 'MACD crossing above its signal line is a potential bullish signal. The histogram shows the gap.',
      },
    });
  } catch (err) { next(err); }
});

// ── GET /api/insights/ml-prediction/:symbol ───────────────────────
insightsRouter.get('/ml-prediction/:symbol', requireAuth, async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    // Try ML service
    try {
      const mlRes = await axios.post(
        `${ML_URL}/predict`,
        { symbol },
        {
          headers: { 'x-service-token': ML_TOKEN },
          timeout: 5000,
        }
      );

      // Persist prediction
      const p = mlRes.data;
      await query(
        `INSERT INTO prediction_results (symbol, prediction, confidence_up, confidence_down, confidence_side, model_version, data_source, last_data_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [symbol, p.prediction, p.confidence_up ?? null, p.confidence_down ?? null, p.confidence_sideways ?? null,
         p.model_version ?? 'unknown', p.data_source ?? 'SYNTHETIC_SAMPLE', p.last_data_date ?? null]
      );

      return res.json({ ...mlRes.data, source: 'ml_service' });
    } catch (mlErr) {
      // ML service down — return degraded state, never fake result
      console.warn('ML service unavailable:', (mlErr as Error).message);
    }

    // Check cached prediction (last 24 hours)
    type PredRow = {
      prediction: string; confidence_up: string | null; confidence_down: string | null;
      confidence_side: string | null; model_version: string; data_source: string;
      last_data_date: string | null; predicted_at: string;
    };
    const cached = await query<PredRow>(
      `SELECT prediction, confidence_up, confidence_down, confidence_side, model_version, data_source, last_data_date, predicted_at
       FROM prediction_results WHERE symbol=$1 ORDER BY predicted_at DESC LIMIT 1`,
      [symbol]
    );

    if (cached.rows.length > 0) {
      const c = cached.rows[0];
      return res.json({
        symbol,
        prediction:    c.prediction,
        confidenceUp:  c.confidence_up ? parseFloat(c.confidence_up) : null,
        confidenceDown: c.confidence_down ? parseFloat(c.confidence_down) : null,
        confidenceSideways: c.confidence_side ? parseFloat(c.confidence_side) : null,
        modelVersion:  c.model_version,
        dataSource:    c.data_source,
        lastDataDate:  c.last_data_date,
        predictedAt:   c.predicted_at,
        source:        'cached',
        mlServiceDown: true,
        disclaimer:    'This is an educational experiment. Not investment advice. Model accuracy is limited.',
      });
    }

    return res.status(503).json({
      error:    'ML_SERVICE_UNAVAILABLE',
      message:  'ML service is not available. Train a model first: cd ml && python train.py --config config.yaml',
      mlDown:   true,
    });
  } catch (err) { next(err); }
});

// ── GET /api/insights/portfolio-risk ─────────────────────────────
insightsRouter.get('/portfolio-risk', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    type HoldRow = { symbol: string; quantity: number; avg_cost: string; close: string; sector: string };
    const hr = await query<HoldRow>(
      `SELECT h.symbol, h.quantity, h.avg_cost, hp.close, s.sector
       FROM holdings h
       LEFT JOIN (SELECT DISTINCT ON (symbol) symbol, close FROM historical_prices ORDER BY symbol, trade_date DESC) hp ON hp.symbol=h.symbol
       LEFT JOIN stocks s ON s.symbol=h.symbol
       WHERE h.user_id=$1 AND h.quantity>0`,
      [userId]
    );

    if (hr.rows.length === 0) {
      return res.json({ holdings: [], analysis: null });
    }

    type WalletRow = { balance: string };
    const wr = await query<WalletRow>(`SELECT balance FROM virtual_wallets WHERE user_id=$1`, [userId]);
    const cash = parseFloat(wr.rows[0]?.balance ?? '0');

    let totalValue = cash;
    const holdings = hr.rows.map(h => {
      const price = parseFloat(h.close ?? h.avg_cost);
      const val   = price * h.quantity;
      totalValue += val;
      return { symbol: h.symbol, quantity: h.quantity, value: val, sector: h.sector ?? 'Other' };
    });

    // Concentration
    const holdingsWithPct = holdings.map(h => ({
      ...h, pct: totalValue > 0 ? Math.round((h.value / totalValue) * 10000) / 100 : 0,
    }));
    const maxConcentration = Math.max(...holdingsWithPct.map(h => h.pct));
    const topHolding = holdingsWithPct.find(h => h.pct === maxConcentration);

    // Sector concentration
    const sectorMap: Record<string, number> = {};
    for (const h of holdings) {
      sectorMap[h.sector] = (sectorMap[h.sector] ?? 0) + h.value;
    }

    const sectorPcts = Object.entries(sectorMap).map(([sector, val]) => ({
      sector, value: val, pct: totalValue > 0 ? Math.round((val / totalValue) * 10000) / 100 : 0,
    }));

    // Simple risk score
    let riskScore = 0;
    if (maxConcentration > 50) riskScore += 2;
    else if (maxConcentration > 30) riskScore += 1;
    if (holdings.length < 3) riskScore += 2;
    else if (holdings.length < 5) riskScore += 1;

    const riskLabel = riskScore >= 3 ? 'High' : riskScore >= 1 ? 'Medium' : 'Low';

    res.json({
      totalValue: Math.round(totalValue * 100) / 100,
      cash:       Math.round(cash * 100) / 100,
      holdings:   holdingsWithPct,
      sectorAllocation: sectorPcts,
      analysis: {
        riskScore, riskLabel,
        maxConcentration, topHolding: topHolding?.symbol,
        numPositions: holdings.length,
        explanation: riskScore >= 3
          ? `High concentration risk: ${topHolding?.symbol} represents ${maxConcentration}% of your portfolio. Consider diversifying across more sectors.`
          : riskScore >= 1
          ? `Moderate risk. ${holdings.length} positions across ${Object.keys(sectorMap).length} sectors.`
          : `Well diversified: ${holdings.length} positions across ${Object.keys(sectorMap).length} sectors with no dominant position.`,
      },
      disclaimer: 'This is an educational risk analysis of your virtual portfolio. Not investment advice.',
    });
  } catch (err) { next(err); }
});

// ── GET /api/insights/trade-review ───────────────────────────────
insightsRouter.get('/trade-review', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    type OrderRow = { symbol: string; side: string; quantity: number; price: string; total: string; created_at: string | Date };
    const { rows: orders } = await query<OrderRow>(
      `SELECT symbol, side, quantity, price, total, created_at
       FROM orders WHERE user_id=$1 AND status='FILLED' ORDER BY created_at DESC`,
      [userId]
    );

    if (orders.length < 2) {
      return res.json({ orders: [], flags: [], summary: 'Make at least 2 trades to get a review.' });
    }

    const flags: string[] = [];

    // Overtrading: more than 10 trades in a day
    const tradeDays: Record<string, number> = {};
    for (const o of orders) {
      // created_at may be a Date object (PGlite) or ISO string (pg) — normalise to string
      const createdAtStr = o.created_at instanceof Date
        ? o.created_at.toISOString()
        : String(o.created_at);
      const day = createdAtStr.split('T')[0];
      tradeDays[day] = (tradeDays[day] ?? 0) + 1;
    }
    const maxPerDay = Math.max(...Object.values(tradeDays));
    if (maxPerDay > 10) flags.push(`⚠️ Overtrading detected: ${maxPerDay} orders in a single day. Active trading rarely outperforms buy-and-hold for beginners.`);

    // Concentration: same stock > 50% of total orders by value
    const symbolValue: Record<string, number> = {};
    let totalOrderValue = 0;
    for (const o of orders) {
      symbolValue[o.symbol] = (symbolValue[o.symbol] ?? 0) + parseFloat(o.total);
      totalOrderValue += parseFloat(o.total);
    }
    for (const [sym, val] of Object.entries(symbolValue)) {
      const pct = (val / totalOrderValue) * 100;
      if (pct > 50) flags.push(`⚠️ High concentration: ${Math.round(pct)}% of your trading activity is in ${sym}. Consider diversifying across sectors.`);
    }

    // Check averaging down (buying same stock after a loss)
    // (Simplified: buy → price went down → buy again)
    const symbolBuys: Record<string, number[]> = {};
    for (const o of orders) {
      if (o.side === 'BUY') {
        if (!symbolBuys[o.symbol]) symbolBuys[o.symbol] = [];
        symbolBuys[o.symbol].push(parseFloat(o.price));
      }
    }
    for (const [sym, prices] of Object.entries(symbolBuys)) {
      if (prices.length >= 2 && prices[prices.length - 1] < prices[0]) {
        flags.push(`ℹ️ Averaging down on ${sym}: you bought again after the price dropped. This can amplify losses — understand the fundamentals before averaging.`);
      }
    }

    if (flags.length === 0) flags.push('✅ No major behavioural issues detected. Keep learning and trading consistently.');

    // Store review
    await query(
      `INSERT INTO trade_reviews (user_id, review_data) VALUES ($1, $2)`,
      [userId, JSON.stringify({ flags, totalTrades: orders.length })]
    );

    res.json({
      totalTrades:  orders.length,
      uniqueStocks: Object.keys(symbolValue).length,
      flags,
      disclaimer: 'This is an automated educational review of your virtual trading behaviour. Not investment advice.',
    });
  } catch (err) { next(err); }
});

// ── GET /api/insights/model-info ─────────────────────────────────
insightsRouter.get('/model-info', requireAuth, async (_req, res, next) => {
  try {
    // Try ML service first
    try {
      const mlRes = await axios.get(`${ML_URL}/model/info`, {
        headers: { 'x-service-token': ML_TOKEN },
        timeout: 3000,
      });
      return res.json({ ...mlRes.data, source: 'ml_service' });
    } catch {
      // Fall through to DB
    }

    type ModelRow = {
      model_version: string; trained_at: string; train_start: string; train_end: string;
      test_accuracy: string; macro_f1: string; feature_list: unknown[]; data_source: string; notes: string;
    };
    const { rows } = await query<ModelRow>(
      `SELECT model_version, trained_at, train_start, train_end, test_accuracy, macro_f1, feature_list, data_source, notes
       FROM model_metadata ORDER BY trained_at DESC LIMIT 1`
    );

    if (rows.length === 0) {
      return res.json({
        status:  'NOT_TRAINED',
        message: 'No model trained yet. Run: cd ml && python train.py --config config.yaml',
      });
    }

    const m = rows[0];
    res.json({
      modelVersion:  m.model_version,
      trainedAt:     m.trained_at,
      trainDateRange: { start: m.train_start, end: m.train_end },
      testAccuracy:  parseFloat(m.test_accuracy),
      macroF1:       parseFloat(m.macro_f1),
      features:      m.feature_list,
      dataSource:    m.data_source,
      notes:         m.notes,
      source:        'db_cache',
    });
  } catch (err) { next(err); }
});
