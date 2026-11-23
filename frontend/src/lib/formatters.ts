/**
 * Indian number formatting utilities.
 * Used throughout FINQUEST — import from here, never inline.
 *
 * India uses lakh/crore grouping: 1,00,000 = 1 lakh; 1,00,00,000 = 1 crore.
 * All monetary values are in INR (₹).
 */

/** Format as Indian currency: ₹1,23,456.78 */
export function formatINR(
  value: number,
  options: { decimals?: number; compact?: boolean } = {}
): string {
  const { decimals = 2, compact = false } = options;

  if (!isFinite(value)) return '—';

  if (compact) {
    if (Math.abs(value) >= 1_00_00_000) {
      return `₹${(value / 1_00_00_000).toFixed(2)} Cr`;
    }
    if (Math.abs(value) >= 1_00_000) {
      return `₹${(value / 1_00_000).toFixed(2)} L`;
    }
  }

  // Use Indian grouping via Intl
  return value.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format as plain Indian number: 1,23,456 */
export function formatIndianNumber(value: number, decimals = 0): string {
  if (!isFinite(value)) return '—';
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format percentage: 12.34% or -5.67% */
export function formatPercent(value: number, decimals = 2): string {
  if (!isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/** Format quantity (integer shares): 1,000 */
export function formatQty(value: number): string {
  return formatIndianNumber(value, 0);
}

/**
 * Format a date in IST (Asia/Kolkata).
 * Default: "23 Nov 2026"
 */
export function formatDateIST(
  date: Date | string,
  style: 'short' | 'long' | 'numeric' = 'long'
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';

  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
  };

  if (style === 'short') {
    opts.day = '2-digit'; opts.month = 'short'; opts.year = 'numeric';
  } else if (style === 'long') {
    opts.day = 'numeric'; opts.month = 'long'; opts.year = 'numeric';
  } else {
    opts.day = '2-digit'; opts.month = '2-digit'; opts.year = 'numeric';
  }

  return d.toLocaleDateString('en-IN', opts);
}

/** Format a datetime in IST: "23 Nov 2026, 3:45 PM" */
export function formatDateTimeIST(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Compact crore/lakh label for dashboard KPIs */
export function compactINR(value: number): string {
  return formatINR(value, { compact: true });
}

/** Sign-sensitive color class for a P&L figure */
export function gainLossClass(value: number): string {
  if (value > 0) return 'text-gain';
  if (value < 0) return 'text-loss';
  return 'text-muted';
}
