import { buildExportHtml, getFilename } from './documentHtml';

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createExportElement(title, markdown) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildExportHtml(title, markdown);
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-9999px';
  wrapper.style.top = '0';
  wrapper.style.width = '800px';
  wrapper.style.background = '#ffffff';
  document.body.appendChild(wrapper);
  return wrapper;
}

export function exportAsMarkdown(title, content) {
  const blob = new Blob([content], { type: 'text/markdown' });
  triggerDownload(blob, getFilename(title, 'md'));
}

export async function exportAsDocx(title, content) {
  const response = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, format: 'docx' }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'DOCX export failed');
  }

  const blob = await response.blob();
  triggerDownload(blob, getFilename(title, 'docx'));
}

export async function exportAsPdf(title, content) {
  const html2pdf = (await import('html2pdf.js')).default;
  const element = createExportElement(title, content);

  try {
    await html2pdf()
      .set({
        margin: [12, 12, 12, 12],
        filename: getFilename(title, 'pdf'),
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      })
      .from(element.querySelector('body') || element)
      .save();
  } finally {
    document.body.removeChild(element);
  }
}

export async function exportDocument(title, content, format) {
  switch (format) {
    case 'md':
      exportAsMarkdown(title, content);
      break;
    case 'docx':
      await exportAsDocx(title, content);
      break;
    case 'pdf':
      await exportAsPdf(title, content);
      break;
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

export const DOWNLOAD_FORMATS = [
  { value: 'pdf', label: 'PDF (.pdf)' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'md', label: 'Markdown (.md)' },
];
