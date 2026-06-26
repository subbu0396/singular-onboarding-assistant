import { generateDocument, generateAllDocuments } from '@/lib/claudeClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { form, docType, generateAll } = req.body;

    if (!form) {
      return res.status(400).json({ error: 'Form data is required' });
    }

    if (generateAll) {
      const documents = await generateAllDocuments(form);
      return res.status(200).json({ documents });
    }

    if (!docType) {
      return res.status(400).json({ error: 'docType is required for single document generation' });
    }

    const content = await generateDocument(docType, form);
    return res.status(200).json({ docType, content });
  } catch (error) {
    console.error('Document generation error:', error);
    const message = error?.message || 'Failed to generate document';
    const status = message.includes('ANTHROPIC_API_KEY') ? 500 : 502;
    return res.status(status).json({ error: message });
  }
}
