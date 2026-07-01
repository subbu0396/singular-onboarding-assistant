import { useEffect, useState } from 'react';

function formatExpiry(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return 'expired';
  const hr = Math.round(ms / (60 * 60 * 1000));
  if (hr <= 1) return 'expires in <1h';
  if (hr < 48) return `expires in ${hr}h`;
  return `expires in ${Math.round(hr / 24)}d`;
}

export default function ShareButton({ savedGeneration }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  if (!savedGeneration?.share_token) return null;

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/share/${savedGeneration.share_token}`
      : `/share/${savedGeneration.share_token}`;
  const expiryLabel = formatExpiry(savedGeneration.share_expires_at);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      // clipboard blocked — the user can select the link text below manually
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1.5 rounded-full border border-indigo-700 bg-indigo-500/10 px-3 py-1.5 text-indigo-200 hover:border-indigo-500 hover:text-indigo-100"
      >
        {copied ? 'Copied share link ✓' : 'Copy share link'}
      </button>
      <span className="text-[10px] text-slate-500">
        Public read-only URL · {expiryLabel || 'expiry unknown'}
      </span>
    </div>
  );
}
