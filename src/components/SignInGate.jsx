import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';

const AUTH_ERROR_COPY = {
  domain_not_allowed:
    'Your email domain isn\'t on the SE allowlist. Only teammates at supported MMP / martech platforms can sign in.',
  missing_code: 'Sign-in didn\'t return a valid code. Please try again.',
  exchange_failed: 'We couldn\'t complete your sign-in. Please try again.',
  profile_failed: 'Signed in, but we couldn\'t create your profile. Please try again or contact admin.',
  not_configured:
    'Supabase Auth isn\'t configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
};

/**
 * SignInGate — blocks the app behind Google sign-in. Fetches /api/auth/session/status
 * once on mount; when unauthenticated, renders the sign-in screen. When
 * authenticated, renders children.
 *
 * Public share pages (/share/[token]) don't mount this component, so
 * recipients still see the shared docs without needing an account.
 */
export default function SignInGate({ children }) {
  const [status, setStatus] = useState({ loading: true });
  const [signInError, setSignInError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session/status', { credentials: 'include' });
        const data = await res.json();
        if (!cancelled) setStatus({ loading: false, ...data });
      } catch (err) {
        if (!cancelled) setStatus({ loading: false, signedIn: false, error: String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Surface ?auth_error=... left by the OAuth callback in the URL.
    const params = new URLSearchParams(window.location.search);
    const err = params.get('auth_error');
    if (!err) return;
    const domain = params.get('domain');
    const copy = AUTH_ERROR_COPY[err] || `Sign-in error: ${err}`;
    setSignInError(domain ? `${copy} (domain: ${domain})` : copy);
    // Strip the params so a refresh doesn't re-show the same banner.
    params.delete('auth_error');
    params.delete('domain');
    const clean = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${clean ? `?${clean}` : ''}`);
  }, []);

  const signIn = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setSignInError(AUTH_ERROR_COPY.not_configured);
      return;
    }
    // Bare callback URL — Supabase's Redirect URL matcher is fussy about
    // query strings. The callback route defaults `next` to `/`, so we don't
    // lose anything by dropping the param here.
    const redirectTo = `${window.location.origin}/api/auth/session/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        // Force Google to always show account picker so an SE switching
        // MMPs (career move!) can re-pick without clearing browser data.
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) setSignInError(error.message);
  };

  if (status.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (!status.authConfigured) {
    // Auth isn't wired on this deployment — fall through so the app still
    // renders in dev environments that don't have Supabase Auth env vars.
    return children;
  }

  if (status.signedIn) return children;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-accent">
          <span className="text-lg font-bold text-white">M</span>
        </div>
        <h1 className="text-xl font-semibold text-white">MMP Onboarding Assistant</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sign in with your work Google account to continue.
        </p>
        <button
          type="button"
          onClick={signIn}
          className="btn-primary mt-6 w-full"
        >
          Sign in with Google
        </button>
        <p className="mt-4 text-[11px] text-slate-500">
          Access is limited to SEs at approved MMP, engagement, analytics, and CDP platforms.
        </p>
        {signInError && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-left text-xs text-red-300">
            ⚠ {signInError}
          </div>
        )}
      </div>
    </div>
  );
}
