import { marked } from 'marked';

const DOCX_STYLES = `
  body {
    font-family: Arial, sans-serif;
    color: #1e293b;
    line-height: 1.5;
    font-size: 11pt;
    margin: 0;
    padding: 0;
  }
  h1 {
    color: #0f172a;
    font-size: 22pt;
    border-bottom: 2pt solid #6366f1;
    padding-bottom: 6pt;
    margin: 0 0 14pt;
  }
  h2 { color: #0f172a; font-size: 16pt; margin: 20pt 0 8pt; }
  h3 { color: #334155; font-size: 13pt; margin: 16pt 0 6pt; }
  h4 { color: #475569; font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 10pt 18pt; padding: 0; }
  li { margin-bottom: 4pt; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 10pt 0;
    font-size: 10pt;
  }
  th, td {
    border: 1pt solid #cbd5e1;
    padding: 6pt 8pt;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f1f5f9; font-weight: bold; }
  code {
    font-family: Consolas, monospace;
    font-size: 10pt;
    background: #f1f5f9;
    padding: 1pt 3pt;
  }
  pre {
    font-family: Consolas, monospace;
    font-size: 9pt;
    background: #f8fafc;
    border: 1pt solid #e2e8f0;
    padding: 10pt;
    white-space: pre-wrap;
    margin: 0 0 10pt;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3pt solid #6366f1;
    margin: 10pt 0;
    padding-left: 10pt;
    color: #64748b;
  }
  hr { border: none; border-top: 1pt solid #e2e8f0; margin: 18pt 0; }
  strong { color: #0f172a; }
`;

const PDF_STYLES = `
  .export-document {
    font-family: Inter, Arial, sans-serif;
    color: #1e293b;
    line-height: 1.6;
    font-size: 11pt;
    background: #ffffff;
    padding: 40px;
    box-sizing: border-box;
  }
  .export-document h1 {
    color: #0f172a;
    font-size: 22pt;
    border-bottom: 2px solid #6366f1;
    padding-bottom: 8px;
    margin: 0 0 16px;
  }
  .export-document h2 { color: #0f172a; font-size: 16pt; margin: 24px 0 8px; }
  .export-document h3 { color: #334155; font-size: 13pt; margin: 18px 0 6px; }
  .export-document h4 { color: #475569; font-size: 12pt; margin: 14px 0 4px; }
  .export-document p { margin: 0 0 10px; }
  .export-document ul, .export-document ol { margin: 0 0 12px 20px; padding: 0; }
  .export-document li { margin-bottom: 4px; }
  .export-document table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    font-size: 10pt;
    page-break-inside: auto;
  }
  .export-document tr { page-break-inside: avoid; page-break-after: auto; }
  .export-document th, .export-document td {
    border: 1px solid #cbd5e1;
    padding: 8px;
    text-align: left;
    vertical-align: top;
  }
  .export-document th { background: #f1f5f9; font-weight: 600; }
  .export-document code {
    font-family: Consolas, monospace;
    font-size: 10pt;
    background: #f1f5f9;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .export-document pre {
    font-family: Consolas, monospace;
    font-size: 9pt;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 12px;
    border-radius: 6px;
    white-space: pre-wrap;
    page-break-inside: avoid;
    margin: 0 0 12px;
  }
  .export-document pre code { background: none; padding: 0; }
  .export-document blockquote {
    border-left: 4px solid #6366f1;
    margin: 12px 0;
    padding-left: 12px;
    color: #64748b;
    page-break-inside: avoid;
  }
  .export-document hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
  .export-document strong { color: #0f172a; }
`;

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    checkbox({ checked }) {
      return checked ? '☑ ' : '☐ ';
    },
    table(token) {
      let header = '';
      for (const cell of token.header) {
        header += this.tablecell(cell);
      }
      let body = '';
      for (const row of token.rows) {
        let rowHtml = '';
        for (const cell of row) {
          rowHtml += this.tablecell(cell);
        }
        body += `<tr>${rowHtml}</tr>`;
      }
      return `<table border="1" cellpadding="6" cellspacing="0">
<thead><tr>${header}</tr></thead>
${body ? `<tbody>${body}</tbody>` : ''}
</table>`;
    },
  },
});

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function preprocessMarkdown(markdown) {
  return markdown
    .replace(/^(\s*)-\s*\[ \]\s+/gm, '$1- ☐ ')
    .replace(/^(\s*)-\s*\[x\]\s+/gim, '$1- ☑ ')
    .replace(/^(\s*)\[ \]\s+/gm, '$1- ☐ ')
    .replace(/^(\s*)\[x\]\s+/gim, '$1- ☑ ');
}

export function parseMarkdown(markdown) {
  return marked.parse(preprocessMarkdown(markdown));
}

export function buildDocxHtml(title, markdown) {
  const body = parseMarkdown(markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>${DOCX_STYLES}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`;
}

export function createPdfExportElement(title, markdown) {
  const host = document.createElement('div');
  host.setAttribute('data-pdf-export', 'true');

  const styleEl = document.createElement('style');
  styleEl.textContent = PDF_STYLES;

  const contentEl = document.createElement('div');
  contentEl.className = 'export-document';
  contentEl.innerHTML = `<h1>${escapeHtml(title)}</h1>${parseMarkdown(markdown)}`;

  host.appendChild(styleEl);
  host.appendChild(contentEl);

  Object.assign(host.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '794px',
    background: '#ffffff',
    zIndex: '99999',
    pointerEvents: 'none',
  });

  document.body.appendChild(host);
  return { host, contentEl };
}

/** @deprecated Use buildDocxHtml or createPdfExportElement */
export function buildExportFragment(title, markdown) {
  return `<div class="export-document"><h1>${escapeHtml(title)}</h1>${parseMarkdown(markdown)}</div>`;
}

/** @deprecated Use buildDocxHtml */
export function buildExportHtml(title, markdown) {
  return buildDocxHtml(title, markdown);
}

export function getFilename(title, extension) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}.${extension}`;
}
