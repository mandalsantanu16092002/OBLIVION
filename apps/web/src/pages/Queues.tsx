import { useState } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import { STATUSES } from '@onboardiq/shared';
import { Badge, Empty, ErrorState, RiskBadge, Spinner, StatusBadge, useAsync } from '../components/ui';
import { api } from '../lib/api';
import { fmtDateTime, officerStatusLabel, sinceHours } from '../lib/format';
import { useRouter } from '../lib/router';

export function CaseTable({ items, mode }: { items: any[]; mode: 'review' | 'checker' | 'all' }) {
  const { navigate } = useRouter();
  if (items.length === 0) return <Empty title={mode === 'all' ? 'No applications match' : 'Queue is empty'}>{mode !== 'all' && <p>New cases appear here automatically.</p>}</Empty>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Application</th>
            <th>Applicant</th>
            <th>PAN</th>
            <th>Risk</th>
            <th>Reasons</th>
            <th>Name score</th>
            {mode === 'checker' && <th>Maker recommends</th>}
            {mode === 'all' && <th>Status</th>}
            <th>{mode === 'checker' ? 'Waiting since' : 'Submitted'}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => {
            const waited = sinceHours(mode === 'checker' ? a.pending_checker_since : a.submitted_at);
            return (
              <tr key={a.application_id} className="clickable" onClick={() => navigate(`/cases/${a.application_id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/cases/${a.application_id}`)}>
                <td><strong className="num">{a.application_id}</strong><div className="small muted">{a.application_date}</div></td>
                <td>{a.full_name}</td>
                <td className="mono">{a.pan_masked}</td>
                <td><RiskBadge risk={a.risk_category} /></td>
                <td style={{ maxWidth: 300 }}>
                  <div className="row" style={{ gap: 4 }}>
                    {(a.reason_codes ?? []).length === 0 ? <span className="muted small">None</span> : a.reason_codes.map((c: string) => <span key={c} className="code-chip">{c}</span>)}
                  </div>
                </td>
                <td className="num">{a.name_match_score ?? '—'}</td>
                {mode === 'checker' && (
                  <td>
                    {a.maker_recommendation ? <Badge tone={a.maker_recommendation === 'APPROVE' ? 'green' : 'red'}>{a.maker_recommendation}</Badge> : <Badge tone="violet">High-risk approval</Badge>}
                    {a.you_are_maker && <div className="small" style={{ color: 'var(--brick)', fontWeight: 700 }}>You are the maker</div>}
                  </td>
                )}
                {mode === 'all' && <td><StatusBadge status={a.status} officer /></td>}
                <td className="small">
                  {fmtDateTime(mode === 'checker' ? a.pending_checker_since : a.submitted_at)}
                  {mode === 'checker' && waited !== null && waited > 24 && <div style={{ color: 'var(--brick)', fontWeight: 700 }}>Over 24 h SLA</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ReviewQueuePage() {
  const { data, error, loading, reload } = useAsync(() => api<{ items: any[] }>('/review/queue'));
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Review queue</h1>
          <p>Cases the rules sent to review. High risk first, then oldest submission.</p>
        </div>
        <button className="btn secondary" onClick={() => reload()}><FiRefreshCw /> Refresh</button>
      </div>
      {loading ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : <CaseTable items={data!.items} mode="review" />}
    </div>
  );
}

export function CheckerQueuePage() {
  const { data, error, loading, reload } = useAsync(() => api<{ items: any[] }>('/checker/queue'));
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Checker queue</h1>
          <p>Officer recommendations and high-risk approvals waiting for a second person.</p>
        </div>
        <button className="btn secondary" onClick={() => reload()}><FiRefreshCw /> Refresh</button>
      </div>
      {loading ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : <CaseTable items={data!.items} mode="checker" />}
    </div>
  );
}

export function ApplicationsPage() {
  const { query } = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(query.get('status') ?? '');
  const { data, error, loading, reload } = useAsync(
    () => api<{ items: any[] }>(`/applications?q=${encodeURIComponent(q)}&status=${status}`),
    [status],
  );
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>All applications</h1>
          <p>Search by application ID or name. PANs are masked in lists.</p>
        </div>
      </div>
      <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); reload(); }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="A2000004 or Ravi" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select className="select" style={{ maxWidth: 240 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{officerStatusLabel(s)}</option>)}
        </select>
        <button className="btn secondary">Search</button>
      </form>
      {loading ? <Spinner /> : error ? <ErrorState error={error} onRetry={reload} /> : <CaseTable items={data!.items} mode="all" />}
    </div>
  );
}
