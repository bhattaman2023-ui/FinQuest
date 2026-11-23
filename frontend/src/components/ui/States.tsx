import { ReactNode } from 'react';
import { RefreshCw, AlertCircle, Inbox } from 'lucide-react';
import styles from './States.module.css';

// ── Error state ───────────────────────────────────────────────
export function ErrorState({
  message = 'Something went wrong.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.wrap} role="alert">
      <AlertCircle size={32} className={styles.errorIcon} />
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className={styles.retryBtn}>
          <RefreshCw size={14} /> Try again
        </button>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────
export function EmptyState({
  message = 'Nothing here yet.',
  action,
}: {
  message?: string;
  action?: ReactNode | { label: string; href: string };
}) {
  const actionNode =
    action && typeof action === 'object' && 'href' in (action as object)
      ? (() => {
          const a = action as { label: string; href: string };
          return (
            <a
              href={a.href}
              style={{
                display: 'inline-block',
                padding: 'var(--space-2) var(--space-5)',
                border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--color-ink)',
                textDecoration: 'none',
              }}
            >
              {a.label}
            </a>
          );
        })()
      : (action as ReactNode);

  return (
    <div className={styles.wrap}>
      <Inbox size={32} className={styles.emptyIcon} />
      <p className={styles.message}>{message}</p>
      {actionNode && <div className={styles.action}>{actionNode}</div>}
    </div>
  );
}

// ── Named export alias for PageSpinner (some pages import it as named) ──
export { default as PageSpinner } from './PageSpinner';
