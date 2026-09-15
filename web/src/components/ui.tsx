import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import type { OrderStatus } from '../lib/types';

/* ===========================================================================
   Shared primitives. Everything visual in this app is built from these, so a
   change to the button treatment or the field treatment lands everywhere at
   once instead of in fourteen slightly-different places.
   ========================================================================= */

type ButtonTone = 'primary' | 'ink' | 'quiet' | 'danger';

const TONES: Record<ButtonTone, string> = {
  primary: 'bg-rust text-paper hover:bg-rust-deep border border-rust hover:border-rust-deep',
  ink: 'bg-ink text-paper hover:bg-ink-soft border border-ink hover:border-ink-soft',
  quiet: 'bg-transparent text-ink border border-paper-edge hover:border-ink hover:bg-paper-deep',
  danger: 'bg-transparent text-rust border border-rust/40 hover:bg-rust-wash hover:border-rust',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
}

export function Button({
  tone = 'primary',
  size = 'md',
  block = false,
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const sizes = {
    sm: 'text-xs px-3 py-1.5 tracking-[0.08em]',
    md: 'text-[0.8125rem] px-5 py-2.5 tracking-[0.1em]',
    lg: 'text-sm px-7 py-3.5 tracking-[0.12em]',
  }[size];

  return (
    <button
      // `disabled` covers loading too. A button that is mid-request but still
      // clickable is how you get two orders from one impatient double-click.
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-semibold uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${TONES[tone]} ${sizes} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string;
}

export function Field({ label, error, hint, className = '', id, ...rest }: FieldProps) {
  const fieldId = id ?? `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className={className}>
      {/* A real <label htmlFor>, not a floating div. Screen readers and
          click-to-focus both depend on it. */}
      <label htmlFor={fieldId} className="label-xs mb-1.5 block">
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined}
        className={`w-full border bg-paper px-3 py-2.5 text-sm text-ink transition-colors placeholder:text-ink-faint/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-rust ${
          error ? 'border-rust' : 'border-paper-edge focus:border-ink'
        }`}
        {...rest}
      />
      {error ? (
        <p id={`${fieldId}-err`} className="mt-1.5 text-xs text-rust">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  children: ReactNode;
}

export function Select({ label, className = '', id, children, ...rest }: SelectProps) {
  const fieldId = id ?? `s-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="label-xs mb-1.5 block">
        {label}
      </label>
      <select
        id={fieldId}
        className="w-full appearance-none border border-paper-edge bg-paper px-3 py-2.5 text-sm text-ink focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-rust"
        {...rest}
      >
        {children}
      </select>
    </div>
  );
}

/** Non-blocking inline error. Used wherever a mutation can fail in place. */
export function Notice({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'info' | 'success';
  children: ReactNode;
}) {
  const tones = {
    error: 'border-rust/40 bg-rust-wash text-rust-deep',
    info: 'border-paper-edge bg-paper-deep text-ink-soft',
    success: 'border-moss/30 bg-moss-wash text-moss',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`border px-4 py-3 text-sm ${tones}`}
    >
      {children}
    </div>
  );
}

const STATUS_STYLES: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'border-rust/40 bg-rust-wash text-rust-deep',
  PAYMENT_RECEIVED: 'border-moss/30 bg-moss-wash text-moss',
  PROCESSING: 'border-moss/30 bg-moss-wash text-moss',
  SHIPPED: 'border-ink/20 bg-paper-deep text-ink',
  COMPLETED: 'border-ink/20 bg-ink text-paper',
  CANCELLED: 'border-ink-faint/30 bg-paper-deep text-ink-faint',
  REFUNDED: 'border-ink-faint/30 bg-paper-deep text-ink-faint',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-block border px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.12em] ${STATUS_STYLES[status]}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="label-xs flex items-center gap-2.5">
      <span className="inline-block h-px w-6 bg-rust" aria-hidden="true" />
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { to: string; label: string };
}) {
  return (
    <div className="border border-dashed border-paper-edge px-6 py-16 text-center">
      <h3 className="font-display text-2xl text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">{body}</p>
      {action && (
        <Link
          to={action.to}
          className="mt-6 inline-block border border-ink px-5 py-2.5 text-[0.8125rem] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:bg-ink hover:text-paper"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Skeleton block. Sized by the caller so it occupies the real layout box and
 *  the page does not jump when content arrives. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-paper-deep ${className}`} aria-hidden="true" />;
}

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  // A window around the current page, so 40 pages does not render 40 buttons.
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <nav className="flex items-center justify-center gap-1.5" aria-label="Pagination">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="nums border border-paper-edge px-3 py-2 text-xs uppercase tracking-[0.08em] text-ink transition-colors hover:border-ink disabled:opacity-35 disabled:hover:border-paper-edge"
      >
        Prev
      </button>
      {start > 1 && <span className="px-1 text-xs text-ink-faint">…</span>}
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPage(p)}
          aria-current={p === page ? 'page' : undefined}
          className={`nums min-w-9 border px-3 py-2 text-xs transition-colors ${
            p === page
              ? 'border-ink bg-ink text-paper'
              : 'border-paper-edge text-ink hover:border-ink'
          }`}
        >
          {p}
        </button>
      ))}
      {end < totalPages && <span className="px-1 text-xs text-ink-faint">…</span>}
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="nums border border-paper-edge px-3 py-2 text-xs uppercase tracking-[0.08em] text-ink transition-colors hover:border-ink disabled:opacity-35 disabled:hover:border-paper-edge"
      >
        Next
      </button>
    </nav>
  );
}
