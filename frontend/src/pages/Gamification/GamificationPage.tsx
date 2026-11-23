import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';
import useAuthStore from '@/store/authStore';
import { PageSpinner } from '@/components/ui/PageSpinner';
import { ErrorState } from '@/components/ui/States';

export default function GamificationPage() {
  const { user } = useAuthStore();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['gamification-profile'],
    queryFn: () => api.get('/gamification/profile').then(r => r.data),
  });
  const { data: leaderboard } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => api.get('/gamification/leaderboard').then(r => r.data),
  });

  if (isLoading) return <PageSpinner />;
  if (isError) return <ErrorState message="Could not load gamification data." onRetry={refetch} />;

  const xpToNext = data?.xpToNextLevel ?? 500;
  const xpProgress = data ? (500 - xpToNext) / 500 * 100 : 0;

  return (
    <div style={{ padding: 'var(--space-8) var(--space-6)', maxWidth: 'var(--content-max)', margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Gamification</span>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 500, color: 'var(--color-ink)', marginTop: 'var(--space-2)' }}>XP, Badges & Challenges</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-8)' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Level card */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
              <div style={{ width: 56, height: 56, background: 'var(--color-ink)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500 }}>
                {user?.avatarInitials}
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500 }}>{user?.displayName}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-accent)', fontWeight: 600 }}>Level {data?.level ?? 1}</div>
              </div>
            </div>

            <div style={{ marginBottom: 'var(--space-2)', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
              <span style={{ color: 'var(--color-muted)' }}>XP Progress</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{data?.totalXp ?? 0} XP</span>
            </div>
            <div style={{ height: 8, background: 'var(--color-hairline)', borderRadius: 'var(--radius-pill)', overflow: 'hidden', marginBottom: 'var(--space-2)' }}>
              <div style={{ height: '100%', background: 'var(--color-accent)', width: `${xpProgress}%`, borderRadius: 'var(--radius-pill)', transition: 'width 0.5s' }} />
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{xpToNext} XP to Level {(data?.level ?? 1) + 1}</div>

            {/* Streak */}
            <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-5)', borderTop: '1px solid var(--color-hairline)', display: 'flex', gap: 'var(--space-6)' }}>
              <div>
                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-ink)' }}>{data?.streak?.current ?? 0}🔥</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>Day streak</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-muted)' }}>{data?.streak?.longest ?? 0}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>Longest streak</div>
              </div>
            </div>
          </div>

          {/* Badges */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-4)' }}>Badges ({data?.badges?.length ?? 0})</h3>
            {data?.badges?.length === 0 ? (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>Complete lessons and quizzes to earn badges!</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                {data?.badges?.map((b: { code: string; icon: string; name: string; description: string; awarded_at: string }) => (
                  <div key={b.code} title={`${b.name}: ${b.description}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)', padding: 'var(--space-3)', background: 'var(--color-sage)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', cursor: 'help', minWidth: 72 }}>
                    <span style={{ fontSize: 24 }}>{b.icon}</span>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-ink)', textAlign: 'center' }}>{b.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent XP */}
          {data?.recentXp?.length > 0 && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
              <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-4)' }}>Recent XP</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {data.recentXp.slice(0, 8).map((x: { source_type: string; xp_amount: number; description: string; created_at: string }, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-hairline)' }}>
                    <span style={{ color: 'var(--color-muted)' }}>{x.description}</span>
                    <span style={{ color: 'var(--color-gain)', fontWeight: 700 }}>+{x.xp_amount} XP</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Challenges */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500, marginBottom: 'var(--space-4)' }}>Challenges</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {data?.challenges?.map((c: { code: string; title: string; description: string; xp_reward: number; progress: number; completed: boolean }) => (
                <div key={c.code} style={{ padding: 'var(--space-4)', background: c.completed ? 'rgba(47,125,91,0.06)' : 'var(--color-bg)', border: `1px solid ${c.completed ? 'rgba(47,125,91,0.3)' : 'var(--color-hairline)'}`, borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
                    <div>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-ink)' }}>{c.title}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{c.description}</div>
                    </div>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: c.completed ? 'var(--color-gain)' : 'var(--color-accent)', background: c.completed ? 'rgba(47,125,91,0.1)' : 'rgba(183,121,31,0.1)', padding: '2px 8px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap' }}>
                      {c.completed ? '✓ Done' : `+${c.xp_reward} XP`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Leaderboard */}
          {leaderboard && leaderboard.length > 0 && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--color-hairline)', fontFamily: 'var(--font-serif)', fontSize: 'var(--text-lg)', fontWeight: 500 }}>Leaderboard</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    {['Rank', 'User', 'Level', 'XP'].map(h => (
                      <th key={h} style={{ padding: 'var(--space-2) var(--space-4)', textAlign: ['XP'].includes(h) ? 'right' : 'left', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.slice(0, 10).map((row: { rank: number; displayName: string; avatarInitials: string; level: number; totalXp: number }) => (
                    <tr key={row.rank} style={{ borderTop: '1px solid var(--color-hairline)', background: row.rank <= 3 ? 'rgba(183,121,31,0.03)' : '' }}>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', fontWeight: 700, color: row.rank <= 3 ? 'var(--color-accent)' : 'var(--color-muted)' }}>{row.rank}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{row.displayName}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>{row.level}</td>
                      <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{row.totalXp.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: 'var(--space-3) var(--space-5)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)', borderTop: '1px solid var(--color-hairline)' }}>
                XP is earned by learning — not by trading profits. This keeps the focus on education.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
