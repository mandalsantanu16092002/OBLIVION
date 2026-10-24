import { useState } from 'react';
import { FiDownload } from 'react-icons/fi';
import { Empty, ErrorState, Spinner, useAsync, useToast } from '../components/ui';
import { api, downloadFile } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Link, useRouter } from '../lib/router';

const EVENTS = ['', 'STATUS_CHANGED', 'DOCUMENT_VIEWED', 'FIELD_CORRECTED', 'RULES_EVALUATED', 'WATCHLIST_HIT', 'RECOMMENDATION_RECORDED', 'CHECKER_DECISION',
  'MAKER_CHECKER_VIOLATION', 'ACCOUNT_OPENED', 'EXTRACTION_COMPLETED', 'EXTRACTION_FAILED', 'DOCUMENT_UPLOADED', 'APPLICATION_VIEWED', 'CONFIG_UPDATED', 'WATCHLIST_UPDATED', 'LOGIN', 'LOGIN_FAILED'];

function summarise(e: any): string {
  const d = e.details ?? {};
  switch (e.event_type) {
    case 'STATUS_CHANGED': return `${d.from ?? 'new'} to ${d.to}`;
    case 'FIELD_CORRECTED': return `${d.field}: ${d.before?.value ?? 'missing'} (${d.before?.confidence ?? '—'}) to ${d.after?.value} (1.00). Reason: ${d.reason}`;
    case 'RULES_EVALUATED': return `${d.trigger}: ${d.decision} ${(d.reason_codes ?? []).join('|')}`;
    case 'WATCHLIST_HIT': return `${d.list} ${d.result}: ${d.entry_id} ${d.entry_name}, similarity ${d.similarity}, dob ${String(d.dob_comparison).toLowerCase()}`;
    case 'RECOMMENDATION_RECORDED': return `${d.recommendation}: ${d.comment}`;
    case 'CHECKER_DECISION': return `${d.decision}: ${d.comment}`;
    case 'MAKER_CHECKER_VIOLATION': return `Attempted ${d.attempted} on own recommendation (blocked)`;
    case 'ACCOUNT_OPENED': return `Customer ${d.customer_id}, account ${d.account_number}`;
    case 'EXTRACTION_COMPLETED':
    case 'EXTRACTION_FAILED': return `${d.provider}: ${d.doc_type} (${d.doc_type_confidence})${d.error ? ' ' + d.error : ''}${d.prompt_injection ? ' prompt injection detected' : ''}`;
    case 'DOCUMENT_UPLOADED': return `${d.file_name} as ${d.declared_doc_type}, sha256 ${String(d.sha256).slice(0, 12)}…`;
    case 'CONFIG_UPDATED': return Object.entries(d.changed ?? {}).map(([k, v]: any) => `${k}: ${JSON.stringify(v.before)} to ${JSON.stringify(v.after)}`).join('; ');
    default: return Object.keys(d).length ? JSON.stringify(d).slice(0, 160) : '';
  }
}

export function AuditTable({ items, showApp = true }: { items: any[]; showApp?: boolean }) {
  if (!items.length) return <Empty title="No audit events" />;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>#</th><th>When</th><th>Event</th>{showApp && <th>Application</th>}<th>Document</th><th>Who</th><th>Details</th></tr></thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td className="num small muted">{e.id}</td>
              <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</td>
              <td><span className="code-chip">{e.event_type}</span></td>
              {showApp && <td>{e.application_id ? <Link to={`/audit/${e.application_id}`}>{e.application_id}</Link> : '—'}</td>}
              <td className="small">{e.doc_id ?? '—'}</td>
              <td className="small">{e.actor_email ?? 'system'}<div className="muted">{e.actor_role}</div></td>
              <td className="small" style={{ maxWidth: 420, wordBreak: 'break-word' }}>{summarise(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditPage() {
  const { navigate } = useRouter();
  const [event, setEvent] = useState('');
  const [appId, setAppId] = useState('');
  const { data, error, loading } = useAsync(() => api<any>(`/audit?limit=300${event ? `&event_type=${event}` : ''}`), [event]);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Audit trail</h1>
          <p>Append-only: status changes, decisions, corrections, watchlist hits and every document view.</p>
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (appId) navigate(`/audit/${appId.trim().toUpperCase()}`); }}>
          <input className="input" placeholder="Application ID" value={appId} onChange={(e) => setAppId(e.target.value)} style={{ width: 180 }} aria-label="Application ID" />
          <button className="btn secondary">Open history</button>
          <select className="select" style={{ width: 'auto' }} value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Event type">
            {EVENTS.map((x) => <option key={x} value={x}>{x || 'All events'}</option>)}
          </select>
        </form>
      </div>
      {loading ? <Spinner /> : error ? <ErrorState error={error} /> : <AuditTable items={data.items} />}
    </div>
  );
}

export function ApplicationAuditPage({ id }: { id: string }) {
  const toast = useToast();
  const { data, error, loading } = useAsync(() => api<any>(`/applications/${id}/audit`), [id]);
  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/audit" className="small">Audit trail</Link>
          <h1 style={{ marginTop: 6 }}>History of {id}</h1>
          <p>Full history in order. <Link to={`/cases/${id}`}>Open the case</Link></p>
        </div>
        <button className="btn secondary" onClick={() => downloadFile(`/applications/${id}/audit.csv`, `audit_${id}.csv`).then(() => toast('Audit CSV downloaded (PAN masked)', 'success')).catch((e) => toast(e.message, 'error'))}>
          <FiDownload /> Export CSV
        </button>
      </div>
      {loading ? <Spinner /> : error ? <ErrorState error={error} /> : <AuditTable items={data.items} showApp={false} />}
    </div>
  );
}
