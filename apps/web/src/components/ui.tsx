import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiInfo, FiX, FiXCircle } from 'react-icons/fi';
import { ApiError } from '../lib/api';
import { officerStatusLabel, riskTone, statusLabel, statusTone } from '../lib/format';

export function Badge({ tone = '', children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, officer }: { status: string; officer?: boolean }) {
  return (
    <Badge tone={statusTone(status)}>
      <span className="dot" aria-hidden /> {officer ? officerStatusLabel(status) : statusLabel(status)}
    </Badge>
  );
}

export function RiskBadge({ risk }: { risk?: string | null }) {
  if (!risk) return <span className="muted small">—</span>;
  return <Badge tone={riskTone(risk)}>{risk.charAt(0) + risk.slice(1).toLowerCase()} risk</Badge>;
}

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label>{label}</label>
      {children}
      {error ? <span className="error" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const Icon = tone === 'error' ? FiXCircle : tone === 'warn' ? FiAlertTriangle : tone === 'success' ? FiCheckCircle : FiInfo;
  return (
    <div className={`alert ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={17} />
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden /> {label && <span className="muted small">{label}</span>}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Confidence bar with the configured threshold marker; below-threshold values are coloured saffron. */
export function ConfidenceBar({ value, threshold = 0.8 }: { value: number | null | undefined; threshold?: number }) {
  const v = value ?? 0;
  const color = value === null || value === undefined ? 'var(--line-strong)' : v >= threshold ? 'var(--teal)' : 'var(--saffron)';
  return (
    <div className="conf" title={`confidence ${v.toFixed(2)} (threshold ${threshold})`}>
      <div className="track">
        <div className="fill" style={{ width: `${Math.round(v * 100)}%`, background: color }} />
        <div className="threshold" style={{ left: `${threshold * 100}%` }} />
      </div>
      <span className="v" style={{ color: v < threshold ? '#8a540a' : undefined }}>{value === null || value === undefined ? '—' : v.toFixed(2)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- toasts
type Toast = { id: number; text: string; tone: 'info' | 'error' | 'success' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- data hook
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <Alert tone="error">
      <strong>{error.status === 404 ? 'Not found.' : error.status === 403 ? 'Not allowed.' : 'Could not load this page.'}</strong> {error.message}
      {onRetry && (
        <div style={{ marginTop: 8 }}>
          <button className="btn secondary small" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </Alert>
  );
}
