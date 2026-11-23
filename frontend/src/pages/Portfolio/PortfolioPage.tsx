import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis } from 'recharts';
import api from '@/api/client';
import { formatINR, formatPercent, gainLossClass } from '@/lib/formatters';
import { PageSpinner } from '@/components/ui/PageSpinner';
import { ErrorState, EmptyState } from '@/components/ui/States';

const SECTOR_COLORS = ['#B7791F', '#2F7D5B', '#1B6CA8', '#8B4513', '#6B4F8E', '#4A7C59', '#C0392B', '#2980B9'];

export default function PortfolioPage() {
  const { data: summary, isLoading, isError, refetch } = useQuery({
    queryKey: ['portfolio-summary'],
    queryFn: () => api.get('/portfolio/summary').then(r => r.data),
  });
  const { data: snapshots } = useQuery({
    queryKey: ['portfolio-snapshots'],
    queryFn: () => api.get('/portfolio/snapshots').then(r => r.data),
  });
  const { data: transactions } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.get('/portfolio/transactions').then(r => r.data),
  });

  if (isLoading) return <PageSpinner />;
  if (isError) return <ErrorState message="Could not load portfolio." onRetry={refetch} />;

  const hasActivity = summary?.holdings?.length > 0 || summary?.realisedPnl !== 0;

  return (
    <div style={{ padding: 'var(--space-8) var(--space-6)', maxWidth: 'var(--content-max)', margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Portfolio</span>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 500, color: 'var(--color-ink)', marginTop: 'var(--space-2)' }}>Portfolio Analytics</h1>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
        {[
          { label: 'Total Value', value: formatINR(summary?.totalValue ?? 0), sub: 'Cash + Holdings' },
          { label: 'Cash Balance', value: formatINR(summary?.cash ?? 0), sub: 'Available to invest' },
          { label: 'Amount Invested', value: formatINR(summary?.invested ?? 0), sub: 'At avg cost' },
          { label: 'Unrealised P&L', value: formatINR(summary?.unrealisedPnl ?? 0), sub: formatPercent(summary?.returnPct ?? 0), cls: gainLossClass(summary?.unrealisedPnl ?? 0) },
          { label: 'Realised P&L', value: formatINR(summary?.realisedPnl ?? 0), sub: 'From closed trades', cls: gainLossClass(summary?.realisedPnl ?? 0) },
        ].map(({ label, value, sub, cls }) => (
          <div key={label} style={{ padding: 'var(--space-5)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', fontWeight: 500, marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }} className={cls}>{value}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>{sub}</div>
          </div>
        ))}
      </div>

      {!hasActivity ? (
        <EmptyState message="No holdings yet. Place your first trade in the Market Simulator." action={{ label: 'Open Simulator →', href: '/simulator' }} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-8)' }}>
          {/* Performance chart */}
          {snapshots && snapshots.length > 1 && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500, marginBottom: 'var(--space-5)' }}>Portfolio Performance</h2>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={snapshots} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} width={70} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [formatINR(v), 'Portfolio Value']} contentStyle={{ fontSize: 11, border: '1px solid var(--color-hairline)', borderRadius: 6 }} />
                    <Line type="monotone" dataKey="totalValue" stroke="var(--color-gain)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Holdings + Allocation grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 'var(--space-6)' }}>
            {/* Holdings table */}
            {summary?.holdings?.length > 0 && (
              <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--color-hairline)', fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500 }}>Holdings</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                  <thead>
                    <tr style={{ background: 'var(--color-bg)' }}>
                      {['Stock', 'Qty', 'Avg Cost', 'Price', 'P&L', '%'].map(h => (
                        <th key={h} style={{ padding: 'var(--space-3) var(--space-4)', textAlign: h === 'Stock' ? 'left' : 'right', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.holdings.map((h: { symbol: string; quantity: number; avgCost: number; price: number; pnl: number; pnlPct: number }) => (
                      <tr key={h.symbol} style={{ borderTop: '1px solid var(--color-hairline)' }}>
                        <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>{h.symbol}</td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{h.quantity}</td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{formatINR(h.avgCost)}</td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{formatINR(h.price)}</td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600 }} className={gainLossClass(h.pnl)}>{formatINR(h.pnl)}</td>
                        <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600 }} className={gainLossClass(h.pnlPct)}>{formatPercent(h.pnlPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sector allocation */}
            {summary?.sectorAllocation?.length > 0 && (
              <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
                <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-4)' }}>Allocation</h3>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={summary.sectorAllocation} dataKey="value" nameKey="sector" cx="50%" cy="50%" outerRadius={70} stroke="none">
                        {summary.sectorAllocation.map((_: unknown, i: number) => <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => [formatINR(v), 'Value']} contentStyle={{ fontSize: 11, border: '1px solid var(--color-hairline)', borderRadius: 6 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {summary.sectorAllocation.map((s: { sector: string; pct: number }, i: number) => (
                  <div key={s.sector} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: SECTOR_COLORS[i % SECTOR_COLORS.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--color-muted)' }}>{s.sector}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Transactions */}
          {transactions && transactions.length > 0 && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--color-hairline)', fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500 }}>Transaction History</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    {['Date', 'Type', 'Description', 'Amount', 'Balance After'].map(h => (
                      <th key={h} style={{ padding: 'var(--space-3) var(--space-4)', textAlign: ['Amount', 'Balance After'].includes(h) ? 'right' : 'left', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 20).map((t: { id: string; createdAt: string; type: string; description: string; amount: number; balanceAfter: number }) => (
                    <tr key={t.id} style={{ borderTop: '1px solid var(--color-hairline)' }}>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{new Date(t.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>{t.type}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>{t.description}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600 }} className={gainLossClass(t.type === 'ORDER_BUY' ? -1 : 1)}>{formatINR(t.amount)}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{formatINR(t.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 'var(--space-6)', padding: 'var(--space-3) var(--space-4)', background: 'var(--color-sage)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
        ⓘ P&L calculated using weighted average cost method. All prices are simulated. FINQUEST is an educational platform.
      </div>
    </div>
  );
}
