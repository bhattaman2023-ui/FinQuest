import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Sun, Moon, Bell, ChevronDown, Menu, X,
  Calculator, FileText, Globe, User, LogOut
} from 'lucide-react';
import clsx from 'clsx';
import useThemeStore from '@/store/themeStore';
import styles from './Header.module.css';

const NAV_ITEMS = [
  { key: 'home',      path: '/dashboard' },
  { key: 'learn',     path: '/learn' },
  { key: 'simulator', path: '/simulator' },
  { key: 'portfolio', path: '/portfolio' },
  { key: 'insights',  path: '/insights' },
  { key: 'games',     path: '/gamification' },
  { key: 'mentor',    path: '/mentor' },
];

export default function Header() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useThemeStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const navigate = useNavigate();

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === 'en' ? 'hi' : 'en');
  };

  return (
    <header className={styles.header} role="banner">
      <div className={styles.inner}>
        {/* Brand */}
        <Link to="/" className={styles.brand} aria-label="FINQUEST home">
          <span className={styles.brandMark} aria-hidden="true">FQ</span>
          <span className={styles.brandWord}>FINQUEST</span>
        </Link>

        {/* Desktop nav */}
        <nav className={styles.nav} aria-label="Main navigation">
          {NAV_ITEMS.map(({ key, path }) => (
            <NavLink
              key={key}
              to={path}
              className={({ isActive }) =>
                clsx(styles.navLink, isActive && styles.navLinkActive)
              }
            >
              {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>

        {/* Utilities */}
        <div className={styles.utils}>
          {/* Quick tools */}
          <div className={styles.toolsWrapper}>
            <button
              className={styles.iconBtn}
              onClick={() => setToolsOpen(!toolsOpen)}
              aria-label="Quick tools"
              aria-expanded={toolsOpen}
            >
              <Calculator size={16} />
            </button>
            {toolsOpen && (
              <div className={styles.toolsDropdown} role="dialog" aria-label="Quick tools">
                <QuickTools onClose={() => setToolsOpen(false)} />
              </div>
            )}
          </div>

          {/* Language toggle */}
          <button
            className={styles.iconBtn}
            onClick={toggleLanguage}
            aria-label={`Switch to ${i18n.language === 'en' ? 'Hindi' : 'English'}`}
            title={i18n.language === 'en' ? 'हिंदी में देखें' : 'View in English'}
          >
            <Globe size={16} />
            <span className={styles.langLabel}>
              {i18n.language === 'en' ? 'EN' : 'HI'}
            </span>
          </button>

          {/* Theme toggle */}
          <button
            className={styles.iconBtn}
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          {/* Notifications */}
          <button className={styles.iconBtn} aria-label="Notifications">
            <Bell size={16} />
          </button>

          {/* User menu */}
          <div className={styles.userMenu}>
            <button className={styles.userBadge} aria-label="User menu">
              <span>AB</span>
            </button>
          </div>
        </div>

        {/* Mobile hamburger */}
        <button
          className={clsx(styles.iconBtn, styles.mobileToggle)}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className={styles.mobileNav} role="dialog" aria-label="Mobile navigation">
          <nav>
            {NAV_ITEMS.map(({ key, path }) => (
              <NavLink
                key={key}
                to={path}
                className={({ isActive }) =>
                  clsx(styles.mobileNavLink, isActive && styles.mobileNavLinkActive)
                }
                onClick={() => setMobileOpen(false)}
              >
                {t(`nav.${key}`)}
              </NavLink>
            ))}
          </nav>
          <div className={styles.mobileUtils}>
            <button onClick={toggleLanguage} className={styles.mobileUtilBtn}>
              <Globe size={16} />
              {i18n.language === 'en' ? 'हिंदी' : 'English'}
            </button>
            <button onClick={toggleTheme} className={styles.mobileUtilBtn}>
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              {theme === 'light' ? 'Dark mode' : 'Light mode'}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

// ── Quick Tools panel ─────────────────────────────────────────
function QuickTools({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'sip' | 'compound'>('sip');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate]           = useState('');
  const [years, setYears]         = useState('');
  const [monthly, setMonthly]     = useState('');
  const [result, setResult]       = useState<string | null>(null);

  function calculate() {
    const P = parseFloat(principal);
    const r = parseFloat(rate) / 100;
    const n = parseFloat(years);

    if (!isFinite(P) || !isFinite(r) || !isFinite(n)) {
      setResult('Enter valid numbers.');
      return;
    }

    if (mode === 'compound') {
      const A = P * Math.pow(1 + r, n);
      setResult(`₹${A.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
    } else {
      // SIP future value
      const M  = parseFloat(monthly);
      if (!isFinite(M)) { setResult('Enter monthly SIP amount.'); return; }
      const rm = r / 12;
      const mn = n * 12;
      const fv = M * (Math.pow(1 + rm, mn) - 1) / rm * (1 + rm);
      setResult(`₹${fv.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
    }
  }

  return (
    <div className={styles.quickTools}>
      <div className={styles.qtHeader}>
        <span>Quick Calculator</span>
        <button onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>
      <div className={styles.qtTabs}>
        <button
          className={clsx(styles.qtTab, mode === 'sip' && styles.qtTabActive)}
          onClick={() => setMode('sip')}
        >SIP</button>
        <button
          className={clsx(styles.qtTab, mode === 'compound' && styles.qtTabActive)}
          onClick={() => setMode('compound')}
        >Compound</button>
      </div>
      <div className={styles.qtBody}>
        <label className={styles.qtLabel}>
          {mode === 'sip' ? 'Lump-sum (₹)' : 'Principal (₹)'}
          <input
            type="number"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            className={styles.qtInput}
            placeholder="e.g. 10000"
          />
        </label>
        {mode === 'sip' && (
          <label className={styles.qtLabel}>
            Monthly SIP (₹)
            <input
              type="number"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              className={styles.qtInput}
              placeholder="e.g. 5000"
            />
          </label>
        )}
        <label className={styles.qtLabel}>
          Annual rate (%)
          <input
            type="number"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={styles.qtInput}
            placeholder="e.g. 12"
          />
        </label>
        <label className={styles.qtLabel}>
          Years
          <input
            type="number"
            value={years}
            onChange={(e) => setYears(e.target.value)}
            className={styles.qtInput}
            placeholder="e.g. 10"
          />
        </label>
        <button onClick={calculate} className={styles.qtCalcBtn}>Calculate</button>
        {result && (
          <div className={styles.qtResult}>
            <span>Future value</span>
            <strong>{result}</strong>
          </div>
        )}
        <p className={styles.qtDisclaimer}>
          Illustrative only. Actual returns vary.
        </p>
      </div>
    </div>
  );
}
