import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import api from '@/api/client';
import { PageSpinner } from '@/components/ui/PageSpinner';
import { ErrorState } from '@/components/ui/States';

const CATEGORIES = [
  { key: 'all',         label: 'All' },
  { key: 'basics',      label: 'Money Basics' },
  { key: 'equity',      label: 'Equity & Markets' },
  { key: 'fixed-income',label: 'Fixed Income' },
  { key: 'derivatives', label: 'Derivatives' },
  { key: 'govt-savings',label: 'Govt. Savings' },
  { key: 'taxes',       label: 'Taxes' },
];

type Course = { id: string; slug: string; title: string; category: string; description: string; totalLessons: number; completedLessons: number; progress: number };

export default function LearnPage() {
  const [params] = useSearchParams();
  const [catFilter, setCatFilter] = useState(params.get('cat') ?? 'all');
  const [search, setSearch] = useState('');

  const { data: courses, isLoading, isError, refetch } = useQuery<Course[]>({
    queryKey: ['courses'],
    queryFn: () => api.get('/courses').then(r => r.data),
  });

  if (isLoading) return <PageSpinner />;
  if (isError)   return <ErrorState message="Could not load courses." onRetry={refetch} />;

  const filtered = (courses ?? []).filter(c =>
    (catFilter === 'all' || c.category === catFilter) &&
    (search === '' || c.title.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div style={{ padding: 'var(--space-8) var(--space-6)', maxWidth: 'var(--content-max)', margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Learn</span>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 500, color: 'var(--color-ink)', marginTop: 'var(--space-2)' }}>Financial Literacy Courses</h1>
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--color-muted)', marginTop: 'var(--space-3)', maxWidth: '52ch' }}>
          Structured lessons written for Indian beginners. Real examples, real context.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }} />
          <input
            type="search" placeholder="Search courses…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: 'var(--space-2) var(--space-3) var(--space-2) 2rem', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', background: 'var(--color-surface)', color: 'var(--color-ink)' }}
          />
        </div>
        {/* Category filter */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {CATEGORIES.map(c => (
            <button key={c.key} onClick={() => setCatFilter(c.key)}
              style={{ padding: 'var(--space-1) var(--space-3)', border: `1px solid ${catFilter === c.key ? 'var(--color-ink)' : 'var(--color-hairline)'}`, borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', fontWeight: 600, background: catFilter === c.key ? 'var(--color-ink)' : 'transparent', color: catFilter === c.key ? '#fff' : 'var(--color-muted)', cursor: 'pointer', transition: 'all var(--transition-fast)' }}
            >
              {c.label}
            </button>
          ))}
        </div>
        {/* Glossary link */}
        <Link to="/learn/glossary" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>Glossary →</Link>
      </div>

      {/* Course list */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {filtered.length === 0 && (
          <p style={{ color: 'var(--color-muted)', padding: 'var(--space-8)', textAlign: 'center' }}>No courses match your filter.</p>
        )}
        {filtered.map(c => (
          <CourseRow key={c.id} course={c} />
        ))}
      </div>
    </div>
  );
}

function CourseRow({ course: c }: { course: Course }) {
  return (
    <Link
      to={`/learn/${c.slug}`}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', padding: 'var(--space-5) 0', borderBottom: '1px solid var(--color-hairline)', textDecoration: 'none', color: 'inherit', transition: 'background var(--transition-fast)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg)'; e.currentTarget.style.marginInline = '-1rem'; e.currentTarget.style.paddingInline = '1rem'; }}
      onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.marginInline = ''; e.currentTarget.style.paddingInline = ''; }}
    >
      {/* Category pill */}
      <span style={{ width: 100, flexShrink: 0, fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>{c.category}</span>

      {/* Title + desc */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--color-ink)', marginBottom: 'var(--space-1)' }}>{c.title}</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>{c.description}</div>
      </div>

      {/* Progress */}
      <div style={{ width: 140, flexShrink: 0 }}>
        <div style={{ height: 4, background: 'var(--color-hairline)', borderRadius: 'var(--radius-pill)', overflow: 'hidden', marginBottom: 'var(--space-1)' }}>
          <div style={{ height: '100%', background: c.progress === 100 ? 'var(--color-gain)' : 'var(--color-accent)', width: `${c.progress}%`, borderRadius: 'var(--radius-pill)' }} />
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {c.completedLessons}/{c.totalLessons} lessons
          {c.progress === 100 && ' ✓'}
        </div>
      </div>

      <span style={{ color: 'var(--color-muted)', fontSize: 'var(--text-sm)' }}>→</span>
    </Link>
  );
}
