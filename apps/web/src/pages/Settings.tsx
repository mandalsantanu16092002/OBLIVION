import { useEffect, useState } from 'react';
import { FiPlus, FiRefreshCw, FiSave } from 'react-icons/fi';
import { Alert, Badge, ErrorState, Field, Spinner, useAsync, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { fmtDateTime } from '../lib/format';

const NUM_FIELDS: { key: string; label: string; step: string; hint: string }[] = [
  { key: 'min_field_confidence', label: 'Minimum usable field confidence', step: '0.01', hint: 'Fields below this are not used by identity rules (R3)' },
  { key: 'name_match_threshold', label: 'Name match: pass at', step: '0.01', hint: 'Below this and at or above the reject level: NAME_MISMATCH_MINOR' },
  { key: 'name_reject_below', label: 'Name match: reject below', step: '0.01', hint: 'NAME_MISMATCH (R9)' },
  { key: 'watchlist_match_threshold', label: 'Watchlist match threshold', step: '0.01', hint: 'With the date-of-birth rule' },
  { key: 'watchlist_possible_threshold', label: 'Watchlist possible-match threshold', step: '0.01', hint: 'From here to the match threshold: POSSIBLE' },
  { key: 'min_age', label: 'Minimum age (years)', step: '1', hint: 'R4' },
  { key: 'address_proof_max_age_days', label: 'Address proof maximum age (days)', step: '1', hint: 'R13' },
  { key: 'medium_risk_income', label: 'MEDIUM-risk income threshold (₹)', step: '1', hint: 'Risk category' },
  { key: 'resubmission_sla_days', label: 'Resubmission window (days)', step: '1', hint: 'Then CLOSED_EXPIRED' },
  { key: 'checker_sla_hours', label: 'Checker SLA (hours)', step: '1', hint: 'Dashboard overdue count' },
];

export function SettingsPage() {
  const toast = useToast();
  const cfg = useAsync(() => api<any>('/admin/config'));
  const settings = useAsync(() => api<any>('/admin/settings'));
  const history = useAsync(() => api<any>('/admin/config/history'));
  const [draft, setDraft] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (cfg.data) setDraft(structuredClone(cfg.data.config));
  }, [cfg.data]);

  const save = async () => {
    setErrors({});
    const patch: any = {};
    for (const f of NUM_FIELDS) patch[f.key] = Number(draft[f.key]);
    patch.pan_pattern = draft.pan_pattern;
    patch.pan_holder_type_char = draft.pan_holder_type_char;
    patch.rekyc_years = { HIGH: Number(draft.rekyc_years.HIGH), MEDIUM: Number(draft.rekyc_years.MEDIUM), LOW: Number(draft.rekyc_years.LOW) };
    patch.name_title_tokens = String(draft.name_title_tokens_text ?? draft.name_title_tokens.join(', ')).split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean);
    try {
      const r = await api<any>('/admin/config', { method: 'PUT', body: { config: patch, comment } });
      toast(Object.keys(r.changed).length ? `Saved configuration version ${r.id}: ${Object.keys(r.changed).join(', ')}` : 'No changes', 'success');
      cfg.reload(true);
      history.reload(true);
      setComment('');
    } catch (e) {
      setErrors((e as ApiError).fields);
      toast((e as ApiError).message, 'error');
    }
  };

  const updateSettings = async (body: any) => {
    try {
      await api('/admin/settings', { method: 'PUT', body });
      toast('Setting saved', 'success');
      settings.reload(true);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Rules and watchlists</h1>
          <p>Thresholds, patterns and lists are data. Changes apply to the next evaluation without a code change.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Processing</h2></div>
        {settings.loading ? <Spinner /> : settings.error ? <ErrorState error={settings.error} /> : (
          <div className="grid2">
            <Field label="Extraction provider" hint="mock reads the extraction_mock files; ai calls the Python AI service (10 s timeout, falls back to REVIEW)">
              <div className="row">
                {(['mock', 'ai'] as const).map((p) => (
                  <button key={p} className={`btn ${settings.data.extraction_provider === p ? '' : 'secondary'}`} onClick={() => updateSettings({ extraction_provider: p })}>
                    {p === 'mock' ? 'Mock service' : 'AI extractor'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Business date" hint="Used as the application date for new applications. Empty means today (IST). The data-pack documents are dated early 2026.">
              <div className="row">
                <input className="input" type="date" style={{ width: 'auto' }} defaultValue={settings.data.business_date ?? ''} id="bd" />
                <button className="btn secondary" onClick={() => updateSettings({ business_date: (document.getElementById('bd') as HTMLInputElement).value || null })}>Save date</button>
              </div>
            </Field>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Rule configuration</h2>
          <span className="small muted">Loaded from case_02_rules_config_V1.0.json; every save creates a new version</span>
        </div>
        {cfg.loading || !draft ? <Spinner /> : cfg.error ? <ErrorState error={cfg.error} /> : (
          <div className="stack">
            <div className="form-grid">
              {NUM_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]}>
                  <input className={`input ${errors[f.key] ? 'invalid' : ''}`} type="number" step={f.step} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                </Field>
              ))}
              <Field label="PAN pattern" error={errors.pan_pattern}><input className="input mono" value={draft.pan_pattern} onChange={(e) => setDraft({ ...draft, pan_pattern: e.target.value })} /></Field>
              <Field label="PAN holder-type character (4th)" error={errors.pan_holder_type_char}><input className="input" maxLength={1} value={draft.pan_holder_type_char} onChange={(e) => setDraft({ ...draft, pan_holder_type_char: e.target.value.toUpperCase() })} /></Field>
              <Field label="Re-KYC years: HIGH / MEDIUM / LOW">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  {(['HIGH', 'MEDIUM', 'LOW'] as const).map((r) => (
                    <input key={r} className="input" type="number" aria-label={`${r} years`} value={draft.rekyc_years[r]} onChange={(e) => setDraft({ ...draft, rekyc_years: { ...draft.rekyc_years, [r]: e.target.value } })} />
                  ))}
                </div>
              </Field>
              <Field label="Name title tokens removed" hint="Comma separated">
                <input className="input" value={draft.name_title_tokens_text ?? draft.name_title_tokens.join(', ')} onChange={(e) => setDraft({ ...draft, name_title_tokens_text: e.target.value })} />
              </Field>
            </div>
            <div className="row between">
              <input className="input" style={{ maxWidth: 420 }} placeholder="Why are you changing this? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
              <button className="btn" onClick={save}><FiSave /> Save configuration</button>
            </div>
            {history.data && (
              <details>
                <summary className="small" style={{ cursor: 'pointer' }}>Configuration versions ({history.data.items.length})</summary>
                <ul className="small" style={{ marginTop: 8 }}>
                  {history.data.items.map((h: any) => <li key={h.id}>Version {h.id}, {fmtDateTime(h.created_at)} by {h.created_by ?? 'seed'}{h.comment ? `: ${h.comment}` : ''}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      <Watchlists />
    </div>
  );
}

function Watchlists() {
  const toast = useToast();
  const [list, setList] = useState<'SANCTIONS' | 'PEP'>('SANCTIONS');
  const wl = useAsync(() => api<any>(`/admin/watchlists?list_type=${list}`), [list]);
  const [entry, setEntry] = useState({ entry_id: '', name: '', alias: '', dob: '', extra: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any[] | null>(null);

  const add = async (rescreen: boolean) => {
    setErrors({});
    try {
      const r = await api<any>('/admin/watchlists', { body: { list_type: list, ...entry, alias: entry.alias || null, dob: entry.dob || null, rescreen } });
      toast(`Saved ${entry.entry_id}`, 'success');
      if (r.rescreen) setResult(r.rescreen);
      setEntry({ entry_id: '', name: '', alias: '', dob: '', extra: '' });
      wl.reload(true);
    } catch (e) {
      setErrors((e as ApiError).fields);
    }
  };
  const rescreen = async () => {
    const r = await api<any>('/admin/watchlists/rescreen', { method: 'POST' });
    setResult(r.changed);
    toast(`Re-screened open cases: ${r.changed.length} changed`, 'success');
  };
  const deactivate = async (id: string) => {
    await api(`/admin/watchlists/${list}/${id}`, { method: 'DELETE' });
    toast(`${id} deactivated. Re-screen open cases to apply.`, 'info');
    wl.reload(true);
  };

  return (
    <section className="panel stack">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h2>Watchlists</h2>
        <div className="row">
          {(['SANCTIONS', 'PEP'] as const).map((l) => <button key={l} className={`btn small ${list === l ? '' : 'secondary'}`} onClick={() => setList(l)}>{l === 'SANCTIONS' ? 'Sanctions' : 'PEP'}</button>)}
          <button className="btn secondary small" onClick={rescreen}><FiRefreshCw /> Re-screen open cases</button>
        </div>
      </div>
      {result && (
        <Alert tone={result.length ? 'warn' : 'success'}>
          {result.length ? <>Reason codes changed on: {result.map((r) => `${r.application_id} (${r.after.join('|') || 'none'})`).join(', ')}</> : 'No open case changed.'}
        </Alert>
      )}
      <div className="subtle">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
          <Field label="Entry ID" error={errors.entry_id}><input className="input" value={entry.entry_id} onChange={(e) => setEntry({ ...entry, entry_id: e.target.value })} placeholder={list === 'SANCTIONS' ? 'SAN0051' : 'PEP0061'} /></Field>
          <Field label="Name" error={errors.name}><input className="input" value={entry.name} onChange={(e) => setEntry({ ...entry, name: e.target.value })} /></Field>
          <Field label="Alias"><input className="input" value={entry.alias} onChange={(e) => setEntry({ ...entry, alias: e.target.value })} disabled={list === 'PEP'} /></Field>
          <Field label="Date of birth" error={errors.dob}><input className="input" type="date" value={entry.dob} onChange={(e) => setEntry({ ...entry, dob: e.target.value })} /></Field>
          <Field label="Programme / position"><input className="input" value={entry.extra} onChange={(e) => setEntry({ ...entry, extra: e.target.value })} /></Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn secondary small" onClick={() => add(false)}><FiPlus /> Add entry</button>
          <button className="btn small" onClick={() => add(true)}><FiPlus /> Add and re-screen</button>
        </div>
      </div>
      {wl.loading ? <Spinner /> : wl.error ? <ErrorState error={wl.error} /> : (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="data">
            <thead><tr><th>ID</th><th>Name</th><th>Alias</th><th>Date of birth</th><th>Details</th><th>State</th><th /></tr></thead>
            <tbody>
              {wl.data.items.map((e: any) => (
                <tr key={e.entry_id}>
                  <td className="num">{e.entry_id}</td><td>{e.name}</td><td>{e.alias ?? '—'}</td><td>{e.dob ?? 'empty'}</td><td className="small muted">{e.extra}</td>
                  <td>{e.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td>{e.active && <button className="btn ghost small" onClick={() => deactivate(e.entry_id)}>Deactivate</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
