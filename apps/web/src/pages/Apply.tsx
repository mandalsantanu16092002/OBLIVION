import { useMemo, useRef, useState } from 'react';
import { FiFileText, FiTrash2, FiUploadCloud } from 'react-icons/fi';
import { DECLARABLE_DOC_TYPES, DOC_TYPE_LABELS, makeApplicationSchema } from '@onboardiq/shared';
import { Alert, Field, Spinner, useAsync, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { docLabel, firstIssues, fmtInr } from '../lib/format';
import { useRouter } from '../lib/router';

type Form = Record<string, string | boolean>;
const EMPTY: Form = {
  full_name: '', dob: '', gender: '', pan_number: '', aadhaar_last4: '', mobile: '', email: '', address: '', city: '', state: '',
  pincode: '', occupation_code: '', annual_income: '', kyc_consent: false,
};

/** Data-pack applicants for demos; their document files are in data/eval/documents. */
const PRESETS: { id: string; label: string; files: string; data: Form }[] = [
  {
    id: 'A2100002', label: 'Nikhil Chandra Menon (clean case)', files: 'D3000186.txt, D3000187.txt, D3000188.txt (PAN, Aadhaar, bank statement)',
    data: { full_name: 'Nikhil Chandra Menon', dob: '1963-04-25', gender: 'M', pan_number: 'ZZIPM9402B', aadhaar_last4: '3083', mobile: '9568031370', email: 'nikhil.menon84@example.com', address: 'House No. 228, Green Park Society, Station Road, Kochi, Kerala', city: 'Kochi', state: 'Kerala', pincode: '682097', occupation_code: 'BUSINESS_OWNER', annual_income: '4500000' },
  },
  {
    id: 'A2100001', label: 'Aisha Menon (poor-quality Aadhaar scan)', files: 'D3000183.txt, D3000184.txt, D3000185.txt (PAN, Aadhaar, bank statement)',
    data: { full_name: 'Aisha Menon', dob: '1968-10-05', gender: 'F', pan_number: 'ZZYPM8142P', aadhaar_last4: '1171', mobile: '9349891442', email: 'aisha.menon429@example.com', address: 'House No. 227, Lotus Residency, Gandhi Nagar, Delhi, Delhi', city: 'Delhi', state: 'Delhi', pincode: '110038', occupation_code: 'SELF_EMPLOYED', annual_income: '4500000' },
  },
  {
    id: 'A2100100', label: 'Imran Mohan Das (file with injected instructions)', files: 'D3000483.txt (PAN), D3000485.txt (electricity bill), D3000486.txt (declared Aadhaar)',
    data: { full_name: 'Imran Mohan Das', dob: '1984-04-18', gender: 'M', pan_number: 'ZZLPD3538P', aadhaar_last4: '9216', mobile: '9793590110', email: 'imran.das769@example.com', address: 'House No. 365, Sai Krupa Apartments, Hill Road, Chennai, Tamil Nadu', city: 'Chennai', state: 'Tamil Nadu', pincode: '600035', occupation_code: 'SALARIED_PRIVATE', annual_income: '900000' },
  },
];

export interface PickedFile {
  file: File;
  type: string;
  error?: string;
  hash?: string;
  duplicateOf?: string;
}

async function sha256(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Client-side checks mirror the server: .txt, UTF-8, non-empty, at most 1 MB (the server re-checks everything). */
export async function checkFiles(files: File[], existing: PickedFile[]): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const hashes = new Map(existing.filter((f) => f.hash).map((f) => [f.hash!, f.file.name]));
  for (const file of files) {
    let error: string | undefined;
    let hash: string | undefined;
    if (!/\.txt$/i.test(file.name)) error = 'Only .txt files are accepted';
    else if (file.size === 0) error = 'File is empty';
    else if (file.size > 1024 * 1024) error = 'File is larger than 1 MB';
    else {
      const buf = await file.arrayBuffer();
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        if (/[\u0000-\u0008\u000B\u000E-\u001F]/.test(text)) error = 'File contains binary data';
      } catch {
        error = 'File is not valid UTF-8 text';
      }
      hash = await sha256(buf);
    }
    const duplicateOf = hash ? hashes.get(hash) : undefined;
    if (hash && !duplicateOf) hashes.set(hash, file.name);
    out.push({ file, type: '', error, hash, duplicateOf });
  }
  return out;
}

export function FilePicker({ files, setFiles }: { files: PickedFile[]; setFiles: (f: PickedFile[]) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = async (list: FileList | null) => {
    if (!list) return;
    setFiles([...files, ...(await checkFiles([...list], files))]);
  };
  return (
    <div className="stack">
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <FiUploadCloud size={30} color="var(--teal)" />
        <h3 style={{ marginTop: 8 }}>Drop .txt documents here or click to choose</h3>
        <p className="muted small">UTF-8 text, up to 1 MB each. You need a PAN card, an Aadhaar card and one address proof.</p>
        <input ref={input} type="file" accept=".txt,text/plain" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {files.map((f, i) => (
        <div key={i} className={`file-row ${f.error ? 'bad' : ''}`}>
          <div className="row" style={{ minWidth: 0, flexWrap: 'nowrap' }}>
            <FiFileText color="var(--muted)" />
            <div style={{ minWidth: 0 }}>
              <strong style={{ wordBreak: 'break-all' }}>{f.file.name}</strong>
              <div className="small muted">
                {(f.file.size / 1024).toFixed(1)} KB
                {f.error && <span style={{ color: 'var(--brick)', fontWeight: 700 }}> {f.error}</span>}
                {f.duplicateOf && <span style={{ color: '#8a540a', fontWeight: 700 }}> Same content as {f.duplicateOf}; it will be stored once</span>}
              </div>
            </div>
          </div>
          <select
            className={`select ${!f.type && !f.error ? 'invalid' : ''}`}
            value={f.type}
            disabled={!!f.error}
            aria-label={`Document type for ${f.file.name}`}
            onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
          >
            <option value="">Choose document type</option>
            {DECLARABLE_DOC_TYPES.map((t) => (
              <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <button className="btn ghost" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.file.name}`}>
            <FiTrash2 />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ApplyPage() {
  const { navigate } = useRouter();
  const toast = useToast();
  const meta = useAsync(() => Promise.all([api('/reference/meta'), api('/reference/occupations')]), []);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState('');
  const [preset, setPreset] = useState<string>('');

  const businessDate = meta.data?.[0]?.business_date as string | undefined;
  const occupations = (meta.data?.[1]?.items ?? []) as { occupation_code: string; description: string }[];
  const schema = useMemo(
    () => (businessDate ? makeApplicationSchema({ today: businessDate, panPattern: meta.data?.[0]?.pan_pattern, occupationCodes: occupations.map((o) => o.occupation_code) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [businessDate, occupations.length],
  );

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm({ ...form, [k]: v });
    if (errors[k]) setErrors({ ...errors, [k]: '' });
  };

  const validateDetails = async () => {
    setTopError('');
    if (schema) {
      const r = schema.safeParse(form);
      if (!r.success) {
        setErrors(firstIssues(r.error.issues));
        setTopError('Please correct the highlighted fields.');
        return;
      }
    }
    setBusy(true);
    try {
      await api('/applications/validate', { body: form });
      setErrors({});
      setStep(2);
    } catch (e) {
      const ae = e as ApiError;
      setErrors(ae.fields);
      setTopError(ae.message);
    } finally {
      setBusy(false);
    }
  };

  const goodFiles = files.filter((f) => !f.error && !f.duplicateOf);
  const docProblems = [
    files.some((f) => f.error) && 'Remove the files marked in red.',
    goodFiles.length < 3 && 'Add at least 3 different documents.',
    files.some((f) => !f.error && !f.type) && 'Choose a document type for every file.',
  ].filter(Boolean) as string[];

  const submit = async () => {
    setBusy(true);
    setTopError('');
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.append(k, String(v));
    const send = files.filter((f) => !f.error);
    send.forEach((f) => fd.append('files', f.file, f.file.name));
    fd.append('declared_types', JSON.stringify(send.map((f) => f.type)));
    try {
      const r = await api<{ application_id: string }>('/applications', { form: fd });
      toast(`Application ${r.application_id} submitted`, 'success');
      navigate(`/my/${r.application_id}`);
    } catch (e) {
      const ae = e as ApiError;
      setTopError(ae.message);
      const fieldErrs = Object.entries(ae.fields ?? {});
      if (fieldErrs.some(([k]) => !k.startsWith('files') && !k.startsWith('declared'))) {
        setErrors(ae.fields);
        setStep(1);
      } else if (fieldErrs.length) {
        setStep(2);
        setTopError(`${ae.message} ${fieldErrs.map(([, v]) => v).join(' ')}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const input = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string, cls?: string) => (
    <Field label={label} error={errors[k]} hint={hint} className={cls}>
      <input className={`input ${errors[k] ? 'invalid' : ''}`} value={String(form[k] ?? '')} onChange={set(k)} name={k} {...props} />
    </Field>
  );

  if (meta.loading) return <Spinner label="Loading form" />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Open a savings account</h1>
          <p>Takes about five minutes. Clean applications are decided straight away.</p>
        </div>
      </div>
      <ol className="steps" aria-label="Progress">
        {['Your details', 'Documents', 'Review and submit'].map((s, i) => (
          <li key={s} className={`step ${step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}`}>
            <span className="n">{i + 1}</span> {s}
          </li>
        ))}
      </ol>
      {topError && <div style={{ marginBottom: 16 }}><Alert tone="error">{topError}</Alert></div>}

      {step === 1 && (
        <section className="panel stack">
          <div className="row between">
            <h2>Your details</h2>
            <label className="row small">
              <span className="muted">Demo applicant</span>
              <select
                className="select"
                style={{ width: 'auto' }}
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  const p = PRESETS.find((x) => x.id === e.target.value);
                  if (p) setForm({ ...EMPTY, ...p.data });
                  setErrors({});
                }}
              >
                <option value="">None</option>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          </div>
          {preset && <Alert tone="info">Upload these files from <span className="mono">data/eval/documents</span>: {PRESETS.find((p) => p.id === preset)?.files}.</Alert>}
          <div className="form-grid">
            {input('full_name', 'Full name (as on your PAN card)', { autoComplete: 'name' }, undefined, 'span2')}
            {input('dob', 'Date of birth', { type: 'date', max: businessDate })}
            <Field label="Gender" error={errors.gender}>
              <select className={`select ${errors.gender ? 'invalid' : ''}`} value={String(form.gender)} onChange={set('gender')}>
                <option value="">Choose</option>
                <option value="F">Female</option>
                <option value="M">Male</option>
                <option value="O">Other</option>
              </select>
            </Field>
            {input('pan_number', 'PAN', { style: { textTransform: 'uppercase' }, maxLength: 10, placeholder: 'ABCPE1234F' }, '10 characters: 5 letters, 4 digits, 1 letter')}
            {input('aadhaar_last4', 'Aadhaar, last 4 digits only', { inputMode: 'numeric', placeholder: '1234' }, 'Never enter your full 12-digit Aadhaar number')}
            {input('mobile', 'Mobile number', { inputMode: 'numeric', maxLength: 10, autoComplete: 'tel' })}
            {input('email', 'Email', { type: 'email', autoComplete: 'email' })}
            <Field label="Address" error={errors.address} className="span2">
              <textarea className={`textarea ${errors.address ? 'invalid' : ''}`} value={String(form.address)} onChange={set('address')} rows={2} />
            </Field>
            {input('city', 'City')}
            {input('state', 'State')}
            {input('pincode', 'Pincode', { inputMode: 'numeric', maxLength: 6 })}
            <Field label="Occupation" error={errors.occupation_code}>
              <select className={`select ${errors.occupation_code ? 'invalid' : ''}`} value={String(form.occupation_code)} onChange={set('occupation_code')}>
                <option value="">Choose</option>
                {occupations.map((o) => <option key={o.occupation_code} value={o.occupation_code}>{o.description}</option>)}
              </select>
            </Field>
            {input('annual_income', 'Annual income (₹)', { inputMode: 'numeric' }, form.annual_income ? fmtInr(String(form.annual_income)) : undefined)}
            <div className="span2">
              <label className="check">
                <input type="checkbox" checked={!!form.kyc_consent} onChange={set('kyc_consent')} />
                <span>
                  I consent to Deccan Digital Bank verifying my identity and address documents and screening my details against
                  sanctions and politically-exposed-person lists for KYC purposes.
                </span>
              </label>
              {errors.kyc_consent && <span className="error small" style={{ color: 'var(--brick)', fontWeight: 600 }}>{errors.kyc_consent}</span>}
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={validateDetails} disabled={busy}>{busy ? 'Checking…' : 'Continue to documents'}</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="panel stack">
          <h2>Documents</h2>
          <FilePicker files={files} setFiles={setFiles} />
          {files.length > 0 && docProblems.length > 0 && <Alert tone="warn">{docProblems.join(' ')}</Alert>}
          <div className="row between">
            <button className="btn secondary" onClick={() => setStep(1)}>Back</button>
            <button className="btn" onClick={() => setStep(3)} disabled={docProblems.length > 0}>Review application</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="panel stack">
          <h2>Review and submit</h2>
          <div className="facts">
            {[
              ['Name', form.full_name], ['Date of birth', form.dob], ['PAN', String(form.pan_number).toUpperCase()],
              ['Aadhaar', `XXXX XXXX ${form.aadhaar_last4}`], ['Mobile', form.mobile], ['Pincode', form.pincode],
              ['Occupation', occupations.find((o) => o.occupation_code === form.occupation_code)?.description], ['Annual income', fmtInr(String(form.annual_income))],
            ].map(([k, v]) => <div key={String(k)}><span>{k}</span><strong>{String(v ?? '—')}</strong></div>)}
          </div>
          <div className="subtle">
            <strong className="small">Documents</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {goodFiles.map((f) => <li key={f.file.name + f.hash} className="small">{f.file.name}: {docLabel(f.type)}</li>)}
            </ul>
          </div>
          <Alert tone="info">After you submit, we read your documents and run our checks. You can follow every step on the next screen.</Alert>
          <div className="row between">
            <button className="btn secondary" onClick={() => setStep(2)} disabled={busy}>Back</button>
            <button className="btn" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button>
          </div>
        </section>
      )}
    </div>
  );
}
