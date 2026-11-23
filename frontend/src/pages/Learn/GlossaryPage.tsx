import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import api from '@/api/client';
import { PageSpinner } from '@/components/ui/PageSpinner';
import { ErrorState } from '@/components/ui/States';

const CATEGORIES = ['all', 'basics', 'equity', 'fixed-income', 'derivatives', 'savings', 'taxes', 'risk', 'regulation', 'indices'];

type Term = { id: string; term: string; definition: string; category: string; example: string | null };

export default function GlossaryPage() {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');

  const { data, isLoading, isError, refetch } = useQuery<Term[]>({
    queryKey: ['glossary', search, cat],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (cat !== 'all') params.set('category', cat);
      return api.get(`/courses/glossary/all?${params}`).then(r => r.data);
    },
  });

  if (isLoading) return <PageSpinner />;
  if (isError)   return <ErrorState message="Could not load glossary." onRetry={refetch} />;

  return (
    <div style={{ padding: 'var(--space-8) var(--space-6)', maxWidth: 'var(--content-max)', margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Learn</span>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 500, color: 'var(--color-ink)', marginTop: 'var(--space-2)' }}>Financial Glossary</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-3)' }}>{data?.length ?? 0} terms</p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)' }} />
          <input type="search" placeholder="Search terms…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: 'var(--space-2) var(--space-3) var(--space-2) 2rem', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', background: 'var(--color-surface)', color: 'var(--color-ink)' }} />
        </div>
        <select value={cat} onChange={e => setCat(e.target.value)}
          style={{ padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', background: 'var(--color-surface)', color: 'var(--color-ink)' }}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {(data ?? []).map(t => (
          <div key={t.id} style={{ padding: 'var(--space-5) 0', borderBottom: '1px solid var(--color-hairline)', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--space-6)' }}>
            <div>
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-ink)' }}>{t.term}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', fontWeight: 600, marginTop: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.category}</div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink)', lineHeight: 'var(--leading-normal)' }}>{t.definition}</div>
              {t.example && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-2)', fontStyle: 'italic' }}>Example: {t.example}</div>}
            </div>
          </div>
        ))}
        {data?.length === 0 && <p style={{ color: 'var(--color-muted)', padding: 'var(--space-8)', textAlign: 'center' }}>No terms match your search.</p>}
      </div>
    </div>
  );
}
