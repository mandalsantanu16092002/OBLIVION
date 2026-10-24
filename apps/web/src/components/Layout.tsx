import { useEffect, useState, type ReactNode } from 'react';
import { FiActivity, FiBarChart2, FiCheckSquare, FiInbox, FiLogOut, FiPlusCircle, FiSearch, FiSettings, FiShield, FiFolder } from 'react-icons/fi';
import { ROLE_LABELS, type Role } from '@onboardiq/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Link, useRouter } from '../lib/router';

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
      <path d="M8 17l5.5 5.5L24 10" stroke="#D98A1C" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OfficerLayout({ children, title, actions }: { children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  const { user, role, logout, switchRole } = useAuth();
  const { navigate } = useRouter();
  const [counts, setCounts] = useState<{ review?: number; checker?: number }>({});

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const out: { review?: number; checker?: number } = {};
      if (user?.roles.includes('KYC_OFFICER')) out.review = (await api('/review/queue').catch(() => ({ items: [] }))).items.length;
      if (user?.roles.includes('COMPLIANCE_OFFICER')) out.checker = (await api('/checker/queue').catch(() => ({ items: [] }))).items.length;
      if (alive) setCounts(out);
    };
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [user, role]);

  const isKyc = role === 'KYC_OFFICER';
  const isComp = role === 'COMPLIANCE_OFFICER';

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <div className="brand-mark"><Mark /></div>
          <div>
            <div className="brand-name">OnboardIQ</div>
            <div className="brand-sub">KYC operations, Deccan Digital Bank</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {isKyc && (
            <>
              <div className="nav-group">Maker</div>
              <Link to="/queue"><FiInbox /> Review queue {counts.review ? <span className="count">{counts.review}</span> : null}</Link>
            </>
          )}
          {isComp && (
            <>
              <div className="nav-group">Checker</div>
              <Link to="/checker"><FiCheckSquare /> Checker queue {counts.checker ? <span className="count">{counts.checker}</span> : null}</Link>
              <Link to="/dashboard"><FiBarChart2 /> Dashboard</Link>
              <Link to="/audit"><FiActivity /> Audit trail</Link>
              <Link to="/settings"><FiSettings /> Rules &amp; watchlists</Link>
            </>
          )}
          <div className="nav-group">Cases</div>
          <Link to="/applications"><FiSearch /> All applications</Link>
        </nav>
        <div className="rail-foot">
          <strong>{user?.full_name}</strong>
          {user?.email}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="row" style={{ minWidth: 0 }}>{title}</div>
          <div className="row">
            {actions}
            {user && user.roles.length > 1 && (
              <label className="row small" title="This account holds two roles; maker and checker on the same case are still blocked">
                <FiShield />
                <select
                  className="select"
                  style={{ width: 'auto', padding: '6px 8px' }}
                  value={role ?? ''}
                  onChange={(e) => {
                    switchRole(e.target.value as Role);
                    navigate(e.target.value === 'KYC_OFFICER' ? '/queue' : '/checker');
                  }}
                  aria-label="Acting role"
                >
                  {user.roles.map((r) => (
                    <option key={r} value={r}>Acting as {ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </label>
            )}
            {user && user.roles.length === 1 && <span className="badge ink">{ROLE_LABELS[user.roles[0]]}</span>}
            <button className="btn secondary small" onClick={() => { logout(); navigate('/login'); }}>
              <FiLogOut /> Log out
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

export function ApplicantLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { navigate } = useRouter();
  return (
    <div>
      <header className="public-top">
        <div className="inner">
          <div className="brand" style={{ padding: 0 }}>
            <div className="brand-mark"><Mark /></div>
            <div>
              <div className="brand-name">Deccan Digital Bank</div>
              <div className="brand-sub">Open a savings account</div>
            </div>
          </div>
          <nav className="row" aria-label="Applicant">
            <Link to="/my"><FiFolder style={{ verticalAlign: -2 }} /> My applications</Link>
            <Link to="/apply"><FiPlusCircle style={{ verticalAlign: -2 }} /> New application</Link>
            <span className="small" style={{ color: '#b8bed8', marginLeft: 18 }}>{user?.full_name}</span>
            <button className="btn small secondary" style={{ marginLeft: 12 }} onClick={() => { logout(); navigate('/login'); }}>
              Log out
            </button>
          </nav>
        </div>
      </header>
      <main className="content narrow">{children}</main>
      <p className="specimen-note">All people, documents and organisations are synthetic. Only the last 4 digits of Aadhaar are ever collected.</p>
    </div>
  );
}
