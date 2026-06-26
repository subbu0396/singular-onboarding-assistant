import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DOWNLOAD_FORMATS, exportDocument } from '@/lib/exportDocument';

function getWordCount(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function getReadingTime(wordCount) {
  const minutes = Math.max(1, Math.ceil(wordCount / 200));
  return `${minutes} min read`;
}

export default function DocCard({
  title,
  content,
  docType,
  isLoading,
  error,
  onRegenerate,
  onRetry,
}) {
  const [copied, setCopied] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState('pdf');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const wordCount = getWordCount(content);
  const readingTime = getReadingTime(wordCount);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleDownload = async () => {
    setExportError(null);
    setIsExporting(true);
    try {
      await exportDocument(title, content, downloadFormat);
    } catch {
      setExportError('Export failed. Please try again or choose a different format.');
    } finally {
      setIsExporting(false);
    }
  };

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
        <h3 className="text-lg font-semibold text-red-400">{title}</h3>
        <p className="mt-2 text-sm text-red-300">{error}</p>
        <button type="button" onClick={onRetry} className="btn-primary mt-4">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50">
      <div className="flex flex-col gap-4 border-b border-slate-800 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {content && (
            <p className="mt-0.5 text-xs text-slate-500">
              {wordCount.toLocaleString()} words · {readingTime}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!content || isLoading}
            className="btn-secondary text-xs disabled:opacity-40"
          >
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <div className="flex items-center gap-1.5">
            <select
              value={downloadFormat}
              onChange={(e) => {
                setDownloadFormat(e.target.value);
                setExportError(null);
              }}
              disabled={!content || isLoading || isExporting}
              className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-2 text-xs text-slate-200 focus:border-indigo-accent focus:outline-none focus:ring-1 focus:ring-indigo-accent disabled:opacity-40"
              aria-label="Download format"
            >
              {DOWNLOAD_FORMATS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!content || isLoading || isExporting}
              className="btn-secondary text-xs disabled:opacity-40"
            >
              {isExporting ? 'Exporting...' : 'Download'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => onRegenerate(docType)}
            disabled={isLoading}
            className="btn-secondary text-xs disabled:opacity-40"
          >
            {isLoading ? 'Regenerating...' : 'Regenerate'}
          </button>
        </div>
      </div>

      {exportError && (
        <div className="mx-6 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          {exportError}
        </div>
      )}

      <div className="px-6 py-5">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-slate-800" />
            <div className="h-4 w-4/6 animate-pulse rounded bg-slate-800" />
            <div className="mt-6 h-6 w-2/5 animate-pulse rounded bg-slate-700" />
            <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
            <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
          </div>
        ) : (
          <div className="markdown-body max-h-[70vh] overflow-y-auto pr-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
