const SKILLS = [
  { id: 'client_info', name: 'Client Info' },
  { id: 'sdk_setup', name: 'Mobile SDK Setup' },
  { id: 'integration_type', name: 'Integration Type' },
  { id: 'tech_env', name: 'Technical Environment' },
  { id: 'timeline', name: 'Go-Live Timeline' },
  { id: 'review_compile', name: 'Review & Compile' },
];

const STATE_STYLES = {
  pending: 'border-slate-700 bg-slate-900/40 text-slate-500',
  active: 'border-indigo-500 bg-indigo-500/10 text-indigo-300',
  complete: 'border-emerald-700 bg-emerald-500/10 text-emerald-300',
  error: 'border-red-700 bg-red-500/10 text-red-300',
};

function StateIndicator({ state, index }) {
  if (state === 'complete') return <span>✓</span>;
  if (state === 'error') return <span>✕</span>;
  if (state === 'active') {
    return (
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
    );
  }
  return <span className="text-[10px] text-slate-600">{index + 1}</span>;
}

export default function SkillProgress({ skillStatus = {}, visible = true }) {
  if (!visible) return null;
  return (
    <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-indigo-400">
          Agent Orchestration
        </p>
        <p className="text-[11px] text-slate-500">6 skills</p>
      </div>
      <ol className="flex flex-wrap gap-2">
        {SKILLS.map((skill, idx) => {
          const state = skillStatus[skill.id] || 'pending';
          return (
            <li
              key={skill.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${STATE_STYLES[state]}`}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                <StateIndicator state={state} index={idx} />
              </span>
              <span>{skill.name}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
