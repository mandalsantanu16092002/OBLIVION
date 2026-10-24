import { useState } from 'react';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { loginSchema, registerSchema } from '@onboardiq/shared';
import { Alert, Field } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth, type User } from '../lib/auth';
import { firstIssues } from '../lib/format';
import { Link, useRouter } from '../lib/router';

const DEMO = [
  { email: 'applicant@onboardiq.local', password: 'Applicant@123', who: 'Applicant', note: 'Apply and track' },
  { email: 'kyc@onboardiq.local', password: 'Officer@123', who: 'KYC Officer', note: 'Maker: review queue' },
  { email: 'compliance@onboardiq.local', password: 'Officer@123', who: 'Compliance Officer', note: 'Checker, dashboard' },
];

export function homeFor(u: User) {
  if (u.roles[0] === 'APPLICANT') return '/my';
  if (u.roles[0] === 'KYC_OFFICER') return '/queue';
  return '/dashboard';
}

export function LoginPage({ mode }: { mode: 'login' | 'register' }) {
  const { login, register } = useAuth();
  const { navigate } = useRouter();
  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const submit = async (e?: React.FormEvent, override?: { email: string; password: string }) => {
    e?.preventDefault();
    setMsg('');
    const data = override ?? form;
    const schema = mode === 'login' || override ? loginSchema : registerSchema;
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      setErrors(firstIssues(parsed.error.issues));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const u = mode === 'login' || override ? await login(data.email, data.password) : await register(form.full_name, form.email, form.password);
      navigate(homeFor(u), { replace: true });
    } catch (err) {
      const ae = err as ApiError;
      setErrors(ae.fields ?? {});
      setMsg(ae.status === 401 ? 'Email or password is incorrect. Passwords are case-sensitive - check Caps Lock, or use "Show" to see what you typed.' : ae.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth-wrap">
      <section className="auth-art">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">
            <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden><path d="M8 17l5.5 5.5L24 10" stroke="#D98A1C" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <div className="brand-name">OnboardIQ</div>
            <div className="brand-sub">Deccan Digital Bank (fictional)</div>
          </div>
        </div>
        <div>
          <h1>Open your savings account in minutes, securely verified and fairly reviewed.</h1>
          <p>
            Upload your PAN card, Aadhaar card and an address proof. We read them, check them against your details and our
            screening lists, and tell you plainly what happens next.
          </p>
        </div>
        <Steps />
      </section>
      <section className="auth-form">
        <div className="auth-card stack">
          <div>
            <h2>{mode === 'login' ? 'Log in' : 'Create your account'}</h2>
            <p className="muted small" style={{ marginTop: 4 }}>
              {mode === 'login' ? (
                <>New applicant? <Link to="/register">Create an account</Link></>
              ) : (
                <>Already registered? <Link to="/login">Log in</Link></>
              )}
            </p>
          </div>
          {msg && <Alert tone="error">{msg}</Alert>}
          <form className="stack" onSubmit={submit} noValidate>
            {mode === 'register' && (
              <Field label="Full name" error={errors.full_name}>
                <input className={`input ${errors.full_name ? 'invalid' : ''}`} value={form.full_name} onChange={set('full_name')} autoComplete="name" />
              </Field>
            )}
            <Field label="Email" error={errors.email}>
              <input className={`input ${errors.email ? 'invalid' : ''}`} type="email" value={form.email} onChange={set('email')} autoComplete="email" />
            </Field>
            <Field
              label="Password"
              error={errors.password}
              hint={capsLock ? 'Caps Lock is on' : mode === 'register' ? 'At least 8 characters with a letter and a digit. Passwords are case-sensitive.' : undefined}
            >
              <div style={{ position: 'relative' }}>
                <input
                  className={`input ${errors.password ? 'invalid' : ''}`}
                  style={{ paddingRight: 76 }}
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={set('password')}
                  onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                  onBlur={() => setCapsLock(false)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, background: 'transparent', color: 'var(--teal)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', padding: '6px 8px' }}
                >
                  {showPassword ? <FiEyeOff aria-hidden /> : <FiEye aria-hidden />}
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
            <button className="btn block" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
          </form>
          {mode === 'login' && (
            <div className="stack tight">
              <span className="small muted">Demo accounts (seeded)</span>
              <div className="demo-users">
                {DEMO.map((d) => (
                  <button key={d.email} className="demo-user" type="button" onClick={() => submit(undefined, d)} disabled={busy}>
                    <strong>{d.who}</strong>
                    <span>{d.note}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Steps() {
  const items = ['Fill in your details', 'Upload three documents', 'Track your decision'];
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
      {items.map((t, i) => (
        <li key={t} className="row" style={{ gap: 8, color: '#dfe3f3', fontWeight: 600, fontSize: '0.9rem' }}>
          <span style={{ width: 26, height: 26, borderRadius: 99, border: '2px solid #D98A1C', display: 'grid', placeItems: 'center', fontSize: '0.8rem' }}>{i + 1}</span>
          {t}
        </li>
      ))}
    </ol>
  );
}
