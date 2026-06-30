import { useCallback, useEffect, useState } from 'react';

const ERROR_MESSAGES = {
  state_mismatch: 'OAuth state mismatch — try connecting again.',
  oauth_not_configured:
    'Atlassian OAuth env vars missing on the server (CLIENT_ID / CLIENT_SECRET).',
  token_exchange_failed:
    'Token exchange failed — add this callback URL to your Atlassian app: /api/auth/atlassian/callback',
  missing_code_or_state: 'OAuth callback missing code or state — try again.',
  session_not_saved:
    'OAuth succeeded but the session cookie was not saved — try disconnecting and connecting again after the latest deploy.',
  session_cookie_too_large:
    'Atlassian tokens are too large for a single browser cookie — contact support if this persists after reconnecting.',
};

export default function AtlassianConnect() {
  const [status, setStatus] = useState({ loading: true, connected: false });
  const [authError, setAuthError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/atlassian/status', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const data = await res.json();
      setStatus({ loading: false, ...data });
      return data;
    } catch {
      setStatus({ loading: false, connected: false });
      return { connected: false };
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const justConnected = params.has('atl_connected');
    const errorCode = params.get('atl_error');

    if (errorCode) setAuthError(errorCode);

    if (params.has('atl_connected') || params.has('atl_error')) {
      params.delete('atl_connected');
      params.delete('atl_error');
      const next = window.location.pathname + (params.toString() ? `?${params}` : '');
      window.history.replaceState(null, '', next);
    }

    const load = async () => {
      let data = await refresh();
      if (justConnected && !data?.connected) {
        for (let attempt = 0; attempt < 3 && !data?.connected; attempt++) {
          await new Promise((r) => setTimeout(r, 400));
          data = await refresh();
        }
        if (!data?.connected) {
          setAuthError((prev) => prev || 'session_not_saved');
        }
      }
    };

    load();
  }, [refresh]);

  const handleConnect = () => {
    setAuthError(null);
    window.location.href = '/api/auth/atlassian/login';
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/auth/atlassian/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {
      // ignore — refresh will re-read status
    }
    refresh();
  };

  if (status.loading) {
    return <div className="text-xs text-slate-500">Checking Atlassian…</div>;
  }

  if (status.connected) {
    const identityName =
      status.identity?.name ||
      status.identity?.email ||
      status.siteUrl ||
      'Atlassian';
    return (
      <div className="flex items-center gap-2 text-xs">
        <span
          title={identityName}
          className="inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded-full border border-sky-700 bg-sky-500/10 px-2.5 py-1 text-sky-300"
        >
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
          <span className="truncate">Atlassian: {identityName}</span>
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
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-300"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-500" />
        Connect Atlassian
      </button>
      {authError && (
        <span className="max-w-xs text-right text-[10px] text-red-400">
          {ERROR_MESSAGES[authError] || `Auth error: ${authError}`}
        </span>
      )}
    </div>
  );
}
