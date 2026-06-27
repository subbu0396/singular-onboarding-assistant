import { createPdfExportElement } from './documentHtml';
import {
  buildCombinedMarkdown,
  getPackageFilename,
  getPackageTitle,
} from './combineDocuments';

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function waitForLayout() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function addCanvasPagesToPdf(pdf, canvas, margin, printableWidth, printableHeight) {
  const scale = printableWidth / canvas.width;
  const pageHeightPx = printableHeight / scale;
  let sourceY = 0;
  let pageIndex = 0;

  while (sourceY < canvas.height) {
    const sliceHeight = Math.min(pageHeightPx, canvas.height - sourceY);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;

    const ctx = pageCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight
    );

    const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
    const renderHeight = sliceHeight * scale;

    if (pageIndex > 0) {
      pdf.addPage();
    }

    pdf.addImage(imgData, 'JPEG', margin, margin, printableWidth, renderHeight);

    sourceY += sliceHeight;
    pageIndex += 1;
  }
}

async function renderPdf(title, markdown, filename) {
  const { host, contentEl } = createPdfExportElement(title, markdown);

  try {
    await waitForLayout();

    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');

    const canvas = await html2canvas(contentEl, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: 794,
      windowWidth: 794,
    });

    if (canvas.width === 0 || canvas.height === 0) {
      throw new Error('PDF render produced empty canvas');
    }

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const margin = 10;
    const printableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
    const printableHeight = pdf.internal.pageSize.getHeight() - margin * 2;

    addCanvasPagesToPdf(pdf, canvas, margin, printableWidth, printableHeight);
    pdf.save(filename);
  } finally {
    document.body.removeChild(host);
  }
}

export async function exportCombinedPackage(documents, clientName, targetMmp, format) {
  const title = getPackageTitle(clientName, targetMmp);
  const markdown = buildCombinedMarkdown(documents);

  switch (format) {
    case 'md': {
      const combined = `# ${title}\n\n${markdown}`;
      triggerDownload(
        new Blob([combined], { type: 'text/markdown' }),
        getPackageFilename(clientName, targetMmp, 'md')
      );
      break;
    }
    case 'docx': {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: markdown,
          format: 'docx',
          filename: getPackageFilename(clientName, targetMmp, 'docx'),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'DOCX export failed');
      }

      const blob = await response.blob();
      triggerDownload(blob, getPackageFilename(clientName, targetMmp, 'docx'));
      break;
    }
    case 'pdf':
      await renderPdf(title, markdown, getPackageFilename(clientName, targetMmp, 'pdf'));
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
