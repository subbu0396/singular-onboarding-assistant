import { useEffect, useRef, useState } from 'react';

const GREETING = {
  role: 'assistant',
  content:
    "Tell me about the client — who they are, which MMP they're moving to, and roughly when they want to go live. I'll ask a few follow-ups and then hand you a pre-filled form to review.",
};

/**
 * Conversational intake — SE describes the client, Claude asks the minimum
 * clarifying questions, then emits a filled INITIAL_FORM_STATE-shaped object.
 * On completion the parent gets the form and switches to review mode.
 */
export default function IntakeChat({ onComplete, onCancel }) {
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const nextHistory = [...messages, { role: 'user', content: text }];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/intake/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The greeting is a UI-only bubble — the server prompt already
          // frames the assistant's role, so we don't ship it as history.
          messages: nextHistory.filter((m) => m !== GREETING),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Chat failed (${res.status})`);
        return;
      }

      if (data.type === 'intake_ready') {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.assistantText },
        ]);
        onComplete?.(data.form, {
          missingFields: data.missingFields || [],
          confidenceNotes: data.confidenceNotes,
          source: data.source,
        });
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.assistantText },
      ]);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-indigo-400">
            Conversational Intake
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            Describe the client
          </h2>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          ← Back to form
        </button>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50">
        <div
          ref={scrollRef}
          className="max-h-[55vh] min-h-[280px] space-y-3 overflow-y-auto px-5 py-4"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-indigo-accent text-white'
                    : 'bg-slate-800 text-slate-200'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-slate-800 px-3.5 py-2 text-sm text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                  Thinking…
                </span>
              </div>
            </div>
          )}
          {error && (
            <div className="flex justify-start">
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-sm text-red-300">
                ⚠ {error}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 px-4 py-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Rovio, iOS + Android, moving from AppsFlyer to Singular, target go-live August 15."
              className="form-input min-h-[52px] flex-1 resize-y text-sm"
              disabled={loading}
            />
            <button
              type="button"
              onClick={send}
              disabled={!input.trim() || loading}
              className="btn-primary self-end text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Enter to send, Shift+Enter for newline. The chat ends when I have enough to pre-fill the form.
          </p>
        </div>
      </div>
    </div>
  );
}
