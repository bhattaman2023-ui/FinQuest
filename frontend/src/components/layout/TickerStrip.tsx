import { useEffect, useState } from 'react';
import { formatDateIST } from '@/lib/formatters';
import styles from './TickerStrip.module.css';

interface TickerItem {
  symbol: string;
  value: number;
  change: number;
  type: 'SIMULATED' | 'HISTORICAL' | 'LIVE';
}

// Seed data — served by backend /api/market/ticker
// Until connected, we display clearly labelled HISTORICAL data.
const SEED_TICKERS: TickerItem[] = [
  { symbol: 'NIFTY 50',   value: 24180.80, change: 0.62,  type: 'HISTORICAL' },
  { symbol: 'SENSEX',     value: 79748.63, change: 0.58,  type: 'HISTORICAL' },
  { symbol: 'NIFTY BANK', value: 51842.30, change: -0.21, type: 'HISTORICAL' },
  { symbol: 'NIFTY IT',   value: 44212.15, change: 1.14,  type: 'HISTORICAL' },
  { symbol: 'RELIANCE',   value: 1284.55,  change: -0.44, type: 'SIMULATED' },
  { symbol: 'TCS',        value: 4192.00,  change: 0.87,  type: 'SIMULATED' },
  { symbol: 'INFY',       value: 1876.30,  change: 1.22,  type: 'SIMULATED' },
  { symbol: 'HDFCBANK',   value: 1724.80,  change: -0.31, type: 'SIMULATED' },
];

export default function TickerStrip() {
  const [tickers, setTickers] = useState<TickerItem[]>(SEED_TICKERS);
  const [now, setNow] = useState(new Date());
  const [paused, setPaused] = useState(false);

  // Update clock every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Keep seed data available if the backend ticker request fails.
  useEffect(() => {
    fetch('/api/market/ticker')
      .then((response) => {
        if (!response.ok) throw new Error(`Ticker request failed: ${response.status}`);
        return response.json();
      })
      .then((data: { tickers?: TickerItem[] }) => {
        if (data.tickers) setTickers(data.tickers);
      })
      .catch((error: unknown) => {
        console.error('Failed to load market ticker; continuing with seed data.', error);
      });
  }, []);

  return (
    <div
      className={styles.strip}
      role="marquee"
      aria-label="Market data ticker"
      aria-live="off"
    >
      <div className={styles.left}>
        <time className={styles.date} dateTime={now.toISOString()}>
          {formatDateIST(now, 'short')}
        </time>
        <span className={styles.disclaimer} role="note">
          Simulated prices — educational only
        </span>
      </div>

      <div
        className={styles.trackOuter}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div
          className={styles.track}
          style={{ animationPlayState: paused ? 'paused' : 'running' }}
        >
          {/* Duplicate for seamless loop */}
          {[...tickers, ...tickers].map((item, i) => (
            <TickerCell key={`${item.symbol}-${i}`} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TickerCell({ item }: { item: TickerItem }) {
  const isGain = item.change >= 0;

  return (
    <span className={styles.cell}>
      <span className={styles.symbol}>{item.symbol}</span>
      <span className={`${styles.value} tabular`}>
        {item.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </span>
      <span
        className={`${styles.change} tabular ${isGain ? styles.gain : styles.loss}`}
        aria-label={`${isGain ? 'up' : 'down'} ${Math.abs(item.change)}%`}
      >
        {isGain ? '▲' : '▼'} {Math.abs(item.change).toFixed(2)}%
      </span>
      <span
        className={styles.dataType}
        title={
          item.type === 'SIMULATED' ? 'Price generated for educational simulation' :
          item.type === 'HISTORICAL' ? 'Last available historical price from NSE data' :
          'Live market price'
        }
      >
        {item.type}
      </span>
      <span className={styles.sep} aria-hidden="true">•</span>
    </span>
  );
}
