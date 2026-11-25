import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, TrendingUp, TrendingDown, Search } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api from '@/api/client';
import { formatINR, formatPercent, gainLossClass } from '@/lib/formatters';
import { PageSpinner } from '@/components/ui/PageSpinner';
import { ErrorState } from '@/components/ui/States';

type Stock = { symbol: string; name: string; sector: string; price: number; change: number; priceType: string };
type Holding = { symbol: string; quantity: number; avgCost: number; currentPrice: number; unrealisedPnl: number; unrealisedPnlPct: number; priceType: string };

export default function SimulatorPage() {
  const [selected, setSelected] = useState<Stock | null>(null);
  const [search, setSearch] = useState('');

  const { data: stocks, isLoading, isError, refetch } = useQuery<Stock[]>({
    queryKey: ['market-stocks'],
    queryFn: () => api.get('/market/stocks').then(r => r.data),
    refetchInterval: 60_000,
  });
  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: () => api.get('/simulator/wallet').then(r => r.data) });
  const { data: holdings } = useQuery<Holding[]>({ queryKey: ['holdings'], queryFn: () => api.get('/simulator/holdings').then(r => r.data) });

  if (isLoading) return <PageSpinner />;
  if (isError) return <ErrorState message="Could not load market data." onRetry={refetch} />;

  const filtered = (stocks ?? []).filter(s =>
    search === '' || s.symbol.includes(search.toUpperCase()) || s.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 'var(--content-max)', margin: '0 auto' }}>
      {/* Disclaimer banner */}
      <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)', background: 'var(--color-sage)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-6)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
        <AlertCircle size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
        All prices are <strong style={{ color: 'var(--color-ink)' }}>SIMULATED</strong> — synthetic data for educational use only. Not real NSE prices. No real money involved.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
        {/* Left: stock list */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--color-hairline)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500 }}>NSE Instruments</h2>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-gain)', fontWeight: 600, background: 'rgba(47,125,91,0.08)', padding: '2px 8px', borderRadius: 'var(--radius-pill)' }}>SIMULATED</span>
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }} />
              <input type="search" placeholder="Search symbol or name…" value={search} onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', padding: 'var(--space-2) var(--space-3) var(--space-2) 2rem', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', background: 'var(--color-bg)', color: 'var(--color-ink)' }} />
            </div>
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {filtered.map(s => (
              <button key={s.symbol} onClick={() => setSelected(s)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-3) var(--space-4)', background: selected?.symbol === s.symbol ? 'var(--color-sage)' : 'transparent', cursor: 'pointer', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--color-hairline)' }}>
                <div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-ink)' }}>{s.symbol}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{s.sector}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--color-ink)' }}>{formatINR(s.price)}</div>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }} className={gainLossClass(s.change)}>
                    {s.change >= 0 ? '▲' : '▼'} {Math.abs(s.change).toFixed(2)}%
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: selected stock detail + order */}
        {selected ? (
          <StockDetail stock={selected} wallet={wallet} holdings={holdings ?? []} />
        ) : (
          <div style={{ background: 'var(--color-sage)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-12)', textAlign: 'center' }}>
            <TrendingUp size={32} style={{ color: 'var(--color-muted)', margin: '0 auto var(--space-4)' }} />
            <p style={{ color: 'var(--color-muted)' }}>Select a stock to view details and place an order.</p>
          </div>
        )}
      </div>

      {/* Holdings table */}
      {holdings && holdings.length > 0 && (
        <div style={{ marginTop: 'var(--space-8)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--color-hairline)', fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500 }}>Current Holdings</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                {['Symbol', 'Qty', 'Avg Cost', 'Current Price', 'Unrealised P&L', 'Return %'].map(h => (
                  <th key={h} style={{ padding: 'var(--space-3) var(--space-4)', textAlign: h === 'Symbol' ? 'left' : 'right', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holdings.map(h => (
                <tr key={h.symbol} style={{ borderTop: '1px solid var(--color-hairline)' }}>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>{h.symbol}</td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{h.quantity}</td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{formatINR(h.avgCost)}</td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{formatINR(h.currentPrice)}</td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600 }} className={gainLossClass(h.unrealisedPnl)}>{formatINR(h.unrealisedPnl)}</td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600 }} className={gainLossClass(h.unrealisedPnlPct)}>{formatPercent(h.unrealisedPnlPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StockDetail({ stock, wallet, holdings }: { stock: Stock; wallet: { balance: number } | undefined; holdings: Holding[] }) {
  const qc = useQueryClient();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [qty, setQty] = useState('1');
  const [orderMsg, setOrderMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data: detail } = useQuery({
    queryKey: ['stock-detail', stock.symbol],
    queryFn: () => api.get(`/market/stocks/${stock.symbol}`).then(r => r.data),
  });

  const orderMutation = useMutation({
    mutationFn: (data: { symbol: string; side: string; quantity: number }) => api.post('/simulator/orders', data).then(r => r.data),
    onSuccess: () => {
      setOrderMsg({ type: 'success', text: `${side} order for ${qty} × ${stock.symbol} executed!` });
      setQty('1');
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['holdings'] });
      qc.invalidateQueries({ queryKey: ['portfolio-summary'] });
      setTimeout(() => setOrderMsg(null), 4000);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setOrderMsg({ type: 'error', text: err.response?.data?.message ?? 'Order failed.' });
    },
  });

  const quantity = parseInt(qty, 10);
  const orderTotal = isFinite(quantity) && quantity > 0 ? stock.price * quantity : 0;
  const currentHolding = holdings.find(h => h.symbol === stock.symbol);

  // Build chart data from last 60 prices
  const chartData = detail?.prices?.slice(-60).map((p: { date: string; close: number }) => ({ date: p.date.slice(5), price: p.close })) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Header */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-1)' }}>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)', fontWeight: 500 }}>{stock.symbol}</h2>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-accent)', border: '1px solid var(--color-accent)', padding: '2px 6px', borderRadius: 2 }}>SIMULATED</span>
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>{stock.name} · {stock.sector}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{formatINR(stock.price)}</div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }} className={gainLossClass(stock.change)}>
              {stock.change >= 0 ? <TrendingUp size={12} style={{ display: 'inline' }} /> : <TrendingDown size={12} style={{ display: 'inline' }} />} {formatPercent(stock.change)}
            </div>
          </div>
        </div>

        {/* Chart */}
        {chartData.length > 0 && (
          <div style={{ height: 160, marginBottom: 'var(--space-2)' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} width={60} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [formatINR(v), 'Price']} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, border: '1px solid var(--color-hairline)', borderRadius: 6 }} />
                <Line type="monotone" dataKey="price" stroke="var(--color-gain)" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textAlign: 'center' }}>Synthetic prices · Educational only · Not real NSE data</p>
      </div>

      {/* Order panel */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-4)' }}>Place Order</h3>

        {/* Virtual cash */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
          <span style={{ color: 'var(--color-muted)' }}>Virtual Cash Available</span>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatINR(wallet?.balance ?? 0)}</strong>
        </div>

        {currentHolding && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ color: 'var(--color-muted)' }}>Shares Held</span>
            <strong>{currentHolding.quantity} shares</strong>
          </div>
        )}

        {/* Buy/Sell toggle */}
        <div style={{ display: 'flex', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-hairline)', marginBottom: 'var(--space-4)' }}>
          {(['BUY', 'SELL'] as const).map(s => (
            <button key={s} onClick={() => setSide(s)} style={{ flex: 1, padding: 'var(--space-3)', fontWeight: 700, fontSize: 'var(--text-sm)', border: 'none', cursor: 'pointer', background: side === s ? (s === 'BUY' ? 'var(--color-gain)' : 'var(--color-loss)') : 'transparent', color: side === s ? '#fff' : 'var(--color-muted)', transition: 'all var(--transition-fast)' }}>{s}</button>
          ))}
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-muted)', marginBottom: 'var(--space-4)' }}>
          Quantity (shares)
          <input type="number" min={1} max={10000} value={qty} onChange={e => setQty(e.target.value)}
            style={{ padding: 'var(--space-3)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-base)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-ink)', background: 'var(--color-bg)' }} />
        </label>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', padding: 'var(--space-3)', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)' }}>
          <span style={{ color: 'var(--color-muted)' }}>Order value</span>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatINR(orderTotal)}</strong>
        </div>

        {orderMsg && (
          <div style={{ padding: 'var(--space-3)', background: orderMsg.type === 'success' ? 'rgba(47,125,91,0.08)' : 'rgba(180,68,60,0.08)', border: `1px solid ${orderMsg.type === 'success' ? 'rgba(47,125,91,0.3)' : 'rgba(180,68,60,0.3)'}`, borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', color: orderMsg.type === 'success' ? 'var(--color-gain)' : 'var(--color-loss)', marginBottom: 'var(--space-3)' }}>
            {orderMsg.text}
          </div>
        )}

        <button
          disabled={!quantity || quantity < 1 || orderMutation.isPending}
          onClick={() => orderMutation.mutate({ symbol: stock.symbol, side, quantity })}
          style={{ width: '100%', padding: 'var(--space-3)', background: side === 'BUY' ? 'var(--color-gain)' : 'var(--color-loss)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 700, cursor: quantity >= 1 ? 'pointer' : 'not-allowed', opacity: (quantity < 1 || orderMutation.isPending) ? 0.6 : 1 }}
        >
          {orderMutation.isPending ? 'Placing Order…' : `${side} ${qty || 0} × ${stock.symbol}`}
        </button>

        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textAlign: 'center', marginTop: 'var(--space-3)' }}>
          Virtual money only · Educational simulation · Not real trading
        </p>
      </div>
    </div>
  );
}
