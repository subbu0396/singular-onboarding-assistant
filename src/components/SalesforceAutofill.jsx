import { useState } from 'react';

/**
 * "Autofill from Salesforce" — pulls the SF Account for `clientName`, feeds
 * it to Claude with the capture_client_intake tool, and hands the resulting
 * form object back to the parent to merge onto the form state.
 *
 * The SE still reviews and can edit anything before generating. `missingFields`
 * is surfaced so they know what the model couldn't populate.
 */
export default function SalesforceAutofill({ clientName, onAutofill, disabled }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const trimmed = (clientName || '').trim();
  const canRun = trimmed.length >= 3 && !loading && !disabled;

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/intake/salesforce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: trimmed }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.reason || data.error || `Autofill failed (${res.status})`);
        return;
      }
      setResult({
        missingFields: data.missingFields || [],
        confidenceNotes: data.confidenceNotes || null,
        source: data.source,
      });
      onAutofill?.(data.form, {
        missingFields: data.missingFields || [],
        source: data.source,
      });
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40"
          title={
            trimmed.length < 3
              ? 'Enter a client name (3+ chars) to enable autofill'
              : 'Pull details from Salesforce and populate the form'
          }
        >
          {loading ? 'Autofilling…' : 'Autofill from Salesforce'}
        </button>
        <p className="text-[11px] text-slate-500">
          Uses the client name above. You can edit any field after autofill.
        </p>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-400">⚠ {error}</p>
      )}

      {result && !error && (
        <div className="mt-2 space-y-1 text-xs">
          <p className="text-emerald-400">
            ✓ Autofilled from {result.source === 'salesforce_real' ? 'Salesforce' : 'Salesforce (demo)'}
          </p>
          {result.confidenceNotes && (
            <p className="text-slate-400 italic">“{result.confidenceNotes}”</p>
          )}
          {result.missingFields.length > 0 && (
            <p className="text-amber-300">
              Please review — could not populate: {result.missingFields.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
