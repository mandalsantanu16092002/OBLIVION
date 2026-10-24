import { StrictMode, useEffect, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Role } from '@onboardiq/shared';
import { ApplicantLayout, OfficerLayout } from './components/Layout';
import { Spinner, ToastProvider } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { match, RouterProvider, useRouter } from './lib/router';
import { ApplyPage } from './pages/Apply';
import { ApplicationAuditPage, AuditPage } from './pages/Audit';
import { CaseWorkbenchPage } from './pages/CaseWorkbench';
import { DashboardPage } from './pages/Dashboard';
import { homeFor, LoginPage } from './pages/Login';
import { MyApplicationDetailPage, MyApplicationsPage } from './pages/MyApplications';
import { ApplicationsPage, CheckerQueuePage, ReviewQueuePage } from './pages/Queues';
import { SettingsPage } from './pages/Settings';
import './styles.css';

type Route = { path: string; roles: Role[]; render: (p: Record<string, string>) => ReactElement; layout: 'applicant' | 'officer' };

const OFFICERS: Role[] = ['KYC_OFFICER', 'COMPLIANCE_OFFICER'];
const ROUTES: Route[] = [
  { path: '/my', roles: ['APPLICANT'], layout: 'applicant', render: () => <MyApplicationsPage /> },
  { path: '/my/:id', roles: ['APPLICANT'], layout: 'applicant', render: (p) => <MyApplicationDetailPage id={p.id} /> },
  { path: '/apply', roles: ['APPLICANT'], layout: 'applicant', render: () => <ApplyPage /> },
  { path: '/queue', roles: ['KYC_OFFICER'], layout: 'officer', render: () => <ReviewQueuePage /> },
  { path: '/checker', roles: ['COMPLIANCE_OFFICER'], layout: 'officer', render: () => <CheckerQueuePage /> },
  { path: '/cases/:id', roles: OFFICERS, layout: 'officer', render: (p) => <CaseWorkbenchPage id={p.id} /> },
  { path: '/applications', roles: OFFICERS, layout: 'officer', render: () => <ApplicationsPage /> },
  { path: '/dashboard', roles: ['COMPLIANCE_OFFICER'], layout: 'officer', render: () => <DashboardPage /> },
  { path: '/audit', roles: ['COMPLIANCE_OFFICER'], layout: 'officer', render: () => <AuditPage /> },
  { path: '/audit/:id', roles: ['COMPLIANCE_OFFICER'], layout: 'officer', render: (p) => <ApplicationAuditPage id={p.id} /> },
  { path: '/settings', roles: ['COMPLIANCE_OFFICER'], layout: 'officer', render: () => <SettingsPage /> },
];

function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter();
  useEffect(() => navigate(to, { replace: true }), [to, navigate]);
  return null;
}

function App() {
  const { user, role, ready } = useAuth();
  const { path } = useRouter();
  if (!ready) return <div style={{ padding: 40 }}><Spinner label="Starting OnboardIQ" /></div>;
  if (!user) {
    if (path === '/register') return <LoginPage mode="register" />;
    if (path !== '/login') return <Redirect to="/login" />;
    return <LoginPage mode="login" />;
  }
  if (path === '/' || path === '/login' || path === '/register') return <Redirect to={homeFor({ ...user, roles: [role ?? user.roles[0], ...user.roles] })} />;
  for (const r of ROUTES) {
    const params = match(r.path, path);
    if (!params) continue;
    // the acting role must be allowed (server enforces roles again on every API call)
    if (!role || !r.roles.includes(role)) {
      const alt = user.roles.find((x) => r.roles.includes(x));
      if (!alt) return <Redirect to={homeFor(user)} />;
    }
    const page = r.render(params);
    return r.layout === 'applicant' ? <ApplicantLayout>{page}</ApplicantLayout> : <OfficerLayout>{page}</OfficerLayout>;
  }
  return <Redirect to={homeFor(user)} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </RouterProvider>
  </StrictMode>,
);
