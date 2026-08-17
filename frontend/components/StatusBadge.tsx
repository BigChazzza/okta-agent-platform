import clsx from 'clsx';

const colours: Record<string, string> = {
  active:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  pending:  'bg-amber-500/15 text-amber-400 border-amber-500/25',
  inactive: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
  error:    'bg-red-500/15 text-red-400 border-red-500/25',
  ACTIVE:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  INACTIVE: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border', colours[status] || colours.pending)}>
      {status}
    </span>
  );
}
