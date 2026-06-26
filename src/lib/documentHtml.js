import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export function buildExportHtml(title, markdown) {
  const body = marked.parse(markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: Inter, Arial, sans-serif;
      color: #1e293b;
      line-height: 1.6;
      font-size: 11pt;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
    }
    h1 { color: #0f172a; font-size: 22pt; border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin-top: 0; }
    h2 { color: #0f172a; font-size: 16pt; margin-top: 24px; }
    h3 { color: #334155; font-size: 13pt; margin-top: 18px; }
    h4 { color: #475569; font-size: 12pt; }
    p { margin: 0 0 10px; }
    ul, ol { margin: 0 0 12px 20px; padding: 0; }
    li { margin-bottom: 4px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    code { background: #f1f5f9; padding: 2px 4px; border-radius: 3px; font-family: Consolas, monospace; font-size: 10pt; }
    pre { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #6366f1; margin: 12px 0; padding-left: 12px; color: #64748b; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    strong { color: #0f172a; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

export function getFilename(title, extension) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}.${extension}`;
}
