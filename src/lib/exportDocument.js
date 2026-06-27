import { buildExportFragment } from './documentHtml';
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

function createExportElement(title, markdown) {
  const host = document.createElement('div');
  host.setAttribute('data-pdf-export', 'true');
  host.innerHTML = buildExportFragment(title, markdown);

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
  return host;
}

async function renderPdf(title, markdown, filename) {
  const element = createExportElement(title, markdown);

  try {
    await waitForLayout();

    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');

    const canvas = await html2canvas(element, {
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
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const printableWidth = pageWidth - margin * 2;
    const printableHeight = pageHeight - margin * 2;
    const imgWidth = printableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    let heightLeft = imgHeight;
    let yOffset = margin;

    pdf.addImage(imgData, 'JPEG', margin, yOffset, imgWidth, imgHeight);
    heightLeft -= printableHeight;

    while (heightLeft > 0) {
      pdf.addPage();
      yOffset = margin - (imgHeight - heightLeft);
      pdf.addImage(imgData, 'JPEG', margin, yOffset, imgWidth, imgHeight);
      heightLeft -= printableHeight;
    }

    pdf.save(filename);
  } finally {
    document.body.removeChild(element);
  }
}

export async function exportCombinedPackage(documents, clientName, format) {
  const title = getPackageTitle(clientName);
  const markdown = buildCombinedMarkdown(documents);

  switch (format) {
    case 'md': {
      const combined = `# ${title}\n\n${markdown}`;
      triggerDownload(
        new Blob([combined], { type: 'text/markdown' }),
        getPackageFilename(clientName, 'md')
      );
      break;
    }
    case 'docx': {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: markdown, format: 'docx', filename: getPackageFilename(clientName, 'docx') }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'DOCX export failed');
      }

      const blob = await response.blob();
      triggerDownload(blob, getPackageFilename(clientName, 'docx'));
      break;
    }
    case 'pdf':
      await renderPdf(title, markdown, getPackageFilename(clientName, 'pdf'));
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
