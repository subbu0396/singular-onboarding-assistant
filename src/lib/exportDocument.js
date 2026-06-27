import {
  createPdfExportElement,
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

function wrapInList(tag, li) {
  const list = document.createElement(tag);
  list.appendChild(li.cloneNode(true));
  return list;
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

function measureBlocksHeight(measureHost, blockNodes) {
  if (!blockNodes.length) return 0;

  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-measure';

  const inner = document.createElement('div');
  inner.className = 'export-document';

  for (const block of blockNodes) {
    inner.appendChild(block.cloneNode(true));
  }

  wrapper.appendChild(inner);
  measureHost.appendChild(wrapper);
  const height = inner.offsetHeight;
  measureHost.removeChild(wrapper);
  return height;
}

function makePreChunk(pre, lines) {
  const chunk = document.createElement('pre');
  chunk.className = pre.className;
  const code = document.createElement('code');
  code.textContent = lines.join('\n');
  chunk.appendChild(code);
  return chunk;
}

function splitPreBlock(pre, measureHost, maxInnerHeight) {
  const lines = pre.textContent.replace(/\r\n/g, '\n').split('\n');
  if (!lines.length) return [pre];

  const chunks = [];
  let currentLines = [];

  for (const line of lines) {
    const candidate = makePreChunk(pre, [...currentLines, line]);
    const height = measureBlocksHeight(measureHost, [candidate]);

    if (height > maxInnerHeight && currentLines.length > 0) {
      chunks.push(makePreChunk(pre, currentLines));
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length) {
    chunks.push(makePreChunk(pre, currentLines));
  }

  return chunks.length ? chunks : [pre];
}

function splitBlockquote(blockquote, measureHost, maxInnerHeight) {
  const parts = [];

  for (const child of blockquote.children) {
    const mini = document.createElement('blockquote');
    mini.className = blockquote.className;
    mini.appendChild(child.cloneNode(true));
    parts.push(...expandOversizedBlock(mini, measureHost, maxInnerHeight));
  }

  if (!parts.length) {
    parts.push(...expandOversizedBlock(blockquote, measureHost, maxInnerHeight));
  }

  return parts;
}

function splitTextListItem(li, listTag, measureHost, maxInnerHeight) {
  const text = li.textContent.replace(/\u200B/g, '');
  const tokens = text.split(/(\s+)/).filter(Boolean);
  if (!tokens.length) return [li];

  const items = [];
  let chunk = '';

  for (const token of tokens) {
    const testLi = document.createElement('li');
    testLi.textContent = chunk + token;
    const height = measureBlocksHeight(measureHost, [wrapInList(listTag, testLi)]);

    if (height > maxInnerHeight && chunk.trim()) {
      const flushed = document.createElement('li');
      flushed.textContent = chunk.trim();
      items.push(flushed);
      chunk = token;
    } else {
      chunk += token;
    }
  }

  if (chunk.trim()) {
    const last = document.createElement('li');
    last.textContent = chunk.trim();
    items.push(last);
  }

  return items.length ? items : [li];
}

function splitListItem(li, listTag, measureHost, maxInnerHeight) {
  const wrappedHeight = measureBlocksHeight(measureHost, [wrapInList(listTag, li)]);
  if (wrappedHeight <= maxInnerHeight) return [li];

  const blockChildren = [...li.children];
  if (blockChildren.length > 1) {
    const items = [];
    for (const child of blockChildren) {
      const miniLi = document.createElement('li');
      miniLi.appendChild(child.cloneNode(true));
      items.push(...splitListItem(miniLi, listTag, measureHost, maxInnerHeight));
    }
    return items;
  }

  const pre = li.querySelector('pre');
  if (pre) {
    const preChunks = splitPreBlock(pre, measureHost, maxInnerHeight);
    return preChunks.map((preChunk) => {
      const miniLi = document.createElement('li');
      miniLi.appendChild(preChunk);
      return miniLi;
    });
  }

  return splitTextListItem(li, listTag, measureHost, maxInnerHeight);
}

function splitListBlock(listEl, measureHost, maxInnerHeight) {
  const tag = listEl.tagName;
  const chunks = [];

  for (const li of listEl.children) {
    const splitItems = splitListItem(li, tag, measureHost, maxInnerHeight);
    for (const item of splitItems) {
      chunks.push(wrapInList(tag, item));
    }
  }

  return chunks.length ? chunks : [listEl];
}

function expandOversizedBlock(block, measureHost, maxInnerHeight) {
  const height = measureBlocksHeight(measureHost, [block]);
  if (height <= maxInnerHeight) return [block];

  const tag = block.tagName;

  if (tag === 'PRE') {
    return splitPreBlock(block, measureHost, maxInnerHeight);
  }

  if (tag === 'BLOCKQUOTE') {
    return splitBlockquote(block, measureHost, maxInnerHeight);
  }

  if (tag === 'UL' || tag === 'OL') {
    return splitListBlock(block, measureHost, maxInnerHeight);
  }

  if (tag === 'TABLE') {
    return [block];
  }

  return [block];
}

/** Top-level DOM blocks used for pagination. */
function collectPaginatableBlocks(contentEl) {
  const blocks = [];

  for (const child of contentEl.children) {
    const tag = child.tagName;

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

        if (thead) {
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

function flattenBlocks(blocks, measureHost, maxInnerHeight) {
  const flat = [];

  for (const block of blocks) {
    flat.push(...expandOversizedBlock(block, measureHost, maxInnerHeight));
  }

  return flat;
}

function paginateBlocks(blocks, measureHost, maxInnerHeight) {
  const pages = [];
  let currentPage = [];

  for (const block of blocks) {
    const blockHeight = measureBlocksHeight(measureHost, [block]);
    const pageHeight = measureBlocksHeight(measureHost, currentPage);

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
  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-page';

  const inner = document.createElement('div');
  inner.className = 'export-document';

  for (const block of blocks) {
    inner.appendChild(block.cloneNode(true));
  }

  wrapper.appendChild(inner);
  return wrapper;
}

async function renderPdf(title, markdown, filename) {
  const { host, contentEl, styleEl } = createPdfExportElement(title, markdown);

  try {
    await waitForLayout();

    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');

    const measureHost = createMeasureHost(styleEl);
    const rawBlocks = collectPaginatableBlocks(contentEl);
    const blocks = flattenBlocks(rawBlocks, measureHost, PDF_PAGE_INNER_HEIGHT_PX);
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

      const contentHeight = pageEl.offsetHeight;

      const canvas = await html2canvas(pageEl, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: PDF_PAGE_WIDTH_PX,
        height: contentHeight,
        windowWidth: PDF_PAGE_WIDTH_PX,
        windowHeight: contentHeight,
      });

      host.removeChild(pageEl);

      if (canvas.width === 0 || canvas.height === 0) {
        throw new Error('PDF render produced empty canvas');
      }

      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const renderHeight = (canvas.height * printableWidth) / canvas.width;

      if (i > 0) pdf.addPage();

      if (renderHeight > printableHeight + 1) {
        const scale = printableHeight / renderHeight;
        pdf.addImage(
          imgData,
          'JPEG',
          margin,
          margin,
          printableWidth * scale,
          printableHeight
        );
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
