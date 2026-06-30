import { useCallback, useEffect, useState } from 'react';

export default function GoogleCalendarConnect() {
  const [status, setStatus] = useState({ loading: true, connected: false });
  const [authError, setAuthError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/google/status', {
        credentials: 'same-origin',
      });
      const data = await res.json();
      setStatus({ loading: false, ...data });
    } catch {
      setStatus({ loading: false, connected: false });
    }
  }, []);

  useEffect(() => {
    refresh();
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('google_error')) setAuthError(params.get('google_error'));
    if (params.has('google_connected') || params.has('google_error')) {
      params.delete('google_connected');
      params.delete('google_error');
      const next = window.location.pathname + (params.toString() ? `?${params}` : '');
      window.history.replaceState(null, '', next);
    }
  }, [refresh]);

  const handleConnect = () => {
    window.location.href = '/api/auth/google/login';
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/auth/google/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {
      // ignore — refresh will re-read status
    }
    refresh();
  };

  if (status.loading) {
    return <div className="text-xs text-slate-500">Checking Google…</div>;
  }

  if (status.connected) {
    // Trim noisy gmail addresses to just the local part so the badge stays
    // narrow enough not to crowd the header on common viewport widths.
    const raw = status.identity?.email || status.identity?.name || 'Google Calendar';
    const label = typeof raw === 'string' && raw.includes('@') ? raw.split('@')[0] : raw;
    return (
      <div className="flex items-center gap-2 text-xs">
        <span
          title={raw}
          className="inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded-full border border-amber-700 bg-amber-500/10 px-2.5 py-1 text-amber-300"
        >
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          <span className="truncate">Google: {label}</span>
        </span>
        <button
          type="button"
          onClick={handleDisconnect}
          className="rounded px-2 py-1 text-slate-500 hover:text-slate-300"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleConnect}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-amber-500 hover:text-amber-300"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-500" />
        Connect Google Calendar
      </button>
      {authError && (
        <span className="text-[10px] text-red-400">
          {authError === 'state_mismatch'
            ? 'OAuth state mismatch — try again.'
            : authError === 'oauth_not_configured'
              ? 'Google OAuth env vars missing on the server.'
              : `Auth error: ${authError}`}
        </span>
      )}
    </div>
  );
}
