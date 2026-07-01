import { useCallback, useEffect, useState } from 'react';

function relativeTime(iso) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = Math.max(0, now - then);
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function RecentGenerations({ onOpen }) {
  const [state, setState] = useState({ loading: true, generations: [], error: null });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/generations', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setState({ loading: false, generations: data.generations || [], error: null });
    } catch (err) {
      setState({
        loading: false,
        generations: [],
        error: err?.message || 'Failed to load past generations',
      });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (state.loading) return null;
  if (state.error) return null;
  if (state.generations.length === 0) return null;

  return (
    <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-indigo-400">
          Recent generations
        </p>
        <button
          type="button"
          onClick={refresh}
          className="text-[10px] text-slate-500 hover:text-slate-300"
        >
          Refresh
        </button>
      </div>
      <ul className="flex flex-col divide-y divide-slate-800">
        {state.generations.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-200">{g.client_name}</p>
              <p className="truncate text-xs text-slate-500">
                {g.target_mmp || 'MMP'} · {relativeTime(g.created_at)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpen?.(g.id)}
              className="shrink-0 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
            >
              Open
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
