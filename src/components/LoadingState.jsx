import { DOC_TYPES, DOC_LABELS } from '@/lib/formConfig';

const STEPS = [
  { id: 1, label: 'Analyzing tech stack...' },
  { id: 2, label: 'Generating documents...' },
  { id: 3, label: 'Finalizing...' },
];

function SkeletonTab({ label }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-700" />
        <div className="h-4 w-20 animate-pulse rounded bg-slate-800" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-slate-800" />
        <div className="h-4 w-4/6 animate-pulse rounded bg-slate-800" />
        <div className="mt-6 h-6 w-2/5 animate-pulse rounded bg-slate-700" />
        <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
        <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-slate-800" />
      </div>
      <p className="mt-4 text-xs text-slate-500">Loading {label}...</p>
    </div>
  );
}

export default function LoadingState({ progressStep = 1 }) {
  return (
    <div className="mx-auto max-w-4xl">
      {/* Progress steps */}
      <div className="mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {STEPS.map((step) => {
            const isActive = step.id === progressStep;
            const isDone = step.id < progressStep;
            return (
              <div key={step.id} className="flex items-center gap-3">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    isDone
                      ? 'bg-indigo-accent text-white'
                      : isActive
                        ? 'bg-indigo-accent/20 text-indigo-400 ring-2 ring-indigo-accent'
                        : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {isDone ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    step.id
                  )}
                </div>
                <span
                  className={`text-sm ${
                    isActive ? 'font-medium text-white' : isDone ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-indigo-accent transition-all duration-700 ease-out"
            style={{ width: `${(progressStep / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Skeleton tabs */}
      <div className="mb-4 flex gap-2 border-b border-slate-800 pb-px">
        {Object.values(DOC_TYPES).map((type) => (
          <div
            key={type}
            className="h-9 w-36 animate-pulse rounded-t-lg bg-slate-800"
          />
        ))}
      </div>

      <div className="space-y-4">
        <SkeletonTab label={DOC_LABELS[DOC_TYPES.RUNBOOK]} />
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        Claude is generating your tailored onboarding documents. This may take 30–60 seconds.
      </p>
    </div>
  );
}
