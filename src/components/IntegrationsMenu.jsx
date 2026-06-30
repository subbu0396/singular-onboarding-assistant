import { useCallback, useEffect, useRef, useState } from 'react';
import SalesforceConnect from './SalesforceConnect';
import AtlassianConnect from './AtlassianConnect';
import GoogleCalendarConnect from './GoogleCalendarConnect';
import GitHubConnect from './GitHubConnect';

// Lightweight aggregator for the four per-provider Connect components.
// Each individual component still polls its own /status endpoint and renders
// its own pill — we just stack them inside a popover so the header doesn't
// turn into a wall of pills. The trigger pulls all four statuses
// independently so we can show a "3 of 4 connected" hint without coupling
// to the inner components.

const PROVIDERS = [
  { id: 'sf', label: 'Salesforce', url: '/api/auth/salesforce/status', dot: 'bg-emerald-400' },
  { id: 'atl', label: 'Atlassian', url: '/api/auth/atlassian/status', dot: 'bg-sky-400' },
  { id: 'google', label: 'Google', url: '/api/auth/google/status', dot: 'bg-amber-400' },
  { id: 'github', label: 'GitHub', url: '/api/auth/github/status', dot: 'bg-fuchsia-400' },
];

function useProviderStatuses() {
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p.id, false]))
  );

  const refresh = useCallback(async () => {
    const results = await Promise.all(
      PROVIDERS.map(async (p) => {
        try {
          const res = await fetch(p.url, { credentials: 'same-origin' });
          const data = await res.json();
          return [p.id, Boolean(data?.connected)];
        } catch {
          return [p.id, false];
        }
      })
    );
    setStatuses(Object.fromEntries(results));
  }, []);

  useEffect(() => {
    refresh();
    // Repoll when the window regains focus — covers the case where the SE
    // completed an OAuth round-trip in a new tab and came back.
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  return statuses;
}

export default function IntegrationsMenu() {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef(null);
  const triggerRef = useRef(null);
  const statuses = useProviderStatuses();

  const connectedCount = Object.values(statuses).filter(Boolean).length;
  const total = PROVIDERS.length;

  // Close on outside click and on Esc.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (popoverRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
          open
            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-200'
            : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-indigo-500 hover:text-indigo-300'
        }`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="flex items-center gap-1">
          {PROVIDERS.map((p) => (
            <span
              key={p.id}
              title={`${p.label}: ${statuses[p.id] ? 'connected' : 'not connected'}`}
              className={`inline-block h-1.5 w-1.5 rounded-full transition-opacity ${
                statuses[p.id] ? p.dot : 'bg-slate-700'
              }`}
            />
          ))}
        </span>
        <span>
          Integrations
          <span className="ml-1 text-slate-500">
            {connectedCount}/{total}
          </span>
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            d="M2 4l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 z-20 mt-2 w-[20rem] rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-sm"
          role="menu"
        >
          <p className="mb-2 px-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Connected systems
          </p>
          <div className="flex flex-col gap-2">
            <div className="rounded-lg border border-slate-800 px-2 py-2">
              <SalesforceConnect />
            </div>
            <div className="rounded-lg border border-slate-800 px-2 py-2">
              <AtlassianConnect />
            </div>
            <div className="rounded-lg border border-slate-800 px-2 py-2">
              <GoogleCalendarConnect />
            </div>
            <div className="rounded-lg border border-slate-800 px-2 py-2">
              <GitHubConnect />
            </div>
          </div>
          <p className="mt-3 px-1 text-[10px] leading-relaxed text-slate-500">
            Each connection grounds a specific analyst skill — disconnecting falls back to the static-prompt path. Onboarding always completes regardless.
          </p>
        </div>
      )}
    </div>
  );
}
