import { useEffect, useState } from 'react';

const GUEST_KEY = 'mmp_guest_mode';

/**
 * useSession — reports whether the current SE is signed in, browsing as a
 * guest, or on a deployment where auth isn't configured at all. Kept in a
 * shared hook so the home page and any other component that needs to skip
 * writes (auto-save) or nudge the SE to sign in read the same source of truth.
 */
export function useSession() {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    let guest = false;
    try {
      guest = window.sessionStorage.getItem(GUEST_KEY) === '1';
    } catch {
      // sessionStorage disabled
    }
    (async () => {
      try {
        const res = await fetch('/api/auth/session/status', { credentials: 'include' });
        const data = await res.json();
        if (cancelled) return;
        setState({
          loading: false,
          signedIn: Boolean(data.signedIn),
          authConfigured: Boolean(data.authConfigured),
          guest: guest && !data.signedIn,
          email: data.email || null,
          mmpPlatform: data.mmpPlatform || null,
        });
      } catch {
        if (!cancelled) {
          setState({ loading: false, signedIn: false, authConfigured: false, guest: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
