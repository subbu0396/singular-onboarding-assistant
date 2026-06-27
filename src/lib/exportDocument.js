import {
  createPdfExportElement,
  PDF_PAGE_HEIGHT_PX,
  PDF_PAGE_INNER_HEIGHT_PX,
  PDF_PAGE_WIDTH_PX,
} from './documentHtml';
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

/** Split top-level blocks; long lists paginate per list item. */
function collectPaginatableBlocks(contentEl) {
  const blocks = [];

  for (const child of contentEl.children) {
    const tag = child.tagName;

    if (tag === 'UL' || tag === 'OL') {
      for (const li of child.children) {
        const miniList = document.createElement(tag);
        miniList.className = child.className;
        miniList.appendChild(li.cloneNode(true));
        blocks.push(miniList);
      }
      continue;
    }

    if (tag === 'TABLE') {
      const rows = child.querySelectorAll('tr');
      if (rows.length <= 8) {
        blocks.push(child);
        continue;
      }

      const thead = child.querySelector('thead');
      for (let i = 0; i < rows.length; i += 6) {
        const table = document.createElement('table');
        table.className = child.className;
        table.setAttribute('border', child.getAttribute('border') || '1');
        table.setAttribute('cellpadding', child.getAttribute('cellpadding') || '6');
        table.setAttribute('cellspacing', child.getAttribute('cellspacing') || '0');

        if (thead && i === 0) {
          table.appendChild(thead.cloneNode(true));
        } else if (thead) {
          table.appendChild(thead.cloneNode(true));
        }

        const tbody = document.createElement('tbody');
        for (let j = i; j < Math.min(i + 6, rows.length); j += 1) {
          if (rows[j].closest('thead')) continue;
          tbody.appendChild(rows[j].cloneNode(true));
        }
        if (tbody.children.length) table.appendChild(tbody);
        blocks.push(table);
      }
      continue;
    }

    blocks.push(child);
  }

  return blocks;
}

function createMeasureHost(styleEl) {
  const host = document.createElement('div');
  host.setAttribute('data-pdf-measure', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-12000px',
    top: '0',
    width: `${PDF_PAGE_WIDTH_PX}px`,
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  host.appendChild(styleEl.cloneNode(true));
  document.body.appendChild(host);
  return host;
}

function measureBlockHeight(measureHost, blocks) {
  const shell = document.createElement('div');
  shell.className = 'pdf-page-shell';

  const inner = document.createElement('div');
  inner.className = 'export-document';

  for (const block of blocks) {
    inner.appendChild(block.cloneNode(true));
  }

  shell.appendChild(inner);
  measureHost.appendChild(shell);
  const height = inner.scrollHeight;
  measureHost.removeChild(shell);
  return height;
}

function paginateBlocks(blocks, measureHost, maxInnerHeight) {
  const pages = [];
  let currentPage = [];

  for (const block of blocks) {
    const blockHeight = measureBlockHeight(measureHost, [block]);
    const pageHeight = measureBlockHeight(measureHost, currentPage);

    if (blockHeight > maxInnerHeight) {
      if (currentPage.length) {
        pages.push(currentPage);
        currentPage = [];
      }
      pages.push([block]);
      continue;
    }

    if (pageHeight + blockHeight > maxInnerHeight && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [block];
    } else {
      currentPage.push(block);
    }
  }

  if (currentPage.length) pages.push(currentPage);
  return pages;
}

function buildPageElement(blocks) {
  const shell = document.createElement('div');
  shell.className = 'pdf-page-shell';

  const inner = document.createElement('div');
  inner.className = 'export-document';

  for (const block of blocks) {
    inner.appendChild(block.cloneNode(true));
  }

  shell.appendChild(inner);
  return shell;
}

async function renderPdf(title, markdown, filename) {
  const { host, contentEl, styleEl } = createPdfExportElement(title, markdown);

  try {
    await waitForLayout();

    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');

    const blocks = collectPaginatableBlocks(contentEl);
    const measureHost = createMeasureHost(styleEl);
    const pages = paginateBlocks(blocks, measureHost, PDF_PAGE_INNER_HEIGHT_PX);
    document.body.removeChild(measureHost);

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const margin = 10;
    const printableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
    const printableHeight = pdf.internal.pageSize.getHeight() - margin * 2;

    for (let i = 0; i < pages.length; i += 1) {
      const pageEl = buildPageElement(pages[i]);
      host.appendChild(pageEl);
      await waitForLayout();

      const canvas = await html2canvas(pageEl, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: PDF_PAGE_WIDTH_PX,
        height: PDF_PAGE_HEIGHT_PX,
        windowWidth: PDF_PAGE_WIDTH_PX,
        windowHeight: PDF_PAGE_HEIGHT_PX,
      });

      host.removeChild(pageEl);

      if (canvas.width === 0 || canvas.height === 0) {
        throw new Error('PDF render produced empty canvas');
      }

      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const renderHeight = (canvas.height * printableWidth) / canvas.width;

      if (i > 0) pdf.addPage();

      if (renderHeight > printableHeight) {
        pdf.addImage(imgData, 'JPEG', margin, margin, printableWidth, printableHeight);
      } else {
        pdf.addImage(imgData, 'JPEG', margin, margin, printableWidth, renderHeight);
      }
    }

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
