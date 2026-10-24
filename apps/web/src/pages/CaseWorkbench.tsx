import { Fragment, useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiCpu, FiEdit3, FiFileText, FiRefreshCw, FiShield, FiZap } from 'react-icons/fi';
import { DOC_TYPES, FIELD_NAMES, REQUIRED_FIELDS } from '@onboardiq/shared';
import { Lifecycle } from '../components/Lifecycle';
import { Alert, Badge, ConfidenceBar, ErrorState, Field, Modal, RiskBadge, Spinner, StatusBadge, useAsync, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { decisionTone, docLabel, fieldLabel, fmtDate, fmtDateTime, fmtInr } from '../lib/format';
import { Link } from '../lib/router';

const MIN_CONF = 0.8;

export function CaseWorkbenchPage({ id }: { id: string }) {
  const { role, user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useAsync(() => api<any>(`/applications/${id}`), [id]);
  const [docId, setDocId] = useState<string | null>(null);
  const [tab, setTab] = useState<'fields' | 'rules' | 'screening' | 'history'>('fields');
  const [correcting, setCorrecting] = useState<{ doc_id: string; field: string; value: string } | null>(null);
  const [activeField, setActiveField] = useState<string | null>(null);

  useEffect(() => {
    if (data?.documents?.length && !data.documents.some((d: any) => d.doc_id === docId)) setDocId(data.documents[0].doc_id);
  }, [data, docId]);
  useEffect(() => {
    if (!data || !['SUBMITTED', 'EXTRACTING'].includes(data.application?.status)) return;
    const t = setInterval(() => reload(true), 1500);
    return () => clearInterval(t);
  }, [data, reload]);

  if (loading) return <Spinner label="Loading case" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (data.view !== 'officer') return <ErrorState error={new ApiError(403, 'FORBIDDEN', 'Officer view only')} />;

  const app = data.application;
  const engine = data.engine_result;
  const doc = data.documents.find((d: any) => d.doc_id === docId) ?? data.documents[0];
  const handleErr = (e: unknown) => {
    const ae = e as ApiError;
    if (ae.status === 409) {
      toast('Someone else changed this case. Showing the latest version.', 'error');
      reload(true);
    } else toast(ae.message, 'error');
  };

  return (
    <div className="stack">
      <div>
        <Link to={role === 'COMPLIANCE_OFFICER' ? '/checker' : '/queue'} className="small">Back to queue</Link>
      </div>
      <section className="panel">
        <div className="case-head">
          <div style={{ minWidth: 0 }}>
            <div className="row">
              <h1 className="num">{app.application_id}</h1>
              <StatusBadge status={app.status} officer />
              <RiskBadge risk={app.risk_category} />
            </div>
            <p className="muted" style={{ marginTop: 4 }}>{app.full_name}, applied {fmtDate(app.application_date)}</p>
            <div className="facts">
              <div><span>Declared PAN</span><strong className="mono">{app.pan_number}</strong></div>
              <div><span>Date of birth</span><strong>{app.dob}</strong></div>
              <div><span>Aadhaar</span><strong>XXXX XXXX {app.aadhaar_last4}</strong></div>
              <div><span>Pincode</span><strong>{app.pincode}</strong></div>
              <div><span>Occupation</span><strong>{app.occupation_code}</strong></div>
              <div><span>Annual income</span><strong>{fmtInr(app.annual_income)}</strong></div>
              <div><span>Extraction</span><strong>{app.extraction_provider ?? '—'}</strong></div>
              <div><span>Re-KYC due</span><strong>{app.rekyc_due_date ?? '—'}</strong></div>
            </div>
          </div>
          <div className="decision-stamp" style={{ ['--tone' as string]: decisionTone(app.decision) }}>
            <span className="small muted">Rules decision</span>
            <div className="d">{app.decision ?? 'Pending'}</div>
            <div className="small" style={{ marginTop: 4 }}>Name match <strong className="num">{app.name_match_score_display || '—'}</strong></div>
            <div className="row" style={{ gap: 4, marginTop: 8 }}>
              {(app.reason_codes ?? []).map((c: string) => <span className="code-chip" key={c}>{c}</span>)}
            </div>
          </div>
        </div>
        <div className="divider" />
        <Lifecycle status={app.status} timeline={data.timeline} />
      </section>

      {app.customer_id && <Alert tone="success">Account opened in core banking: customer <strong>{app.customer_id}</strong>, account <strong>{app.account_number}</strong>.</Alert>}

      <div className="workbench">
        <section className="panel">
          <div className="panel-head">
            <h2>Documents</h2>
            <span className="small muted">Every view is recorded in the audit trail</span>
          </div>
          <div className="doc-tabs" role="tablist">
            {data.documents.map((d: any) => {
              const mismatch = d.extraction && d.extraction.doc_type !== d.declared_doc_type;
              const low = !d.extraction || d.extraction.doc_type_confidence < MIN_CONF || Object.values(d.fields).some((f: any) => f.confidence < MIN_CONF);
              return (
                <button key={d.doc_id} role="tab" aria-selected={d.doc_id === doc?.doc_id} className={`doc-tab ${d.doc_id === doc?.doc_id ? 'active' : ''}`} onClick={() => { setDocId(d.doc_id); setActiveField(null); }}>
                  <FiFileText style={{ verticalAlign: -2 }} /> {d.file_name} {(mismatch || low) && <FiAlertTriangle className="warnmark" style={{ verticalAlign: -2 }} title={mismatch ? 'Type mismatch' : 'Low confidence'} />}
                  <div className="small muted">{docLabel(d.extraction?.doc_type)}{mismatch ? ` (declared ${docLabel(d.declared_doc_type)})` : ''}</div>
                </button>
              );
            })}
          </div>
          {doc && <DocText doc={doc} activeField={activeField} />}
        </section>

        <section className="panel">
          <div className="tabs" role="tablist">
            {(['fields', 'rules', 'screening', 'history'] as const).map((t) => (
              <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}>
                {{ fields: 'Extracted fields', rules: 'Rules R1–R17', screening: 'Screening', history: 'History' }[t]}
              </button>
            ))}
          </div>
          {tab === 'fields' && doc && (
            <FieldsTable
              doc={doc}
              canCorrect={role === 'KYC_OFFICER' && app.status === 'IN_REVIEW'}
              onCorrect={(field, value) => setCorrecting({ doc_id: doc.doc_id, field, value })}
              activeField={activeField}
              setActiveField={setActiveField}
              onReextract={async (provider) => {
                try {
                  const r = await api<any>(`/documents/${doc.doc_id}/extract?provider=${provider}`, { method: 'POST' });
                  toast(`Re-extracted with ${provider}: ${r.doc_type} (${r.confidence})`, 'success');
                  reload(true);
                } catch (e) {
                  handleErr(e);
                }
              }}
              canReextract={!!role && role !== 'APPLICANT'}
            />
          )}
          {tab === 'rules' && <RulesList engine={engine} />}
          {tab === 'screening' && <Screening engine={engine} />}
          {tab === 'history' && <History data={data} />}
        </section>
      </div>

      {app.decision === 'REVIEW' || app.status === 'IN_REVIEW' ? <AiSummary id={id} version={app.version} /> : null}

      {role === 'KYC_OFFICER' && app.status === 'IN_REVIEW' && (
        <MakerPanel app={app} onDone={(r) => { toast(`Recommendation recorded. Status: ${r.status}`, 'success'); reload(true); }} onError={handleErr} />
      )}
      {role === 'COMPLIANCE_OFFICER' && app.status === 'PENDING_CHECKER' && (
        <CheckerPanel app={app} me={user!.id} onDone={(r) => { toast(`Decision recorded. Status: ${r.status}`, 'success'); reload(true); }} onError={handleErr} />
      )}
      {role === 'KYC_OFFICER' && app.status === 'PENDING_CHECKER' && <Alert tone="info">This case is waiting for a Compliance Officer. A maker cannot give final approval.</Alert>}

      {correcting && (
        <CorrectionModal
          app={app}
          doc={data.documents.find((d: any) => d.doc_id === correcting.doc_id)}
          initial={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={(res) => {
            setCorrecting(null);
            setData({ ...res, view: 'officer' });
            toast(`Rules re-run: ${res.result.decision}${res.result.reason_codes.length ? ' (' + res.result.reason_codes.join(', ') + ')' : ', no reason codes'}`, 'success');
          }}
          onError={handleErr}
        />
      )}
    </div>
  );
}

/** Document text with the extracted values highlighted (span from the AI extractor, or a text search for mock values). */
function DocText({ doc, activeField }: { doc: any; activeField: string | null }) {
  const { data, error, loading } = useAsync(() => api<any>(`/documents/${doc.doc_id}/text`), [doc.doc_id]);
  const parts = useMemo(() => {
    if (!data) return [];
    const text: string = data.text;
    const ranges: { s: number; e: number; field: string }[] = [];
    for (const [k, f] of Object.entries<any>(doc.fields)) {
      if (f.span && f.span[1] > f.span[0]) ranges.push({ s: f.span[0], e: f.span[1], field: k });
      else if (f.value) {
        let needle = String(f.value);
        if (/^\d{4}-\d{2}-\d{2}$/.test(needle)) needle = needle.split('-').reverse().join('/');
        const i = text.toLowerCase().indexOf(needle.toLowerCase());
        if (i >= 0) ranges.push({ s: i, e: i + needle.length, field: k });
      }
    }
    ranges.sort((a, b) => a.s - b.s);
    const out: { t: string; field?: string }[] = [];
    let pos = 0;
    for (const r of ranges) {
      if (r.s < pos) continue;
      out.push({ t: text.slice(pos, r.s) });
      out.push({ t: text.slice(r.s, r.e), field: r.field });
      pos = r.e;
    }
    out.push({ t: text.slice(pos) });
    return out;
  }, [data, doc]);
  if (loading) return <div className="skeleton" style={{ height: 240 }} />;
  if (error) return <ErrorState error={error} />;
  return (
    <div className="doc-text" aria-label={`Text of ${doc.file_name}`}>
      {parts.map((p, i) => (p.field ? <mark key={i} className={p.field === activeField ? 'active' : ''} title={fieldLabel(p.field)}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
    </div>
  );
}

function FieldsTable({ doc, canCorrect, onCorrect, activeField, setActiveField, onReextract, canReextract }: {
  doc: any; canCorrect: boolean; onCorrect: (f: string, v: string) => void; activeField: string | null; setActiveField: (f: string | null) => void;
  onReextract: (p: 'mock' | 'ai') => void; canReextract: boolean;
}) {
  const ex = doc.extraction;
  const required = REQUIRED_FIELDS[ex?.doc_type ?? 'OTHER'] ?? [];
  const names = [...new Set([...required, ...Object.keys(doc.fields)])];
  return (
    <div className="stack">
      {!ex && <Alert tone="warn">No extraction yet.</Alert>}
      {ex && ex.status !== 'OK' && <Alert tone="warn">Extraction {ex.status.toLowerCase()}: {ex.error}. Enter the values manually with a reason.</Alert>}
      {ex?.classification?.prompt_injection && <Alert tone="warn"><FiShield /> This file contains instruction-like text aimed at automated systems. It was treated as data and classified as OTHER.</Alert>}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Field</th><th>Value</th><th>Confidence</th>{canCorrect && <th />}</tr></thead>
          <tbody>
            <tr className={ex && ex.doc_type_confidence < MIN_CONF ? 'low' : ''}>
              <td><strong>Document type</strong><div className="small muted">declared {docLabel(doc.declared_doc_type)}</div></td>
              <td>{docLabel(ex?.doc_type)} {ex?.doc_type_source === 'OFFICER' && <Badge tone="teal">Officer</Badge>}</td>
              <td><ConfidenceBar value={ex?.doc_type_confidence ?? 0} /></td>
              {canCorrect && <td><button className="btn ghost small" onClick={() => onCorrect('doc_type', ex?.doc_type ?? '')}><FiEdit3 /> Correct</button></td>}
            </tr>
            {names.map((n) => {
              const f = doc.fields[n];
              const low = !f || f.confidence < MIN_CONF;
              return (
                <tr key={n} className={low && required.includes(n) ? 'low' : ''} onMouseEnter={() => setActiveField(n)} onFocus={() => setActiveField(n)} style={activeField === n ? { outline: '2px solid var(--teal-tint)' } : undefined}>
                  <td>
                    <strong>{fieldLabel(n)}</strong>
                    {required.includes(n) && <div className="small muted">required</div>}
                  </td>
                  <td style={{ wordBreak: 'break-word' }}>
                    {f ? <span className={['pan_number', 'aadhaar_last4', 'pincode', 'dob'].includes(n) ? 'mono' : ''}>{f.value}</span> : <span className="muted">Not found</span>}
                    {f?.source === 'OFFICER' && <div><Badge tone="teal">Officer correction</Badge> <span className="small muted">was {f.original?.value ?? 'missing'} ({f.original?.confidence ?? '—'})</span></div>}
                    {f?.notes?.length > 0 && <div className="small muted">{f.notes.join('; ')}</div>}
                  </td>
                  <td><ConfidenceBar value={f ? f.confidence : null} /></td>
                  {canCorrect && <td><button className="btn ghost small" onClick={() => onCorrect(n, f?.value ?? '')}><FiEdit3 /> Correct</button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row between small muted">
        <span>{ex ? <>Provider <strong>{ex.provider}</strong>, {ex.extractor_version}</> : null}</span>
        {canReextract && (
          <span className="row" style={{ gap: 6 }}>
            <button className="btn secondary small" onClick={() => onReextract('ai')}><FiCpu /> Re-extract with AI</button>
            <button className="btn secondary small" onClick={() => onReextract('mock')}><FiRefreshCw /> Mock</button>
          </span>
        )}
      </div>
    </div>
  );
}

function Compare({ details }: { details: Record<string, any> }) {
  const d = details ?? {};
  const pairs: [string, string][] = Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => [k.replace(/_/g, ' '), typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(4) : String(v)]);
  for (const m of d.mismatches ?? []) pairs.push([m.doc_id, `declared ${m.declared}, read ${m.classified}`]);
  for (const c of d.compared ?? []) pairs.push([c.source, `${c.dob} ${c.matches ? '(matches)' : '(differs)'}`]);
  for (const c of d.comparisons ?? [])
    pairs.push([c.source, c.usable ? `"${c.normalised_document}" vs "${c.normalised_declared}" = ${c.similarity.toFixed(4)}` : `${c.document_name || 'name'} not usable`]);
  for (const f of d.low_or_missing_fields ?? []) pairs.push([`${f.doc_id} ${f.field}`, `${f.value ?? 'missing'} (${f.confidence ?? '—'})`]);
  for (const f of d.low_doc_type_confidence ?? []) pairs.push([`${f.doc_id} type`, `${f.doc_type} (${f.confidence})`]);
  if (d.best) pairs.push(['entry', `${d.best.entry_id} ${d.best.entry_name} (${d.best.similarity.toFixed(4)}, dob ${d.best.dob_comparison.toLowerCase().replace(/_/g, ' ')})`]);
  return (
    <dl className="compare">
      {pairs.map(([k, v], i) => (
        <Fragment key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function RulesList({ engine }: { engine: any }) {
  if (!engine) return <Alert tone="info">Rules have not run yet.</Alert>;
  return (
    <div>
      <p className="small muted" style={{ marginBottom: 6 }}>All rules are evaluated. A rule whose field is not usable (missing or below {MIN_CONF}) is skipped.</p>
      {engine.rules.map((r: any) => (
        <div key={r.rule} className={`rule ${r.triggered ? 'trig-' + r.outcome : ''}`}>
          <span className="rid">{r.rule}</span>
          <div>
            <strong>{r.code}</strong>
            <div className="det">{r.message}</div>
            {(r.triggered || r.rule === 'R9' || r.rule === 'R10' || r.rule === 'R16') && <Compare details={r.details} />}
          </div>
          <span>
            {!r.evaluated ? <Badge>Skipped</Badge> : r.triggered ? <Badge tone={r.outcome === 'REJECT' ? 'red' : 'amber'}>{r.outcome}</Badge> : <Badge tone="green">Pass</Badge>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Screening({ engine }: { engine: any }) {
  if (!engine) return <Alert tone="info">Not screened yet.</Alert>;
  const block = (title: string, s: any) => (
    <div className="subtle stack tight">
      <div className="row between">
        <h3>{title}</h3>
        <Badge tone={s.result === 'MATCH' ? 'red' : s.result === 'POSSIBLE' ? 'amber' : 'green'}>{s.result === 'NONE' ? 'No hit' : s.result}</Badge>
      </div>
      {s.hits.length === 0 ? <p className="small muted">No entry at or above the possible-match threshold.</p> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Entry</th><th>Matched on</th><th>Similarity</th><th>Entry dob</th><th>Declared dob</th><th>Result</th></tr></thead>
            <tbody>
              {s.hits.slice(0, 6).map((h: any) => (
                <tr key={h.entry_id}>
                  <td><strong>{h.entry_id}</strong> {h.entry_name}</td>
                  <td>{h.matched_on}: {h.matched_value}</td>
                  <td className="num">{h.similarity.toFixed(4)}</td>
                  <td>{h.entry_dob ?? 'empty'}</td>
                  <td>{h.declared_dob}</td>
                  <td><Badge tone={h.result === 'MATCH' ? 'red' : 'amber'}>{h.result}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
  return <div className="stack">{block('Sanctions', engine.sanctions)}{block('Politically exposed persons', engine.pep)}</div>;
}

function History({ data }: { data: any }) {
  return (
    <div className="stack">
      <div>
        <h3 style={{ marginBottom: 8 }}>Rules evaluations</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>Trigger</th><th>Decision</th><th>Reasons</th></tr></thead>
            <tbody>{data.decisions.map((d: any) => <tr key={d.id}><td className="small">{fmtDateTime(d.created_at)}</td><td>{d.trigger}</td><td>{d.decision}</td><td className="small">{d.reason_codes.join(', ') || '—'}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      {data.corrections.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 8 }}>Field corrections</h3>
          <ul className="timeline">
            {data.corrections.map((c: any) => (
              <li key={c.id}><span className="tdot" /><div><strong>{fieldLabel(c.field_name)}</strong> on {c.doc_id}: <span className="mono">{c.old_value ?? 'missing'}</span> to <span className="mono">{c.new_value}</span><div className="small muted">{c.officer_name}, {fmtDateTime(c.created_at)}. Reason: {c.reason}</div></div></li>
            ))}
          </ul>
        </div>
      )}
      {data.actions.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 8 }}>Maker and checker actions</h3>
          <ul className="timeline">
            {data.actions.map((a: any) => (
              <li key={a.id}><span className="tdot" /><div><strong>{a.action === 'RECOMMENDATION' ? 'Recommendation' : 'Checker decision'}: {a.value}</strong><div className="small muted">{a.actor_name}, {fmtDateTime(a.created_at)}</div><p className="small">{a.comment}</p></div></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AiSummary({ id, version }: { id: string; version: number }) {
  const [s, setS] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setS(null), [version]);
  return (
    <section className="ai-card">
      <div className="row between">
        <div className="row"><FiZap color="var(--violet)" /><h3>Reviewer summary</h3>{s && <Badge tone="violet">{s.label}</Badge>}</div>
        <button className="btn secondary small" disabled={busy} onClick={async () => { setBusy(true); try { setS(await api(`/applications/${id}/summary`)); } finally { setBusy(false); } }}>
          {busy ? 'Writing…' : s ? 'Regenerate' : 'Summarise discrepancies'}
        </button>
      </div>
      {s ? <p style={{ marginTop: 10 }}>{s.summary}</p> : <p className="small muted" style={{ marginTop: 6 }}>Lists the discrepancies found by the rules in at most 80 words. It never recommends a decision.</p>}
    </section>
  );
}

function MakerPanel({ app, onDone, onError }: { app: any; onDone: (r: any) => void; onError: (e: unknown) => void }) {
  const [rec, setRec] = useState<'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION'>('APPROVE');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const sanctions = (app.reason_codes ?? []).includes('SANCTIONS_MATCH');
  const submit = async () => {
    if (comment.trim().length < 10) return setErr('Comment must have at least 10 characters');
    setBusy(true);
    setErr('');
    try {
      onDone(await api(`/applications/${app.application_id}/recommendation`, { body: { recommendation: rec, comment, expected_version: app.version } }));
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 422) setErr(Object.values(ae.fields).join(' ') || ae.message);
      else onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel stack">
      <div>
        <h2>Your recommendation</h2>
        <p className="muted small">Approve and reject go to a Compliance Officer for the final decision. Requesting resubmission gives the applicant {7} days.</p>
      </div>
      {app.decision === 'REJECT' && <Alert tone="warn">The current rules decision is REJECT. Make sure your comment explains any override.</Alert>}
      <div className="row">
        {(['APPROVE', 'REJECT', 'REQUEST_RESUBMISSION'] as const).map((r) => (
          <label key={r} className="check" style={{ padding: '8px 12px', border: '1px solid var(--line-strong)', borderRadius: 9, background: rec === r ? 'var(--teal-tint)' : '#fff' }}>
            <input type="radio" name="rec" checked={rec === r} onChange={() => setRec(r)} disabled={r === 'APPROVE' && sanctions} />
            {{ APPROVE: 'Recommend approval', REJECT: 'Recommend rejection', REQUEST_RESUBMISSION: 'Ask for new documents' }[r]}
          </label>
        ))}
      </div>
      <Field label="Comment" error={err} hint={rec === 'REQUEST_RESUBMISSION' ? 'The applicant will see this message' : 'At least 10 characters; recorded in the audit trail'}>
        <textarea className={`textarea ${err ? 'invalid' : ''}`} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className={`btn ${rec === 'APPROVE' ? 'approve' : rec === 'REJECT' ? 'reject' : 'warn'}`} disabled={busy} onClick={submit}>
          {{ APPROVE: 'Send approval recommendation', REJECT: 'Send rejection recommendation', REQUEST_RESUBMISSION: 'Request new documents' }[rec]}
        </button>
      </div>
    </section>
  );
}

function CheckerPanel({ app, me, onDone, onError }: { app: any; me: number; onDone: (r: any) => void; onError: (e: unknown) => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const isMaker = app.maker_user_id === me;
  const decide = async (decision: 'APPROVE' | 'REJECT' | 'SEND_BACK') => {
    if (comment.trim().length < 10) return setErr('Comment must have at least 10 characters');
    setBusy(decision);
    setErr('');
    try {
      onDone(await api(`/applications/${app.application_id}/checker-decision`, { body: { decision, comment, expected_version: app.version } }));
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 403 || ae.status === 422) setErr(ae.message);
      else onError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="panel stack">
      <div>
        <h2>Checker decision</h2>
        {app.maker ? (
          <p className="muted small">Maker <strong>{app.maker.full_name}</strong> recommended <strong>{app.maker_recommendation}</strong>: "{app.maker_comment}"</p>
        ) : (
          <p className="muted small">No maker step: the rules approved this case but its risk is HIGH, so a second person must confirm.</p>
        )}
      </div>
      {isMaker && <Alert tone="error">You made the recommendation on this case. Maker and checker must be different people, so the server will refuse your decision.</Alert>}
      <Field label="Comment" error={err} hint="At least 10 characters; recorded in the audit trail">
        <textarea className={`textarea ${err ? 'invalid' : ''}`} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn secondary" disabled={!!busy} onClick={() => decide('SEND_BACK')}>Send back to review</button>
        <button className="btn reject" disabled={!!busy} onClick={() => decide('REJECT')}>Reject</button>
        <button className="btn approve" disabled={!!busy} onClick={() => decide('APPROVE')}>{busy === 'APPROVE' ? 'Opening account…' : 'Approve and open account'}</button>
      </div>
    </section>
  );
}

function CorrectionModal({ app, doc, initial, onClose, onSaved, onError }: {
  app: any; doc: any; initial: { doc_id: string; field: string; value: string }; onClose: () => void; onSaved: (r: any) => void; onError: (e: unknown) => void;
}) {
  const [field, setField] = useState(initial.field);
  const [value, setValue] = useState(initial.value);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      onSaved(await api(`/applications/${app.application_id}/corrections`, { body: { doc_id: doc.doc_id, field_name: field, new_value: value, reason, expected_version: app.version } }));
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 422) setErrors(ae.fields);
      else onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Correct a field on ${doc.file_name}`} onClose={onClose}>
      <div className="stack">
        <Alert tone="info">The corrected value gets confidence 1.00 and source OFFICER. The rules re-run immediately; the case still goes to a checker.</Alert>
        <Field label="Field" error={errors.field_name}>
          <select className="select" value={field} onChange={(e) => { setField(e.target.value); setValue(e.target.value === 'doc_type' ? doc.extraction?.doc_type ?? '' : doc.fields[e.target.value]?.value ?? ''); }}>
            <option value="doc_type">Document type</option>
            {FIELD_NAMES.map((f) => <option key={f} value={f}>{fieldLabel(f)}</option>)}
          </select>
        </Field>
        <Field label="Current value"><span className="mono">{field === 'doc_type' ? doc.extraction?.doc_type : doc.fields[field]?.value ?? 'missing'}</span></Field>
        <Field label="New value" error={errors.new_value} hint={['dob', 'document_date', 'valid_until'].includes(field) ? 'YYYY-MM-DD' : undefined}>
          {field === 'doc_type' ? (
            <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>{DOC_TYPES.map((t) => <option key={t} value={t}>{docLabel(t)}</option>)}</select>
          ) : (
            <input className={`input ${errors.new_value ? 'invalid' : ''}`} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </Field>
        <Field label="Reason" error={errors.reason} hint="Required; recorded with the before and after values">
          <textarea className={`textarea ${errors.reason ? 'invalid' : ''}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Read from the document text: ..." />
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save correction and re-run rules'}</button>
        </div>
      </div>
    </Modal>
  );
}
