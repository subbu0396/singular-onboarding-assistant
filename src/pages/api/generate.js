import { generateDocument, generateAllDocuments } from '@/lib/server/claudeClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfigured: API key missing' });
  }

  try {
    const { form, docType, generateAll } = req.body;

    if (!form) {
      return res.status(400).json({ error: 'Form data is required' });
    }

    if (generateAll) {
      const documents = await generateAllDocuments(form, apiKey);
      return res.status(200).json({ documents });
    }

    if (!docType) {
      return res.status(400).json({ error: 'docType is required for single document generation' });
    }

    const content = await generateDocument(docType, form, apiKey);
    return res.status(200).json({ docType, content });
  } catch (error) {
    console.error('Document generation error:', error);
    return res.status(500).json({ error: error.message || 'Document generation failed' });
  }
}
