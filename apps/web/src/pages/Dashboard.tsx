import { useState } from 'react';
import { REASON_CODE_MAP, STATUSES } from '@onboardiq/shared';
import { ErrorState, Spinner, useAsync } from '../components/ui';
import { api } from '../lib/api';
import { fmtDateTime, officerStatusLabel, pct } from '../lib/format';
import { useRouter } from '../lib/router';

const STATUS_COLOR: Record<string, string> = {
  SUBMITTED: '#8d95b8', EXTRACTING: '#0e6b70', AUTO_APPROVED: '#2f7d4f', APPROVED: '#4f9d6e', IN_REVIEW: '#d98a1c',
  RESUBMISSION_REQUESTED: '#e6b25c', PENDING_CHECKER: '#5b4bb7', REJECTED: '#c25a4f', AUTO_REJECTED: '#ae3a2e', CLOSED_EXPIRED: '#7a4a44',
};

export function DashboardPage() {
  const { navigate } = useRouter();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const d = useAsync(() => api<any>(`/dashboard?from=${from}&to=${to}`), [from, to]);
  const fb = useAsync(() => api<any>('/dashboard/ai-feedback'), []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Compliance dashboard</h1>
          <p>Every figure is computed from the application records and reconciles with the lists.</p>
        </div>
        <div className="row">
          <label className="row small">From <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
          <label className="row small">To <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
          {(from || to) && <button className="btn ghost small" onClick={() => { setFrom(''); setTo(''); }}>Clear dates</button>}
        </div>
      </div>
      {d.loading ? <Spinner /> : d.error ? <ErrorState error={d.error} onRetry={d.reload} /> : (
        <div className="stack">
          <div className="grid4">
            <Kpi label="Straight-through rate" value={pct(d.data.straight_through.rate)} sub={`${d.data.straight_through.auto_approved} auto-approved of ${d.data.decided} decided`} />
            <Kpi label="Review rate" value={pct(d.data.rules_outcome.review_rate)} sub={`${d.data.rules_outcome.review} of ${d.data.rules_outcome.evaluated} at first evaluation`} />
            <Kpi label="Reject rate" value={pct(d.data.rules_outcome.reject_rate)} sub={`${d.data.rules_outcome.reject} of ${d.data.rules_outcome.evaluated}`} />
            <Kpi
              label="Waiting for checker"
              value={String(d.data.pending_checker.count)}
              sub={d.data.pending_checker.overdue ? `${d.data.pending_checker.overdue} over the ${d.data.pending_checker.sla_hours} h SLA` : `Oldest ${fmtDateTime(d.data.pending_checker.oldest)}`}
              alert={d.data.pending_checker.overdue > 0}
            />
          </div>
          <div className="grid2">
            <section className="panel">
              <div className="panel-head"><h2>Applications by status</h2><span className="small muted">{d.data.total_applications} total</span></div>
              <div className="bars">
                {STATUSES.map((s) => {
                  const n = d.data.by_status[s] ?? 0;
                  const max = Math.max(1, ...Object.values<number>(d.data.by_status));
                  return (
                    <button key={s} className="bar-row" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => navigate(`/applications?status=${s}`)} title="Open the list">
                      <span>{officerStatusLabel(s)}</span>
                      <span className="track"><span className="fill" style={{ display: 'block', width: `${(n / max) * 100}%`, background: STATUS_COLOR[s] }} /></span>
                      <span className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{n}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Top reason codes</h2><span className="small muted">At first evaluation</span></div>
              {d.data.top_reason_codes.length === 0 ? <p className="muted">No reason codes in this period.</p> : (
                <div className="bars">
                  {d.data.top_reason_codes.map((r: any) => (
                    <div key={r.code} className="bar-row">
                      <span title={REASON_CODE_MAP[r.code]?.title}><span className="code-chip">{r.code}</span></span>
                      <span className="track"><span className="fill" style={{ display: 'block', width: `${(r.n / d.data.top_reason_codes[0].n) * 100}%`, background: REASON_CODE_MAP[r.code]?.outcome === 'REJECT' ? 'var(--brick)' : 'var(--saffron)' }} /></span>
                      <span className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{r.n}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="divider" />
              <div className="grid2">
                <div>
                  <span className="small muted">Average time in review</span>
                  <div style={{ fontWeight: 800, fontSize: '1.3rem' }} className="num">
                    {d.data.review_time.average_hours === null ? '—' : d.data.review_time.average_hours < 1 ? `${Math.round(d.data.review_time.average_hours * 60)} min` : `${d.data.review_time.average_hours.toFixed(1)} h`}
                  </div>
                  <span className="small muted">{d.data.review_time.completed_reviews} finished, {d.data.review_time.open_reviews} open</span>
                </div>
                <div>
                  <span className="small muted">Risk mix</span>
                  <div className="small" style={{ marginTop: 4 }}>
                    {d.data.risk_mix.map((r: any) => <div key={r.risk}>{r.risk}: <strong className="num">{r.n}</strong></div>)}
                  </div>
                </div>
              </div>
            </section>
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Applications per day</h2><span className="small muted">Stacked by first rules outcome</span></div>
            <Trend rows={d.data.trend} />
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>AI extraction feedback</h2>
              <span className="small muted">Officer corrections are stored as labelled feedback</span>
            </div>
            {fb.loading ? <Spinner /> : fb.error ? <ErrorState error={fb.error} /> : (
              <div className="grid2">
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Provider</th><th>Documents</th><th>Fields</th><th>Corrections</th><th>Correction rate</th></tr></thead>
                    <tbody>
                      {fb.data.by_provider.map((p: any) => (
                        <tr key={p.provider}><td>{p.provider}</td><td className="num">{p.documents}</td><td className="num">{p.extracted_fields}</td><td className="num">{p.corrections}</td><td className="num">{pct(p.correction_rate, 2)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Recent correction</th><th>Extracted</th><th>Corrected</th></tr></thead>
                    <tbody>
                      {fb.data.recent.length === 0 ? <tr><td colSpan={3} className="muted">No corrections yet.</td></tr> : fb.data.recent.slice(0, 6).map((r: any, i: number) => (
                        <tr key={i}><td>{r.doc_id} {r.field_name}</td><td className="mono">{r.extracted_value ?? 'missing'} ({r.extracted_confidence ?? '—'})</td><td className="mono">{r.corrected_value}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div className="kpi" style={alert ? { borderColor: 'var(--brick)' } : undefined}>
      <div className="l">{label}</div>
      <div className="v" style={alert ? { color: 'var(--brick)' } : undefined}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

function Trend({ rows }: { rows: { day: string; submitted: number; auto_approved: number; review: number; reject: number }[] }) {
  if (!rows.length) return <p className="muted">No applications in this period.</p>;
  const max = Math.max(...rows.map((r) => r.submitted), 1);
  const W = 720;
  const H = 180;
  const bw = Math.min(64, (W - 40) / rows.length - 12);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H + 40}`} width="100%" style={{ maxWidth: W, minWidth: 360 }} role="img" aria-label="Applications per day">
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line x1="30" x2={W} y1={10 + H * (1 - g)} y2={10 + H * (1 - g)} stroke="var(--line)" />
            <text x="24" y={14 + H * (1 - g)} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(max * g)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = 44 + i * ((W - 50) / rows.length);
          const other = r.submitted - r.review - r.reject;
          const segs = [
            { v: other, c: 'var(--leaf)', l: 'approve' },
            { v: r.review, c: 'var(--saffron)', l: 'review' },
            { v: r.reject, c: 'var(--brick)', l: 'reject' },
          ];
          let y = 10 + H;
          return (
            <g key={r.day}>
              {segs.map((s) => {
                const h = (s.v / max) * H;
                y -= h;
                return <rect key={s.l} x={x} y={y} width={bw} height={Math.max(0, h - 1)} rx="3" fill={s.c}><title>{`${r.day}: ${s.v} ${s.l}`}</title></rect>;
              })}
              <text x={x + bw / 2} y={H + 28} textAnchor="middle" fontSize="11" fill="var(--muted)">{r.day.slice(5)}</text>
            </g>
          );
        })}
      </svg>
      <div className="row small muted" style={{ gap: 16 }}>
        <span className="row" style={{ gap: 6 }}><span className="dot" style={{ color: 'var(--leaf)' }} /> Approve</span>
        <span className="row" style={{ gap: 6 }}><span className="dot" style={{ color: 'var(--saffron)' }} /> Review</span>
        <span className="row" style={{ gap: 6 }}><span className="dot" style={{ color: 'var(--brick)' }} /> Reject</span>
      </div>
    </div>
  );
}
