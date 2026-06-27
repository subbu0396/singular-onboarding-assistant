import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

const EXPORT_STYLES = `
  .pdf-export-document {
    font-family: Inter, Arial, sans-serif;
    color: #1e293b;
    line-height: 1.6;
    font-size: 11pt;
    background: #ffffff;
    padding: 40px;
    box-sizing: border-box;
  }
  .pdf-export-document h1 {
    color: #0f172a;
    font-size: 22pt;
    border-bottom: 2px solid #6366f1;
    padding-bottom: 8px;
    margin: 0 0 16px;
  }
  .pdf-export-document h2 { color: #0f172a; font-size: 16pt; margin: 24px 0 8px; }
  .pdf-export-document h3 { color: #334155; font-size: 13pt; margin: 18px 0 6px; }
  .pdf-export-document h4 { color: #475569; font-size: 12pt; margin: 14px 0 4px; }
  .pdf-export-document p { margin: 0 0 10px; }
  .pdf-export-document ul, .pdf-export-document ol { margin: 0 0 12px 20px; padding: 0; }
  .pdf-export-document li { margin-bottom: 4px; }
  .pdf-export-document table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; }
  .pdf-export-document th, .pdf-export-document td {
    border: 1px solid #cbd5e1;
    padding: 8px;
    text-align: left;
  }
  .pdf-export-document th { background: #f1f5f9; font-weight: 600; }
  .pdf-export-document code {
    background: #f1f5f9;
    padding: 2px 4px;
    border-radius: 3px;
    font-family: Consolas, monospace;
    font-size: 10pt;
  }
  .pdf-export-document pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    white-space: pre-wrap;
  }
  .pdf-export-document pre code { background: none; padding: 0; }
  .pdf-export-document blockquote {
    border-left: 4px solid #6366f1;
    margin: 12px 0;
    padding-left: 12px;
    color: #64748b;
  }
  .pdf-export-document hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
  .pdf-export-document strong { color: #0f172a; }
`;

export function buildExportFragment(title, markdown) {
  const body = marked.parse(markdown);
  return `<style>${EXPORT_STYLES}</style>
<div class="pdf-export-document">
  <h1>${title}</h1>
  ${body}
</div>`;
}

export function buildExportHtml(title, markdown) {
  const fragment = buildExportFragment(title, markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body>${fragment}</body>
</html>`;
}

export function getFilename(title, extension) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}.${extension}`;
}
