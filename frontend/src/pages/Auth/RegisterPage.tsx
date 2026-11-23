import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '@/api/client';
import useAuthStore from '@/store/authStore';

export default function RegisterPage() {
  const navigate  = useNavigate();
  const { setAuth } = useAuthStore();
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', form);
      setAuth(data.user, data.token);
      navigate('/dashboard');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--color-bg)', padding:'var(--space-6)' }}>
      <div style={{ width:'100%', maxWidth:420, background:'var(--color-surface)', border:'1px solid var(--color-hairline)', borderRadius:'var(--radius-lg)', padding:'var(--space-10)' }}>
        <Link to="/" style={{ display:'flex', alignItems:'center', gap:'var(--space-2)', textDecoration:'none', marginBottom:'var(--space-8)' }}>
          <span style={{ display:'flex', alignItems:'center', justifyContent:'center', width:32, height:32, background:'var(--color-ink)', color:'#fff', fontFamily:'var(--font-serif)', fontSize:'var(--text-sm)', fontWeight:600, borderRadius:'var(--radius-brand)' }}>FQ</span>
          <span style={{ fontWeight:700, fontSize:'var(--text-sm)', letterSpacing:'0.08em', color:'var(--color-ink)' }}>FINQUEST</span>
        </Link>

        <h1 style={{ fontFamily:'var(--font-serif)', fontSize:'var(--text-2xl)', fontWeight:500, color:'var(--color-ink)', marginBottom:'var(--space-2)' }}>Create your account</h1>
        <p style={{ fontSize:'var(--text-sm)', color:'var(--color-muted)', marginBottom:'var(--space-8)' }}>Free. No real money. Just knowledge.</p>

        {error && (
          <div style={{ padding:'var(--space-3)', background:'rgba(180,68,60,0.08)', border:'1px solid rgba(180,68,60,0.2)', borderRadius:'var(--radius-md)', fontSize:'var(--text-sm)', color:'var(--color-loss)', marginBottom:'var(--space-5)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
          {([
            { label: 'Your name', key: 'displayName', type: 'text', auto: 'name', placeholder: 'e.g. Priya Sharma' },
            { label: 'Email address', key: 'email', type: 'email', auto: 'email', placeholder: '' },
            { label: 'Password (min. 8 chars)', key: 'password', type: 'password', auto: 'new-password', placeholder: '' },
          ] as const).map(f => (
            <label key={f.key} style={{ display:'flex', flexDirection:'column', gap:'var(--space-1)', fontSize:'var(--text-sm)', fontWeight:500, color:'var(--color-muted)' }}>
              {f.label}
              <input
                type={f.type} required value={form[f.key]} onChange={update(f.key)}
                autoComplete={f.auto} placeholder={f.placeholder}
                style={{ padding:'var(--space-3)', border:'1px solid var(--color-hairline)', borderRadius:'var(--radius-md)', fontSize:'var(--text-base)', color:'var(--color-ink)', background:'var(--color-bg)' }}
              />
            </label>
          ))}

          <p style={{ fontSize:'var(--text-xs)', color:'var(--color-muted)', lineHeight:1.5 }}>
            By creating an account you acknowledge this is an <strong>educational simulation platform</strong>. No real money is involved. Not a SEBI-registered adviser.
          </p>

          <button
            type="submit" disabled={loading}
            style={{ padding:'var(--space-3)', background:'var(--color-ink)', color:'#fff', borderRadius:'var(--radius-md)', fontSize:'var(--text-sm)', fontWeight:600, cursor:loading?'not-allowed':'pointer', opacity:loading?0.7:1, border:'none' }}
          >
            {loading ? 'Creating account…' : 'Create Account — Free'}
          </button>
        </form>

        <p style={{ marginTop:'var(--space-6)', fontSize:'var(--text-sm)', color:'var(--color-muted)', textAlign:'center' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color:'var(--color-accent)', fontWeight:600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
