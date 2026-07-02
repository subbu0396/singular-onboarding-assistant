import { useEffect, useState } from 'react';

export default function UserChip() {
  const [state, setState] = useState({ loading: true });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session/status', { credentials: 'include' });
        const data = await res.json();
        if (!cancelled) setState({ loading: false, ...data });
      } catch {
        if (!cancelled) setState({ loading: false, signedIn: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    await fetch('/api/auth/session/logout', {
      method: 'POST',
      credentials: 'include',
    });
    window.location.href = '/';
  };

  if (state.loading || !state.authConfigured || !state.signedIn) return null;

  const initial = (state.email || '?').slice(0, 1).toUpperCase();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-accent text-[11px] font-semibold text-white">
          {initial}
        </span>
        <span className="hidden max-w-[180px] truncate sm:inline">{state.email}</span>
        <span className="hidden text-slate-500 sm:inline">·</span>
        <span className="hidden text-slate-400 sm:inline">{state.mmpPlatform || '—'}</span>
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-slate-800 bg-slate-950 p-2 text-sm shadow-xl">
          <div className="px-2 py-1.5 text-[11px] text-slate-500">
            Signed in as
          </div>
          <div className="truncate px-2 pb-1 text-xs text-slate-200">{state.email}</div>
          <div className="px-2 pb-2 text-[11px] text-slate-400">
            {state.mmpPlatform || 'MMP unknown'}
          </div>
          <button
            type="button"
            onClick={signOut}
            className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
