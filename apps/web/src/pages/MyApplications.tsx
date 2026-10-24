import { useEffect, useState } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiTrash2 } from 'react-icons/fi';
import { Lifecycle } from '../components/Lifecycle';
import { Alert, Empty, ErrorState, Spinner, StatusBadge, useAsync, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { docLabel, fmtDate, fmtDateTime } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { FilePicker, type PickedFile } from './Apply';

export function MyApplicationsPage() {
  const { navigate } = useRouter();
  const { data, error, loading, reload } = useAsync(() => api<{ items: any[] }>('/applications/mine'));
  const busy = data?.items.some((a) => ['SUBMITTED', 'EXTRACTING'].includes(a.status));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => reload(true), 1500);
    return () => clearInterval(t);
  }, [busy, reload]);

  if (loading) return <Spinner label="Loading your applications" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>My applications</h1>
          <p>Follow each application from submission to decision.</p>
        </div>
        <Link to="/apply" className="btn">Start a new application</Link>
      </div>
      {data!.items.length === 0 ? (
        <div className="panel">
          <Empty title="No applications yet">
            <p style={{ marginBottom: 14 }}>Start one now: you need your PAN card, Aadhaar card and an address proof as .txt files.</p>
            <Link to="/apply" className="btn">Start an application</Link>
          </Empty>
        </div>
      ) : (
        <div className="stack">
          {data!.items.map((a) => (
            <article key={a.application_id} className="panel stack" style={{ cursor: 'pointer' }} onClick={() => navigate(`/my/${a.application_id}`)}>
              <div className="row between">
                <div>
                  <h3 className="num">{a.application_id}</h3>
                  <span className="small muted">Submitted {fmtDateTime(a.submitted_at)}</span>
                </div>
                <StatusBadge status={a.status} />
              </div>
              <Lifecycle status={a.status} timeline={a.timeline} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function MyApplicationDetailPage({ id }: { id: string }) {
  const toast = useToast();
  const { data: a, error, loading, reload } = useAsync(() => api<any>(`/applications/${id}`), [id]);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!a || !['SUBMITTED', 'EXTRACTING'].includes(a.status)) return;
    const t = setInterval(() => reload(true), 1200);
    return () => clearInterval(t);
  }, [a, reload]);

  if (loading) return <Spinner label="Loading application" />;
  if (error) return <ErrorState error={error} />;

  const approved = ['AUTO_APPROVED', 'APPROVED'].includes(a.status);
  const rejected = ['AUTO_REJECTED', 'REJECTED', 'CLOSED_EXPIRED'].includes(a.status);
  const active = a.documents.filter((d: any) => d.active);

  const upload = async () => {
    setErr('');
    const send = files.filter((f) => !f.error);
    if (send.some((f) => !f.type)) return setErr('Choose a document type for every file.');
    const fd = new FormData();
    send.forEach((f) => fd.append('files', f.file, f.file.name));
    fd.append('declared_types', JSON.stringify(send.map((f) => f.type)));
    setBusy(true);
    try {
      const r = await api<any>(`/applications/${id}/documents`, { form: fd });
      toast(`${r.added.length} document(s) added${r.duplicates_ignored.length ? `, ${r.duplicates_ignored.length} identical file(s) ignored` : ''}`, 'success');
      setFiles([]);
      reload(true);
    } catch (e) {
      setErr((e as ApiError).message + ' ' + Object.values((e as ApiError).fields).join(' '));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (docId: string) => {
    try {
      await api(`/applications/${id}/documents/${docId}`, { method: 'DELETE' });
      reload(true);
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };
  const resubmit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api(`/applications/${id}/resubmit`, { method: 'POST' });
      toast('Resubmitted. We are checking your documents again.', 'success');
      reload(true);
    } catch (e) {
      setErr((e as ApiError).message + ' ' + Object.values((e as ApiError).fields).join(' '));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <Link to="/my" className="small">My applications</Link>
          <h1 className="num" style={{ marginTop: 6 }}>Application {a.application_id}</h1>
          <p>{a.full_name}, PAN {a.pan_masked}, Aadhaar {a.aadhaar_masked}</p>
        </div>
        <StatusBadge status={a.status} />
      </div>

      <section className="panel">
        <Lifecycle status={a.status} timeline={a.timeline} />
      </section>

      {['SUBMITTED', 'EXTRACTING'].includes(a.status) && (
        <Alert tone="info"><Spinner /> We are reading your documents and running our checks. This page updates by itself.</Alert>
      )}

      {approved && (
        <section className="panel" style={{ borderColor: 'var(--leaf)' }}>
          <div className="row">
            <FiCheckCircle size={28} color="var(--leaf)" />
            <div>
              <h2>Your account is open</h2>
              <p className="muted">Welcome to Deccan Digital Bank.</p>
            </div>
          </div>
          <div className="facts">
            <div><span>Customer ID</span><strong>{a.account?.customer_id}</strong></div>
            <div><span>Account number</span><strong>{a.account?.account_number}</strong></div>
            <div><span>Next KYC update due</span><strong>{fmtDate(a.rekyc_due_date)}</strong></div>
          </div>
        </section>
      )}

      {a.reasons.length > 0 && (
        <section className="panel">
          <h2 style={{ marginBottom: 10 }}>{rejected ? 'Why your application was not approved' : 'What we are checking'}</h2>
          <ul className="stack tight" style={{ margin: 0, paddingLeft: 18 }}>
            {a.reasons.map((r: string) => <li key={r}>{r}</li>)}
          </ul>
          {a.status === 'IN_REVIEW' && <p className="muted small" style={{ marginTop: 10 }}>A KYC officer is looking at your application. You will see the outcome here.</p>}
          {a.status === 'PENDING_CHECKER' && <p className="muted small" style={{ marginTop: 10 }}>Your application is waiting for final approval by a second officer.</p>}
        </section>
      )}

      {a.status === 'RESUBMISSION_REQUESTED' && (
        <section className="panel stack" style={{ borderColor: 'var(--saffron)' }}>
          <div className="row">
            <FiAlertTriangle size={24} color="var(--saffron)" />
            <div>
              <h2>Please upload new documents</h2>
              <p className="muted small">Deadline: {fmtDateTime(a.resubmission.due_at)}. After that the application closes.</p>
            </div>
          </div>
          {a.resubmission.officer_message && <div className="subtle"><strong className="small">Message from the KYC officer</strong><p>{a.resubmission.officer_message}</p></div>}
          <div>
            <h3 style={{ marginBottom: 8 }}>Current documents</h3>
            <div className="stack tight">
              {active.map((d: any) => (
                <div key={d.doc_id} className="file-row" style={{ gridTemplateColumns: '1fr auto' }}>
                  <span><strong>{d.file_name}</strong> <span className="muted small">{docLabel(d.declared_doc_type)}</span></span>
                  <button className="btn ghost small" onClick={() => remove(d.doc_id)}><FiTrash2 /> Remove</button>
                </div>
              ))}
            </div>
          </div>
          <FilePicker files={files} setFiles={setFiles} />
          {err && <Alert tone="error">{err}</Alert>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {files.length > 0 && <button className="btn secondary" onClick={upload} disabled={busy}>Upload files</button>}
            <button className="btn" onClick={resubmit} disabled={busy || files.length > 0}>Resubmit application</button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2 style={{ marginBottom: 10 }}>Documents</h2>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>File</th><th>Declared as</th><th>Uploaded</th><th>State</th></tr></thead>
            <tbody>
              {a.documents.map((d: any) => (
                <tr key={d.doc_id}>
                  <td>{d.file_name}</td>
                  <td>{docLabel(d.declared_doc_type)}</td>
                  <td>{fmtDateTime(d.uploaded_at)}</td>
                  <td>{d.active ? 'In use' : 'Removed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
