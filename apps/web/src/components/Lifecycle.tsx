import { FiCheck, FiCpu, FiFileText, FiLock, FiRefreshCw, FiUserCheck, FiX } from 'react-icons/fi';
import { fmtDateTime } from '../lib/format';

/**
 * The application lifecycle rail, mirroring the end-to-end workflow:
 * Submitted -> Checking documents -> (Officer review) -> (Checker) -> Final outcome.
 * Stops that a path skips (e.g. straight-through approval) are drawn dashed.
 */
interface Props {
  status: string;
  timeline: { status: string; at: string }[];
}

const FINAL_TONE: Record<string, string> = {
  AUTO_APPROVED: 'var(--leaf)',
  APPROVED: 'var(--leaf)',
  AUTO_REJECTED: 'var(--brick)',
  REJECTED: 'var(--brick)',
  CLOSED_EXPIRED: 'var(--brick)',
};

export function Lifecycle({ status, timeline }: Props) {
  const seen = new Set(timeline.map((t) => t.status));
  const at = (s: string) => [...timeline].reverse().find((t) => t.status === s)?.at;
  const final = FINAL_TONE[status] ? status : null;
  const viaReview = seen.has('IN_REVIEW') || status === 'RESUBMISSION_REQUESTED';
  const viaChecker = seen.has('PENDING_CHECKER');

  const stops = [
    { key: 'SUBMITTED', label: 'Submitted', icon: FiFileText, done: true, time: at('SUBMITTED') },
    { key: 'EXTRACTING', label: 'Documents checked', icon: FiCpu, done: seen.has('EXTRACTING') && status !== 'EXTRACTING' && status !== 'SUBMITTED', time: at('EXTRACTING') },
    {
      key: 'IN_REVIEW',
      label: status === 'RESUBMISSION_REQUESTED' ? 'Waiting for new documents' : 'Officer review',
      icon: status === 'RESUBMISSION_REQUESTED' ? FiRefreshCw : FiUserCheck,
      done: viaReview && !['IN_REVIEW', 'RESUBMISSION_REQUESTED'].includes(status),
      skipped: !viaReview && !!final,
      time: at('IN_REVIEW'),
    },
    { key: 'PENDING_CHECKER', label: 'Second approval', icon: FiLock, done: viaChecker && status !== 'PENDING_CHECKER', skipped: !viaChecker && !!final, time: at('PENDING_CHECKER') },
    {
      key: 'FINAL',
      label: final ? (final.includes('APPROVED') ? 'Approved, account opened' : final === 'CLOSED_EXPIRED' ? 'Closed (expired)' : 'Rejected') : 'Outcome',
      icon: final && !final.includes('APPROVED') ? FiX : FiCheck,
      done: false,
      time: final ? at(final) : undefined,
    },
  ];
  const currentKey =
    final ? 'FINAL' : status === 'RESUBMISSION_REQUESTED' ? 'IN_REVIEW' : status === 'SUBMITTED' ? 'EXTRACTING' : status;
  const tone = final ? FINAL_TONE[final] : status === 'PENDING_CHECKER' ? 'var(--violet)' : status === 'EXTRACTING' || status === 'SUBMITTED' ? 'var(--teal)' : 'var(--saffron)';

  return (
    <div className="lifecycle" style={{ ['--n' as string]: stops.length }} aria-label={`Application status: ${status}`}>
      {stops.map((s) => {
        const current = s.key === currentKey;
        const cls = ['lc-stop', current ? 'current' : s.done ? 'done' : '', s.skipped ? 'skipped' : ''].join(' ');
        const Icon = s.icon;
        return (
          <div key={s.key} className={cls} style={current ? { ['--tone' as string]: tone } : undefined} aria-current={current ? 'step' : undefined}>
            <div className="lc-node">{s.done && !current ? <FiCheck /> : <Icon />}</div>
            <div className="lc-label">{s.skipped ? <span title="Not needed on this path">{s.label} (not needed)</span> : s.label}</div>
            <div className="lc-time">{s.time ? fmtDateTime(s.time) : ''}</div>
          </div>
        );
      })}
    </div>
  );
}
