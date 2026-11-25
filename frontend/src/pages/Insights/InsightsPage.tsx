import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { AlertCircle, Brain, TrendingUp, BarChart2, Shield, FileText, type LucideIcon } from 'lucide-react';
import api from '@/api/client';
import { formatINR, formatPercent } from '@/lib/formatters';
import { PageSpinner } from '@/components/ui/PageSpinner';
import { ErrorState } from '@/components/ui/States';

// ── Types ─────────────────────────────────────────────────────────────
type TabId = 'performance' | 'indicators' | 'ml' | 'risk' | 'review';

const SYMBOLS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'ITC', 'SBIN', 'LT'];

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'performance', label: 'Stock Performance', icon: TrendingUp },
  { id: 'indicators',  label: 'Technical Indicators', icon: BarChart2 },
  { id: 'ml',         label: 'ML Classifier',   icon: Brain },
  { id: 'risk',       label: 'Portfolio Risk',  icon: Shield },
  { id: 'review',     label: 'Trade Review',    icon: FileText },
];

// ── Shared disclaimer ─────────────────────────────────────────────────
function Disclaimer({ text }: { text: string }) {
  return (
    <div role="alert" style={{
      display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)', background: 'var(--color-sage)',
      border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
      fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 'var(--space-5)',
    }}>
      <AlertCircle size={13} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 1 }} />
      <span>{text}</span>
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────
function MetricCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div style={{ padding: 'var(--space-5)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-2)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500, fontVariantNumeric: 'tabular-nums',
        color: positive === undefined ? 'var(--color-ink)' : positive ? 'var(--color-gain)' : 'var(--color-loss)' }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-1)' }}>{sub}</div>}
    </div>
  );
}

// ── Symbol selector ───────────────────────────────────────────────────
function SymbolSelector({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
      {SYMBOLS.map(s => (
        <button key={s} onClick={() => onChange(s)} style={{
          padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-sm)', fontWeight: 600,
          border: '1px solid', borderRadius: 'var(--radius-md)', cursor: 'pointer',
          borderColor: value === s ? 'var(--color-ink)' : 'var(--color-hairline)',
          background: value === s ? 'var(--color-ink)' : 'transparent',
          color: value === s ? '#fff' : 'var(--color-ink)',
          transition: 'all var(--transition-fast)',
        }}>{s}</button>
      ))}
    </div>
  );
}

// ── Tab 1: Stock Performance ──────────────────────────────────────────
function PerformanceTab() {
  const [symbol, setSymbol] = useState('RELIANCE');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['insights-perf', symbol],
    queryFn: () => api.get(`/insights/stock-performance/${symbol}`).then(r => r.data),
  });

  return (
    <div>
      <Disclaimer text="Synthetic historical prices only — for educational analysis. Not real NSE data. Past performance does not indicate future returns." />
      <SymbolSelector value={symbol} onChange={setSymbol} />
      {isLoading && <PageSpinner />}
      {isError && <ErrorState message="Could not load performance data." onRetry={refetch} />}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
            <MetricCard label="Total Return" value={formatPercent(data.metrics.totalReturnPct)} positive={data.metrics.totalReturnPct >= 0} />
            <MetricCard label="Volatility (ann.)" value={`${data.metrics.volatilityPct.toFixed(2)}%`} sub="20-day, annualised" />
            <MetricCard label="Max Drawdown" value={`-${data.metrics.maxDrawdownPct.toFixed(2)}%`} positive={false} sub="Peak-to-trough" />
            <MetricCard label="Data Points" value={data.metrics.dataPoints.toString()} sub="Trading days" />
          </div>

          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-4)' }}>Price History — {symbol} <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', fontWeight: 700 }}>SIMULATED</span></h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.prices} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} interval={Math.floor(data.prices.length / 6)} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} width={65} tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => [formatINR(v), 'Close']} contentStyle={{ fontSize: 11, border: '1px solid var(--color-hairline)', borderRadius: 6 }} />
                  <Line type="monotone" dataKey="close" stroke="var(--color-gain)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab 2: Technical Indicators ───────────────────────────────────────
function IndicatorsTab() {
  const [symbol, setSymbol] = useState('RELIANCE');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['insights-indicators', symbol],
    queryFn: () => api.get(`/insights/indicators/${symbol}`).then(r => r.data),
  });

  return (
    <div>
      <Disclaimer text="Technical indicators are educational tools, not trading signals. These use synthetic prices. Do not use to make real investment decisions." />
      <SymbolSelector value={symbol} onChange={setSymbol} />
      {isLoading && <PageSpinner />}
      {isError && <ErrorState message="Could not load indicator data." onRetry={refetch} />}
      {data && (
        <>
          {/* Current snapshot */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
            <MetricCard label="Current Price" value={formatINR(data.current.close)} />
            <MetricCard label="RSI (14)" value={data.current.rsi !== null ? data.current.rsi.toFixed(1) : '—'} sub={data.current.rsi !== null ? (data.current.rsi > 70 ? 'Overbought' : data.current.rsi < 30 ? 'Oversold' : 'Neutral') : ''} />
            <MetricCard label="MACD" value={data.current.macd !== null ? data.current.macd.toFixed(2) : '—'} sub={`Signal: ${data.current.macdSignal?.toFixed(2) ?? '—'}`} />
            <MetricCard label="MA 20" value={data.current.ma20 !== null ? formatINR(data.current.ma20) : '—'} />
          </div>

          {/* Price + Moving Averages chart */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-4)' }}>Price &amp; Moving Averages</h3>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.history} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} interval={Math.floor(data.history.length / 6)} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} width={65} tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => [formatINR(v), '']} contentStyle={{ fontSize: 11, border: '1px solid var(--color-hairline)', borderRadius: 6 }} />
                  <Line type="monotone" dataKey="close" stroke="var(--color-ink)" strokeWidth={1.5} dot={false} name="Price" />
                  <Line type="monotone" dataKey="ma5"  stroke="#B7791F" strokeWidth={1} dot={false} strokeDasharray="4 2" name="MA5" />
                  <Line type="monotone" dataKey="ma20" stroke="var(--color-gain)" strokeWidth={1} dot={false} strokeDasharray="4 2" name="MA20" />
                  <Line type="monotone" dataKey="ma50" stroke="#1B6CA8" strokeWidth={1} dot={false} strokeDasharray="4 2" name="MA50" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
              {[{ c: 'var(--color-ink)', l: 'Price' }, { c: '#B7791F', l: 'MA5' }, { c: 'var(--color-gain)', l: 'MA20' }, { c: '#1B6CA8', l: 'MA50' }].map(x => (
                <span key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 20, height: 2, background: x.c }} /> {x.l}
                </span>
              ))}
            </div>
          </div>

          {/* RSI chart */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-4)' }}>RSI (14) — Relative Strength Index</h3>
            <div style={{ height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.history.filter((d: { rsi: number | null }) => d.rsi !== null)} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} interval={Math.floor(data.history.length / 6)} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} width={30} />
                  <Tooltip formatter={(v: number) => [v.toFixed(1), 'RSI']} contentStyle={{ fontSize: 11, border: '1px solid var(--color-hairline)', borderRadius: 6 }} />
                  <ReferenceLine y={70} stroke="var(--color-loss)" strokeDasharray="3 3" label={{ value: '70', fontSize: 10, fill: 'var(--color-loss)' }} />
                  <ReferenceLine y={30} stroke="var(--color-gain)" strokeDasharray="3 3" label={{ value: '30', fontSize: 10, fill: 'var(--color-gain)' }} />
                  <Line type="monotone" dataKey="rsi" stroke="#8B4513" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-2)' }}>{data.education.rsi}</p>
          </div>

          {/* MACD chart */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-4)' }}>MACD (12/26/9)</h3>
            <div style={{ height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.history} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} interval={Math.floor(data.history.length / 6)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip formatter={(v: number) => [v.toFixed(2), '']} contentStyle={{ fontSize: 11, border: '1px solid var(--color-hairline)', borderRadius: 6 }} />
                  <ReferenceLine y={0} stroke="var(--color-hairline)" />
                  <Line type="monotone" dataKey="macd"       stroke="var(--color-gain)"   strokeWidth={1.5} dot={false} name="MACD" />
                  <Line type="monotone" dataKey="macdSignal" stroke="var(--color-loss)"   strokeWidth={1}   dot={false} strokeDasharray="4 2" name="Signal" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-2)' }}>{data.education.macd}</p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab 3: ML Classifier ──────────────────────────────────────────────
function MLTab() {
  const [symbol, setSymbol] = useState('RELIANCE');
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['insights-ml', symbol],
    queryFn: () => api.get(`/insights/ml-prediction/${symbol}`).then(r => r.data).catch(e => {
      if (e.response?.status === 503) return e.response.data; // show degraded state
      throw e;
    }),
  });
  const { data: modelInfo } = useQuery({
    queryKey: ['model-info'],
    queryFn: () => api.get('/insights/model-info').then(r => r.data),
  });

  const predictionColor = data?.prediction === 'UP' ? 'var(--color-gain)' : data?.prediction === 'DOWN' ? 'var(--color-loss)' : 'var(--color-muted)';

  return (
    <div>
      <Disclaimer text="This ML model is an educational experiment trained on synthetic data. Its predictions have no real-world validity. This is NOT investment advice. Never make financial decisions based on this output." />

      <SymbolSelector value={symbol} onChange={setSymbol} />

      {/* Model status */}
      {modelInfo && (
        <div style={{ padding: 'var(--space-4)', background: 'var(--color-bg)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-5)', fontSize: 'var(--text-sm)' }}>
          {modelInfo.status === 'NOT_TRAINED' ? (
            <div style={{ color: 'var(--color-muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-ink)' }}>ML model not trained yet.</span> To train: <code style={{ background: 'var(--color-hairline)', padding: '1px 6px', borderRadius: 4, fontSize: 'var(--text-xs)' }}>cd ml &amp;&amp; python train.py --config config.yaml</code>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
              <span><span style={{ color: 'var(--color-muted)' }}>Model:</span> <strong>{modelInfo.modelVersion}</strong></span>
              {modelInfo.testAccuracy && <span><span style={{ color: 'var(--color-muted)' }}>Test accuracy:</span> <strong>{(modelInfo.testAccuracy * 100).toFixed(1)}%</strong></span>}
              {modelInfo.macroF1 && <span><span style={{ color: 'var(--color-muted)' }}>Macro F1:</span> <strong>{modelInfo.macroF1.toFixed(3)}</strong></span>}
              <span><span style={{ color: 'var(--color-muted)' }}>Data:</span> <strong>{modelInfo.dataSource}</strong></span>
            </div>
          )}
        </div>
      )}

      {(isLoading || isFetching) && <PageSpinner />}
      {isError && <ErrorState message="Could not load ML prediction." onRetry={refetch} />}

      {data && (
        <>
          {data.error === 'ML_SERVICE_UNAVAILABLE' || data.mlDown ? (
            <div style={{ padding: 'var(--space-6)', background: 'var(--color-bg)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
              <Brain size={32} style={{ color: 'var(--color-muted)', margin: '0 auto var(--space-4)' }} />
              <p style={{ fontWeight: 600, color: 'var(--color-ink)', marginBottom: 'var(--space-2)' }}>ML Service Unavailable</p>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>Train and start the ML service: <code style={{ background: 'var(--color-hairline)', padding: '1px 6px', borderRadius: 4 }}>cd ml &amp;&amp; python train.py --config config.yaml &amp;&amp; python serve.py</code></p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
              {/* Prediction card */}
              <div style={{ padding: 'var(--space-6)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--space-3)' }}>3-day movement prediction</div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-4xl)', fontWeight: 500, color: predictionColor, marginBottom: 'var(--space-2)' }}>
                  {data.prediction === 'UP' ? '↑' : data.prediction === 'DOWN' ? '↓' : '→'} {data.prediction}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>{symbol}</div>
                {data.source === 'cached' && (
                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)', background: 'var(--color-bg)', padding: 'var(--space-2)', borderRadius: 'var(--radius-md)' }}>
                    Cached prediction · ML service was offline when this was generated
                  </div>
                )}
              </div>

              {/* Confidence bars */}
              <div style={{ padding: 'var(--space-6)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Confidence</div>
                {[
                  { label: 'UP ↑', value: data.confidenceUp ?? data.confidence_up, color: 'var(--color-gain)' },
                  { label: 'DOWN ↓', value: data.confidenceDown ?? data.confidence_down, color: 'var(--color-loss)' },
                  { label: 'SIDEWAYS →', value: data.confidenceSideways ?? data.confidence_sideways, color: 'var(--color-muted)' },
                ].map(c => (
                  <div key={c.label} style={{ marginBottom: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}>
                      <span style={{ color: 'var(--color-muted)' }}>{c.label}</span>
                      <span style={{ fontWeight: 600 }}>{c.value !== null && c.value !== undefined ? `${(c.value * 100).toFixed(1)}%` : '—'}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--color-hairline)', borderRadius: 'var(--radius-pill)' }}>
                      <div style={{ height: '100%', width: `${(c.value ?? 0) * 100}%`, background: c.color, borderRadius: 'var(--radius-pill)' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)', background: 'rgba(183,121,31,0.06)', border: '1px solid rgba(183,121,31,0.2)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
            <strong style={{ color: 'var(--color-ink)' }}>About this model:</strong> A simple Random Forest classifier trained on synthetic OHLCV features (momentum, RSI, MA crossovers). Trained on SIMULATED data — accuracy on real markets is unknown and likely poor. This is a teaching demonstration of ML workflows, not a trading tool.
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab 4: Portfolio Risk ─────────────────────────────────────────────
function RiskTab() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['portfolio-risk'],
    queryFn: () => api.get('/insights/portfolio-risk').then(r => r.data),
  });

  const riskColors: Record<string, string> = { Low: 'var(--color-gain)', Medium: 'var(--color-accent)', High: 'var(--color-loss)' };

  return (
    <div>
      <Disclaimer text="This is an educational risk analysis of your virtual (simulated) portfolio. It does not apply to real investments. Not financial advice." />
      {isLoading && <PageSpinner />}
      {isError && <ErrorState message="Could not load risk data." onRetry={refetch} />}
      {data && (
        <>
          {!data.analysis ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-muted)', background: 'var(--color-bg)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
              <Shield size={32} style={{ margin: '0 auto var(--space-4)' }} />
              <p style={{ fontWeight: 600, color: 'var(--color-ink)', marginBottom: 'var(--space-2)' }}>No holdings yet</p>
              <p style={{ fontSize: 'var(--text-sm)' }}>Buy stocks in the simulator to see your portfolio risk analysis.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
                <MetricCard label="Total Portfolio Value" value={formatINR(data.totalValue)} sub="Cash + holdings (simulated)" />
                <MetricCard label="Number of Positions" value={data.analysis.numPositions.toString()} />
                <div style={{ padding: 'var(--space-5)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Risk Level</div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500, color: riskColors[data.analysis.riskLabel] ?? 'var(--color-ink)' }}>{data.analysis.riskLabel}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>Score: {data.analysis.riskScore}/4</div>
                </div>
              </div>

              <div style={{ padding: 'var(--space-5)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-5)' }}>
                <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-3)' }}>Analysis</h3>
                <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-ink)', lineHeight: 1.6 }}>{data.analysis.explanation}</p>
              </div>

              {data.holdings.length > 0 && (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
                  <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--color-hairline)', fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500 }}>Concentration by Holding</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg)' }}>
                        {['Symbol', 'Sector', 'Value', '% of Portfolio'].map(h => (
                          <th key={h} style={{ padding: 'var(--space-3) var(--space-4)', textAlign: h === 'Symbol' || h === 'Sector' ? 'left' : 'right', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.holdings.map((h: { symbol: string; sector: string; value: number; pct: number }) => (
                        <tr key={h.symbol} style={{ borderTop: '1px solid var(--color-hairline)' }}>
                          <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>{h.symbol}</td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>{h.sector}</td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{formatINR(h.value)}</td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                            <span style={{ color: h.pct > 50 ? 'var(--color-loss)' : h.pct > 30 ? 'var(--color-accent)' : 'var(--color-gain)' }}>{h.pct.toFixed(1)}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.sectorAllocation.length > 0 && (
                <div style={{ padding: 'var(--space-5)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
                  <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-4)' }}>Sector Allocation</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {data.sectorAllocation.map((s: { sector: string; pct: number }) => (
                      <div key={s.sector}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>
                          <span>{s.sector}</span><span style={{ fontWeight: 600 }}>{s.pct.toFixed(1)}%</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--color-hairline)', borderRadius: 'var(--radius-pill)' }}>
                          <div style={{ height: '100%', width: `${s.pct}%`, background: 'var(--color-accent)', borderRadius: 'var(--radius-pill)' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab 5: Trade Review ───────────────────────────────────────────────
function ReviewTab() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['trade-review'],
    queryFn: () => api.get('/insights/trade-review').then(r => r.data),
    staleTime: 60_000,
  });

  return (
    <div>
      <Disclaimer text="This is an automated review of your virtual trading behaviour. Flags are educational observations, not financial advice." />
      {isLoading && <PageSpinner />}
      {isError && <ErrorState message="Could not load trade review." onRetry={refetch} />}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
            <MetricCard label="Total Trades" value={data.totalTrades?.toString() ?? '0'} />
            <MetricCard label="Unique Stocks Traded" value={data.uniqueStocks?.toString() ?? '0'} />
          </div>

          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-5)' }}>Behavioural Observations</h3>
            {data.summary && (
              <p style={{ color: 'var(--color-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>{data.summary}</p>
            )}
            {data.flags?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {data.flags?.map((flag: string, i: number) => {
                  const isWarning = flag.startsWith('⚠️');
                  const isOk      = flag.startsWith('✅');
                  const bg = isOk ? 'rgba(47,125,91,0.06)' : isWarning ? 'rgba(180,68,60,0.06)' : 'rgba(183,121,31,0.06)';
                  const border = isOk ? 'rgba(47,125,91,0.3)' : isWarning ? 'rgba(180,68,60,0.3)' : 'rgba(183,121,31,0.3)';
                  return (
                    <div key={i} style={{ padding: 'var(--space-4)', background: bg, border: `1px solid ${border}`, borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
                      {flag}
                    </div>
                  );
                })}
              </div>
            ) : !data.summary && (
              <p style={{ color: 'var(--color-muted)', fontSize: 'var(--text-sm)' }}>No flags yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────
export default function InsightsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('performance');

  return (
    <div style={{ padding: 'var(--space-8) var(--space-6)', maxWidth: 'var(--content-max)', margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Insights</span>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 500, color: 'var(--color-ink)', marginTop: 'var(--space-2)' }}>
          Market &amp; Portfolio <em style={{ color: 'var(--color-accent)' }}>Insights</em>
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-2)', maxWidth: '65ch' }}>
          Analyse simulated stock performance, explore technical indicators, see an ML model in action, and get a review of your virtual trading behaviour — all for learning, never for real trading.
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-hairline)', marginBottom: 'var(--space-7)', gap: 0, overflowX: 'auto' }}>
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: 'var(--space-3) var(--space-4)', border: 'none', background: 'transparent',
              cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: active ? 700 : 400,
              color: active ? 'var(--color-ink)' : 'var(--color-muted)',
              borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
              marginBottom: -1, whiteSpace: 'nowrap', transition: 'color var(--transition-fast)',
            }}>
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'performance' && <PerformanceTab />}
        {activeTab === 'indicators'  && <IndicatorsTab />}
        {activeTab === 'ml'          && <MLTab />}
        {activeTab === 'risk'        && <RiskTab />}
        {activeTab === 'review'      && <ReviewTab />}
      </div>

      {/* Footer note */}
      <div style={{ marginTop: 'var(--space-8)', padding: 'var(--space-3) var(--space-4)', background: 'var(--color-sage)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
        ⓘ FINQUEST Insights use synthetic/simulated data only. Indicators and ML outputs are demonstrations for financial education. SEBI reminds investors: past performance is not a guarantee of future results. This platform is not registered as an investment advisor.
      </div>
    </div>
  );
}
