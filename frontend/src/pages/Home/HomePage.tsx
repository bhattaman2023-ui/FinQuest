import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { TrendingUp, BookOpen, Award } from 'lucide-react';
import api from '@/api/client';
import useAuthStore from '@/store/authStore';
import { formatINR, formatPercent, gainLossClass } from '@/lib/formatters';
import { PageSpinner } from '@/components/ui/PageSpinner';
import { ErrorState } from '@/components/ui/States';

export default function HomePage() {
  const { user } = useAuthStore();

  const { data: portfolio, isLoading: portLoading, isError: portError, refetch } = useQuery({
    queryKey: ['portfolio-summary'],
    queryFn: () => api.get('/portfolio/summary').then(r => r.data),
    retry: 1,
  });

  const { data: courses } = useQuery({
    queryKey: ['courses'],
    queryFn: () => api.get('/courses').then(r => r.data),
    retry: 1,
  });

  const { data: gamification } = useQuery({
    queryKey: ['gamification-profile'],
    queryFn: () => api.get('/gamification/profile').then(r => r.data),
    retry: 1,
  });

  if (portLoading) return <PageSpinner />;
  if (portError) return <ErrorState message="Could not load your portfolio." onRetry={refetch} />;

  const isNewUser = !portfolio || (portfolio.totalValue === 100000 && portfolio.holdings?.length === 0);

  return (
    <div style={{ padding: 'var(--space-8) var(--space-6)', maxWidth: 'var(--content-max)', margin: '0 auto' }}>
      {/* Welcome */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
          {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 500, color: 'var(--color-ink)', marginTop: 'var(--space-2)' }}>
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'},{' '}
          <em style={{ fontStyle: 'italic', color: 'var(--color-accent)' }}>{user?.displayName.split(' ')[0]}</em>
        </h1>
      </div>

      {isNewUser ? (
        <OnboardingState />
      ) : (
        <DashboardContent portfolio={portfolio} gamification={gamification} courses={courses} />
      )}
    </div>
  );
}

function OnboardingState() {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
      <div style={{ background: 'var(--color-sage)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-8)' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500, color: 'var(--color-ink)', marginBottom: 'var(--space-3)' }}>
          Your ₹1,00,000 virtual cash is ready.
        </h2>
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--color-muted)', lineHeight: 'var(--leading-loose)', maxWidth: '52ch', marginBottom: 'var(--space-6)' }}>
          Start by learning the basics, then try trading with virtual money. Everything here is simulated — no real money, no real risk.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <Link to="/learn" style={{ padding: 'var(--space-3) var(--space-6)', background: 'var(--color-ink)', color: '#fff', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 600, textDecoration: 'none' }}>
            Start Learning
          </Link>
          <Link to="/simulator" style={{ padding: 'var(--space-3) var(--space-6)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 600, textDecoration: 'none', color: 'var(--color-ink)' }}>
            Explore Simulator
          </Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)' }}>
        {[
          { icon: BookOpen, label: 'Start Here', desc: 'Why Invest? — 8 min', href: '/learn/money-basics/why-invest' },
          { icon: TrendingUp, label: 'Try Trading', desc: 'Buy your first stock', href: '/simulator' },
          { icon: Award, label: 'Earn XP', desc: 'Complete your first lesson', href: '/learn' },
        ].map(({ icon: Icon, label, desc, href }) => (
          <Link key={label} to={href} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-5)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', textDecoration: 'none', transition: 'border-color var(--transition-fast)' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-hairline)')}
          >
            <Icon size={20} color="var(--color-accent)" />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-ink)' }}>{label}</span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function DashboardContent({ portfolio, gamification, courses }: { portfolio: Record<string, unknown>; gamification: Record<string, unknown> | undefined; courses: Array<Record<string, unknown>> | undefined }) {
  const totalValue    = portfolio?.totalValue as number ?? 0;
  const cash          = portfolio?.cash as number ?? 0;
  const unrealisedPnl = portfolio?.unrealisedPnl as number ?? 0;
  const returnPct     = portfolio?.returnPct as number ?? 0;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-8)' }}>
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)' }}>
        {[
          { label: 'Portfolio Value', value: formatINR(totalValue), sub: 'Total' },
          { label: 'Cash Available', value: formatINR(cash), sub: 'Virtual' },
          { label: 'Unrealised P&L', value: formatINR(unrealisedPnl), sub: formatPercent(returnPct), valClass: gainLossClass(unrealisedPnl) },
          { label: 'Level / XP', value: `Lv ${gamification?.level ?? 1}`, sub: `${gamification?.totalXp ?? 0} XP` },
        ].map(({ label, value, sub, valClass }) => (
          <div key={label} style={{ padding: 'var(--space-5)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', fontWeight: 500, marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }} className={valClass}>{value}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Holdings preview */}
      {Array.isArray(portfolio?.holdings) && (portfolio.holdings as Array<Record<string, unknown>>).length > 0 && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--color-hairline)' }}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500 }}>Holdings</h2>
            <Link to="/portfolio" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', fontWeight: 600 }}>View all →</Link>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                {['Stock', 'Qty', 'Avg Cost', 'Current', 'P&L'].map(h => (
                  <th key={h} style={{ padding: 'var(--space-3) var(--space-5)', textAlign: h === 'Stock' ? 'left' : 'right', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(portfolio.holdings as Array<Record<string, unknown>>).slice(0, 5).map((h: Record<string, unknown>) => (
                <tr key={h.symbol as string} style={{ borderTop: '1px solid var(--color-hairline)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td style={{ padding: 'var(--space-3) var(--space-5)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{h.symbol as string}</td>
                  <td style={{ padding: 'var(--space-3) var(--space-5)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{h.quantity as number}</td>
                  <td style={{ padding: 'var(--space-3) var(--space-5)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{formatINR(h.avgCost as number)}</td>
                  <td style={{ padding: 'var(--space-3) var(--space-5)', textAlign: 'right', fontSize: 'var(--text-sm)' }}>{formatINR(h.currentPrice as number)}</td>
                  <td style={{ padding: 'var(--space-3) var(--space-5)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600 }} className={gainLossClass(h.unrealisedPnl as number)}>
                    {formatINR(h.unrealisedPnl as number)} ({formatPercent(h.unrealisedPnlPct as number)})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Learning progress */}
      {Array.isArray(courses) && courses.length > 0 && (
        <div>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500, marginBottom: 'var(--space-5)' }}>Learning Progress</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)' }}>
            {courses.slice(0, 3).map((c: Record<string, unknown>) => (
              <Link key={c.slug as string} to={`/learn/${c.slug}`} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-5)', background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>{c.category as string}</div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-ink)' }}>{c.title as string}</div>
                <div style={{ height: 4, background: 'var(--color-hairline)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--color-gain)', width: `${c.progress}%`, borderRadius: 'var(--radius-pill)', transition: 'width 0.5s' }} />
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{c.completedLessons as number}/{c.totalLessons as number} lessons</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--color-sage)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
        ⓘ All prices and portfolio values are simulated. FINQUEST is an educational platform — not financial advice.
      </div>
    </div>
  );
}
