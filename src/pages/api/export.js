import HTMLtoDOCX from 'html-to-docx';
import { buildExportHtml, getFilename } from '@/lib/documentHtml';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { title, content, format } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    if (format !== 'docx') {
      return res.status(400).json({ error: 'Only docx export is supported via this endpoint' });
    }

    const html = buildExportHtml(title, content);
    const buffer = await HTMLtoDOCX(html, null, {
      table: { row: { cantSplit: true } },
      footer: false,
      pageNumber: false,
    });

    const filename = getFilename(title, 'docx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({ error: 'Failed to generate document' });
  }
}
