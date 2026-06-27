import { useState, useRef } from 'react';
import { readUploadedFile } from '@/lib/readUploadedFile';

const CONFIDENCE_STYLES = {
  high: 'bg-emerald-500/15 text-emerald-400',
  medium: 'bg-amber-500/15 text-amber-400',
  low: 'bg-red-500/15 text-red-400',
};

const CONFIDENCE_LABELS = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export default function DocUpload({ onExtracted, onDismiss }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [openQuestions, setOpenQuestions] = useState([]);
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    setError(null);
    setFileName(file.name);
    setIsExtracting(true);

    try {
      const documentText = await readUploadedFile(file);

      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentText }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Extraction failed');

      const { extracted } = data;

      setConfidence(extracted.extractionConfidence);
      setOpenQuestions(extracted.openQuestions || []);

      const { extractionConfidence, openQuestions: _oq, ...formFields } = extracted;
      onExtracted(formFields);
    } catch (err) {
      setError(err.message);
      setFileName('');
      setConfidence(null);
      setOpenQuestions([]);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDismiss = () => {
    setFileName('');
    setConfidence(null);
    setOpenQuestions([]);
    onDismiss?.();
  };

  return (
    <div className="mb-8">
      {!fileName && !isExtracting && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-8 py-8 text-center transition-colors ${
            isDragging
              ? 'border-indigo-accent bg-indigo-accent/10'
              : 'border-slate-600 hover:border-slate-500'
          }`}
        >
          <div className="mb-2 text-3xl">📄</div>
          <p className="mb-1 text-sm font-medium text-white">
            Upload a client brief to auto-fill the form
          </p>
          <p className="mb-3 text-xs text-slate-400">
            SOW, RFP, onboarding email, or technical spec
          </p>
          <p className="text-xs text-slate-500">.txt · .md · .pdf · .doc · .docx · .eml — max 5MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.pdf,.doc,.docx,.eml,.html"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      )}

      {isExtracting && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/50 px-6 py-5 text-center">
          <p className="text-sm text-slate-400">
            ⏳ Reading {fileName} and extracting requirements...
          </p>
        </div>
      )}

      {fileName && !isExtracting && !error && confidence && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/50 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">✓ {fileName}</p>
              <p className="mt-1 text-xs text-slate-400">
                Form fields populated from document. Review and fill any blanks below.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLES[confidence] || CONFIDENCE_STYLES.medium}`}
              >
                {CONFIDENCE_LABELS[confidence] || confidence}
              </span>
              <button
                type="button"
                onClick={handleDismiss}
                className="cursor-pointer border-none bg-transparent px-1 text-base text-slate-500"
                aria-label="Remove uploaded document"
              >
                ✕
              </button>
            </div>
          </div>

          {openQuestions.length > 0 && (
            <div className="mt-3 rounded-lg border-l-4 border-amber-500 bg-slate-800/50 px-3 py-2.5">
              <p className="mb-1.5 text-xs font-medium text-amber-400">
                Ambiguities found in document — clarify with client:
              </p>
              <ul className="list-inside list-disc text-xs text-slate-400">
                {openQuestions.map((q, i) => (
                  <li key={i} className="mb-0.5">
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400">
          <span>⚠ {error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="cursor-pointer border-none bg-transparent px-1 text-base text-red-400"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
