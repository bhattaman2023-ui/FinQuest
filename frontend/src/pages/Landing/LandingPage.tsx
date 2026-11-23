import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, BookOpen, BarChart2 } from 'lucide-react';
import Header from '@/components/layout/Header';
import TickerStrip from '@/components/layout/TickerStrip';
import Footer from '@/components/layout/Footer';
import { formatINR } from '@/lib/formatters';
import styles from './LandingPage.module.css';

// ── Seeded simulator preview data ────────────────────────────
const PREVIEW_HOLDINGS = [
  { symbol: 'RELIANCE', qty: 5,  price: 1284.55, change: -0.44 },
  { symbol: 'TCS',      qty: 2,  price: 4192.00, change:  0.87 },
  { symbol: 'INFY',     qty: 8,  price: 1876.30, change:  1.22 },
];

const TOPICS = [
  { no: '01', title: 'Money Basics',       desc: 'Why invest, inflation, compounding, goals, risk and return.', path: '/learn?cat=basics', count: 5 },
  { no: '02', title: 'Equity & Markets',   desc: 'Stock markets, NSE & BSE, mutual funds, SIP, ETFs.', path: '/learn?cat=equity', count: 6 },
  { no: '03', title: 'Fixed Income',       desc: 'Bonds, government securities, fixed deposits.', path: '/learn?cat=fixed-income', count: 3 },
  { no: '04', title: 'Derivatives',        desc: 'Futures, options, and understanding risk.', path: '/learn?cat=derivatives', count: 4 },
  { no: '05', title: 'Government Savings', desc: 'PPF, NSC, Sukanya Samriddhi Yojana.', path: '/learn?cat=govt-savings', count: 3 },
  { no: '06', title: 'Taxes',             desc: 'Capital gains, STCG, LTCG, basic tax concepts.', path: '/learn?cat=taxes', count: 3 },
];

const METHOD_COLS = [
  {
    step: 'Learn',
    icon: BookOpen,
    desc: 'Structured lessons written for Indian beginners. Real examples: NSE stocks, SIP, PPF, LTCG.',
  },
  {
    step: 'Watch',
    icon: BarChart2,
    desc: 'Explore live charts, indicators and market data. Understand what moves prices.',
  },
  {
    step: 'Practise',
    icon: TrendingUp,
    desc: 'Trade with ₹1,00,000 virtual cash on NSE-listed stocks. Zero risk, real knowledge.',
  },
];

const SIMULATOR_FEATURES = [
  'Trade RELIANCE, TCS, INFY, HDFCBANK and more',
  'Prices clearly labelled: Simulated or Historical',
  'Full order history and portfolio analytics',
  'ML-powered educational movement classifier',
  'Portfolio risk analyser and smart trade review',
  'XP, badges, streaks — learn and earn rewards',
];

export default function LandingPage() {
  const totalSimValue = PREVIEW_HOLDINGS.reduce(
    (s, h) => s + h.qty * h.price, 0
  );

  return (
    <div className={styles.page}>
      {/* Landing has its own header (not the app shell) */}
      <LandingHeader />
      <TickerStrip />

      <main>
        {/* ── 00 • HERO ──────────────────────────────────────── */}
        <section className={styles.hero} aria-label="Introduction">
          <div className={`container ${styles.heroInner}`}>
            {/* Left copy */}
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>Educational Platform</span>

              <h1 className={styles.heroH1}>
                Learn Finance.{' '}
                <em className="accent-italic">Experience</em>{' '}
                Markets.{' '}
                <span className={styles.headlineBlock}>Practise Investing.</span>
              </h1>

              <p className={styles.heroDesc}>
                India's financial literacy platform for beginners. Study at your own pace,
                simulate stock trading with{' '}
                <strong>₹1,00,000 virtual cash</strong>, and build real investing knowledge — safely.
              </p>

              <div className={styles.heroCta}>
                <Link to="/register" className={styles.ctaPrimary}>
                  Start Learning Free
                </Link>
                <Link to="/simulator" className={styles.ctaSecondary}>
                  Explore the Simulator <ArrowRight size={14} />
                </Link>
              </div>

              {/* 3-stat bar */}
              <div className={styles.statBar} role="list">
                {[
                  { v: '30+',    l: 'Lessons' },
                  { v: '₹1 L',   l: 'Virtual Cash' },
                  { v: '8+',     l: 'NSE Instruments' },
                ].map((s) => (
                  <div key={s.l} className={styles.stat} role="listitem">
                    <span className={styles.statValue}>{s.v}</span>
                    <span className={styles.statLabel}>{s.l}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right simulator preview */}
            <div className={styles.simPreview} aria-label="Simulator preview card">
              <div className={styles.simHeader}>
                <span className={styles.simLabel}>SIMULATOR PREVIEW</span>
                <span className={styles.simTag}>SIMULATED</span>
              </div>

              <div className={styles.simBalance}>
                <span className={styles.simBalLabel}>Virtual Portfolio</span>
                <span className={styles.simBalValue} data-numeral>
                  {formatINR(totalSimValue + 46782.15)}
                </span>
              </div>

              {/* Sparkline SVG — hand-drawn in design palette */}
              <TrendSparkline />

              <div className={styles.simHoldings}>
                {PREVIEW_HOLDINGS.map((h) => (
                  <div key={h.symbol} className={styles.simRow}>
                    <span className={styles.simSymbol}>{h.symbol}</span>
                    <span className={styles.simQty}>{h.qty} sh</span>
                    <span className={`${styles.simChange} tabular ${h.change >= 0 ? styles.gain : styles.loss}`}>
                      {h.change >= 0 ? '+' : ''}{h.change}%
                    </span>
                    <span className={`${styles.simPrice} tabular`}>
                      {formatINR(h.price, { decimals: 2 })}
                    </span>
                  </div>
                ))}
              </div>

              <p className={styles.simDisclaimer}>
                Simulated prices · For education only · Not real trading
              </p>
            </div>
          </div>
        </section>

        {/* ── 01 • TOPICS ───────────────────────────────────── */}
        <section className={styles.section} aria-label="Topics">
          <div className="container">
            <div className={styles.sectionHead}>
              <span className={styles.sectionNo}>01</span>
              <h2 className={styles.sectionTitle}>Topics</h2>
            </div>
            <div className={styles.topicsList} role="list">
              {TOPICS.map((t) => (
                <Link
                  key={t.no}
                  to={t.path}
                  className={styles.topicRow}
                  role="listitem"
                  aria-label={`${t.title}: ${t.desc}`}
                >
                  <span className={styles.topicNo}>{t.no}</span>
                  <div className={styles.topicBody}>
                    <strong className={styles.topicTitle}>{t.title}</strong>
                    <span className={styles.topicDesc}>{t.desc}</span>
                  </div>
                  <span className={styles.topicCount}>{t.count} lessons</span>
                  <ArrowRight size={16} className={styles.topicArrow} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ── 02 • THE METHOD ───────────────────────────────── */}
        <section className={`${styles.section} ${styles.sageSection}`} aria-label="The method">
          <div className="container">
            <div className={styles.sectionHead}>
              <span className={styles.sectionNo}>02</span>
              <h2 className={styles.sectionTitle}>The Method</h2>
            </div>
            <div className={styles.methodGrid}>
              {METHOD_COLS.map(({ step, icon: Icon, desc }) => (
                <div key={step} className={styles.methodCol}>
                  <div className={styles.methodRule} aria-hidden="true" />
                  <div className={styles.methodIcon}><Icon size={20} /></div>
                  <h3 className={styles.methodStep}>{step}</h3>
                  <p className={styles.methodDesc}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 03 • START HERE ───────────────────────────────── */}
        <section className={styles.section} aria-label="Start here">
          <div className="container">
            <div className={styles.sectionHead}>
              <span className={styles.sectionNo}>03</span>
              <h2 className={styles.sectionTitle}>Start Here</h2>
            </div>
            <div className={styles.starterCards}>
              {[
                { title: 'Why Should You Invest?',        slug: 'why-invest',    time: '8 min', cat: 'Money Basics' },
                { title: 'Understanding Inflation',        slug: 'inflation',     time: '10 min', cat: 'Money Basics' },
                { title: 'The Power of Compounding',       slug: 'compounding',   time: '12 min', cat: 'Money Basics' },
                { title: 'Intro to Stock Markets',         slug: 'intro-stocks',  time: '15 min', cat: 'Equity' },
              ].map((l) => (
                <Link
                  key={l.slug}
                  to={`/learn/money-basics/${l.slug}`}
                  className={styles.starterCard}
                  aria-label={`${l.title} — ${l.time} read`}
                >
                  <span className={styles.starterCat}>{l.cat}</span>
                  <span className={styles.starterTitle}>{l.title}</span>
                  <span className={styles.starterTime}>{l.time} read →</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ── 04 • SIMULATOR ────────────────────────────────── */}
        <section className={`${styles.section} ${styles.sageSection}`} aria-label="Simulator">
          <div className="container">
            <div className={styles.sectionHead}>
              <span className={styles.sectionNo}>04</span>
              <h2 className={styles.sectionTitle}>Simulator</h2>
            </div>
            <div className={styles.simSplit}>
              <div className={styles.simCopy}>
                <h3 className={styles.simBigHead}>
                  Trade with virtual money.{' '}
                  <em className="accent-italic">Learn without risk.</em>
                </h3>
                <p className={styles.simSubhead}>
                  Practice buying and selling NSE-listed stocks using ₹1,00,000 of virtual
                  cash. Every price is clearly labelled — simulated or historical — so you
                  always know exactly what you're working with.
                </p>
                <ul className={styles.checkList} aria-label="Simulator features">
                  {SIMULATOR_FEATURES.map((f) => (
                    <li key={f} className={styles.checkItem}>
                      <span className={styles.checkMark} aria-hidden="true">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/register" className={styles.ctaPrimary} style={{ display: 'inline-flex', marginTop: '1.5rem' }}>
                  Open a Free Account
                </Link>
              </div>

              <div className={styles.simRight}>
                <div className={styles.simCard}>
                  <div className={styles.simCardHead}>
                    <span>Market Simulator</span>
                    <span className={styles.simTag}>SIMULATED</span>
                  </div>
                  <div className={styles.simCardBalance}>
                    <span>Virtual Cash</span>
                    <strong>{formatINR(1_00_000)}</strong>
                  </div>
                  <TrendSparkline height={80} />
                  <p className={styles.simCardNote}>
                    Not real money. Not real trading. For education only.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 05 • ABOUT FINQUEST ───────────────────────────── */}
        <section className={styles.section} aria-label="About FINQUEST">
          <div className="container">
            <div className={styles.sectionHead}>
              <span className={styles.sectionNo}>05</span>
              <h2 className={styles.sectionTitle}>About FINQUEST</h2>
            </div>
            <div className={styles.aboutGrid}>
              <div className={styles.aboutText}>
                <p>
                  FINQUEST is an independent educational platform built to help Indian
                  beginners understand money, markets, and investing — before they put a
                  single rupee at risk.
                </p>
                <p>
                  Too many Indians invest without understanding what they own. FINQUEST
                  fixes that: structured lessons, an honest simulator, and an AI mentor
                  that explains, never advises.
                </p>
                <p className={styles.aboutDisc}>
                  FINQUEST is not a SEBI-registered investment adviser, broker, or financial
                  planner. All market prices on this platform are simulated or historical.
                  This platform does not handle real money.
                </p>
              </div>
              <div className={styles.aboutLinks}>
                <Link to="/register" className={styles.ctaPrimary}>
                  Get Started — It's Free
                </Link>
                <Link to="/learn" className={styles.ctaSecondary}>
                  Browse All Lessons <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

// ── Landing-specific header (no nav, just brand + auth links) ─
function LandingHeader() {
  return (
    <header className={styles.landingHeader}>
      <div className={`container ${styles.landingHeaderInner}`}>
        <Link to="/" className={styles.landingBrand} aria-label="FINQUEST home">
          <span className={styles.brandMark} aria-hidden="true">FQ</span>
          <span className={styles.brandWord}>FINQUEST</span>
        </Link>
        <div className={styles.landingHeaderLinks}>
          <Link to="/login"    className={styles.loginLink}>Sign In</Link>
          <Link to="/register" className={styles.registerBtn}>Create Account</Link>
        </div>
      </div>
    </header>
  );
}

// ── Sparkline SVG (hand-drawn in design palette) ──────────────
function TrendSparkline({ height = 60 }: { height?: number }) {
  // Slight upward trend with realistic variation
  const pts = [0,8,5,12,9,16,13,20,17,22,19,24,21,26,20,28,23,30,25,28,27,32];
  const w = 240, h = height;
  const max = Math.max(...pts), min = Math.min(...pts);
  const scaleY = (v: number) => h - ((v - min) / (max - min)) * (h * 0.8) - h * 0.1;
  const scaleX = (i: number) => (i / (pts.length - 1)) * w;
  const pathD = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${w},${h} L0,${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={height}
      aria-hidden="true"
      className={styles.sparkline}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#2F7D5B" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#2F7D5B" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sparkGrad)" />
      <path d={pathD} fill="none" stroke="#2F7D5B" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
