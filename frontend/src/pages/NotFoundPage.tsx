import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--color-bg)', flexDirection:'column', gap:'var(--space-6)', padding:'var(--space-8)' }}>
      <span style={{ fontFamily:'var(--font-serif)', fontSize:'var(--text-5xl)', fontWeight:500, color:'var(--color-hairline)' }}>404</span>
      <h1 style={{ fontFamily:'var(--font-serif)', fontSize:'var(--text-2xl)', fontWeight:500, color:'var(--color-ink)' }}>Page not found</h1>
      <p style={{ color:'var(--color-muted)', fontSize:'var(--text-md)', textAlign:'center', maxWidth:'40ch' }}>The page you're looking for doesn't exist or has moved.</p>
      <Link to="/" style={{ padding:'var(--space-3) var(--space-6)', background:'var(--color-ink)', color:'#fff', borderRadius:'var(--radius-md)', fontSize:'var(--text-sm)', fontWeight:600, textDecoration:'none' }}>
        Back to Home
      </Link>
    </div>
  );
}
