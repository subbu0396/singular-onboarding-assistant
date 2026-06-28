import HTMLtoDOCX from 'html-to-docx';
import { buildDocxHtml, getFilename } from '@/lib/documentHtml';

export const config = {
  api: {
    bodyParser: { sizeLimit: '600kb' },
  },
};

const MAX_TITLE_LENGTH = 500;
const MAX_CONTENT_LENGTH = 500_000;

function getAllowedOrigins(req) {
  const origins = new Set();
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (fromEnv) {
    try {
      origins.add(new URL(fromEnv).origin);
    } catch {
      // ignore malformed env value
    }
  }
  const host = req.headers.host;
  if (host) {
    origins.add(`https://${host}`);
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
      origins.add(`http://${host}`);
    }
  }
  return origins;
}

function isAllowedRequest(req) {
  const allowed = getAllowedOrigins(req);
  const origin = req.headers.origin;
  if (origin && allowed.has(origin)) return true;

  const referer = req.headers.referer;
  if (referer) {
    try {
      if (allowed.has(new URL(referer).origin)) return true;
    } catch {
      // fall through
    }
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAllowedRequest(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { title, content, format, filename } = req.body || {};

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    if (typeof title !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: 'Title and content must be strings' });
    }

    if (title.length > MAX_TITLE_LENGTH) {
      return res.status(413).json({ error: 'Title is too long' });
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return res.status(413).json({ error: 'Content is too long' });
    }

    if (format !== 'docx') {
      return res.status(400).json({ error: 'Only docx export is supported via this endpoint' });
    }

    const html = buildDocxHtml(title, content);
    const buffer = await HTMLtoDOCX(html, null, {
      table: { row: { cantSplit: true } },
      footer: false,
      pageNumber: false,
    });

    const downloadName =
      (typeof filename === 'string' && filename) || getFilename(title, 'docx');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    return res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({ error: 'Failed to generate document' });
  }
}
