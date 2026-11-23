import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '@/api/client';
import useAuthStore from '@/store/authStore';

export default function LoginPage() {
  const navigate  = useNavigate();
  const { setAuth } = useAuthStore();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setAuth(data.user, data.token);
      navigate('/dashboard');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Login failed. Check your email and password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: 'var(--space-6)' }}>
      <div style={{ width: '100%', maxWidth: 420, background: 'var(--color-surface)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-10)' }}>
        {/* Brand */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', textDecoration: 'none', marginBottom: 'var(--space-8)' }}>
          <span style={{ display:'flex', alignItems:'center', justifyContent:'center', width:32, height:32, background:'var(--color-ink)', color:'#fff', fontFamily:'var(--font-serif)', fontSize:'var(--text-sm)', fontWeight:600, borderRadius:'var(--radius-brand)' }}>FQ</span>
          <span style={{ fontWeight:700, fontSize:'var(--text-sm)', letterSpacing:'0.08em', color:'var(--color-ink)' }}>FINQUEST</span>
        </Link>

        <h1 style={{ fontFamily:'var(--font-serif)', fontSize:'var(--text-2xl)', fontWeight:500, color:'var(--color-ink)', marginBottom:'var(--space-2)' }}>Welcome back</h1>
        <p style={{ fontSize:'var(--text-sm)', color:'var(--color-muted)', marginBottom:'var(--space-8)' }}>Sign in to continue learning.</p>

        {error && (
          <div style={{ padding:'var(--space-3)', background:'rgba(180,68,60,0.08)', border:'1px solid rgba(180,68,60,0.2)', borderRadius:'var(--radius-md)', fontSize:'var(--text-sm)', color:'var(--color-loss)', marginBottom:'var(--space-5)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
          <label style={{ display:'flex', flexDirection:'column', gap:'var(--space-1)', fontSize:'var(--text-sm)', fontWeight:500, color:'var(--color-muted)' }}>
            Email address
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              style={{ padding:'var(--space-3)', border:'1px solid var(--color-hairline)', borderRadius:'var(--radius-md)', fontSize:'var(--text-base)', color:'var(--color-ink)', background:'var(--color-bg)' }}
            />
          </label>
          <label style={{ display:'flex', flexDirection:'column', gap:'var(--space-1)', fontSize:'var(--text-sm)', fontWeight:500, color:'var(--color-muted)' }}>
            Password
            <input
              type="password" required value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{ padding:'var(--space-3)', border:'1px solid var(--color-hairline)', borderRadius:'var(--radius-md)', fontSize:'var(--text-base)', color:'var(--color-ink)', background:'var(--color-bg)' }}
            />
          </label>
          <button
            type="submit" disabled={loading}
            style={{ padding:'var(--space-3)', background:'var(--color-ink)', color:'#fff', borderRadius:'var(--radius-md)', fontSize:'var(--text-sm)', fontWeight:600, cursor:loading?'not-allowed':'pointer', opacity:loading?0.7:1, border:'none' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ marginTop:'var(--space-6)', fontSize:'var(--text-sm)', color:'var(--color-muted)', textAlign:'center' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color:'var(--color-accent)', fontWeight:600 }}>Create one free</Link>
        </p>
      </div>
    </div>
  );
}
