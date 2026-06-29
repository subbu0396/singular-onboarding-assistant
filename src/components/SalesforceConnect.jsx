import { useCallback, useEffect, useState } from 'react';

export default function SalesforceConnect() {
  const [status, setStatus] = useState({ loading: true, connected: false });
  const [authError, setAuthError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/salesforce/status', {
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

    // Pick up sf_connected / sf_error query params after an OAuth round-trip.
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('sf_error')) {
      setAuthError(params.get('sf_error'));
    }
    if (params.has('sf_connected') || params.has('sf_error')) {
      params.delete('sf_connected');
      params.delete('sf_error');
      const next = window.location.pathname + (params.toString() ? `?${params}` : '');
      window.history.replaceState(null, '', next);
    }
  }, [refresh]);

  const handleConnect = () => {
    window.location.href = '/api/auth/salesforce/login';
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/auth/salesforce/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {
      // ignore — refresh will re-read status
    }
    refresh();
  };

  if (status.loading) {
    return (
      <div className="text-xs text-slate-500">Checking Salesforce…</div>
    );
  }

  if (status.connected) {
    const identityName = status.identity?.name || status.identity?.email || 'Salesforce';
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Salesforce: {identityName}
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
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-500" />
        Connect Salesforce
      </button>
      {authError && (
        <span className="text-[10px] text-red-400">
          {authError === 'state_mismatch'
            ? 'OAuth state mismatch — try again.'
            : authError === 'oauth_not_configured'
              ? 'Salesforce OAuth env vars missing on the server.'
              : `Auth error: ${authError}`}
        </span>
      )}
    </div>
  );
}
