import { Link } from 'react-router-dom';
import styles from './Footer.module.css';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer} role="contentinfo">
      {/* SEBI Investor Awareness Strip */}
      <div className={styles.sebiStrip}>
        <div className="container">
          <span className={styles.sebiIcon} aria-hidden="true">ⓘ</span>
          <p>
            <strong>Investor Awareness:</strong>{' '}
            FINQUEST is a financial literacy and simulation platform. All trading on this
            platform uses <strong>virtual money only</strong>. This is not a SEBI-registered
            investment adviser or stock broker. No real money is involved. Investments in
            securities markets are subject to market risk — read all related documents before
            investing real money.
          </p>
        </div>
      </div>

      <div className={styles.main}>
        <div className="container">
          <div className={styles.grid}>
            {/* Brand col */}
            <div className={styles.brandCol}>
              <div className={styles.brand}>
                <span className={styles.brandMark} aria-hidden="true">FQ</span>
                <span className={styles.brandWord}>FINQUEST</span>
              </div>
              <p className={styles.tagline}>
                Learn Finance. Experience Markets.<br />
                Practise Investing.
              </p>
              <p className={styles.note}>
                Educational platform. Simulated prices only.<br />
                Not financial advice. Not a real trading platform.
              </p>
            </div>

            {/* Learn */}
            <div className={styles.linkCol}>
              <h3 className={styles.colHead}>Learn</h3>
              <ul>
                <li><Link to="/learn">All Courses</Link></li>
                <li><Link to="/learn/glossary">Glossary</Link></li>
                <li><Link to="/learn?cat=equity">Equity & Markets</Link></li>
                <li><Link to="/learn?cat=fixed-income">Fixed Income</Link></li>
                <li><Link to="/learn?cat=taxes">Taxes & Planning</Link></li>
              </ul>
            </div>

            {/* Platform */}
            <div className={styles.linkCol}>
              <h3 className={styles.colHead}>Platform</h3>
              <ul>
                <li><Link to="/simulator">Market Simulator</Link></li>
                <li><Link to="/portfolio">Portfolio</Link></li>
                <li><Link to="/insights">Insights</Link></li>
                <li><Link to="/gamification">Challenges</Link></li>
                <li><Link to="/mentor">AI Mentor</Link></li>
              </ul>
            </div>

            {/* Useful links */}
            <div className={styles.linkCol}>
              <h3 className={styles.colHead}>Resources</h3>
              <ul>
                <li>
                  <a href="https://www.nseindia.com" target="_blank" rel="noopener noreferrer">
                    NSE India ↗
                  </a>
                </li>
                <li>
                  <a href="https://www.bseindia.com" target="_blank" rel="noopener noreferrer">
                    BSE India ↗
                  </a>
                </li>
                <li>
                  <a href="https://www.sebi.gov.in" target="_blank" rel="noopener noreferrer">
                    SEBI ↗
                  </a>
                </li>
                <li>
                  <a href="https://www.amfiindia.com" target="_blank" rel="noopener noreferrer">
                    AMFI India ↗
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className={styles.bottom}>
            <span className={styles.copyright}>
              © {year} FINQUEST. Educational use only.
            </span>
            <div className={styles.legal}>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Use</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
