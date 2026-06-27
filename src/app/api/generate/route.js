export const runtime = 'edge';
export const maxDuration = 60;

import { generateDocument, generateAllDocuments } from '@/lib/server/claudeClient';

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json({ error: 'Server misconfigured: API key missing' }, { status: 500 });
  }

  try {
    const { form, docType, generateAll } = await req.json();

    if (!form) {
      return Response.json({ error: 'Form data is required' }, { status: 400 });
    }

    if (generateAll) {
      const documents = await generateAllDocuments(form, apiKey);
      return Response.json({ documents });
    }

    if (!docType) {
      return Response.json(
        { error: 'docType is required for single document generation' },
        { status: 400 }
      );
    }

    const content = await generateDocument(docType, form, apiKey);
    return Response.json({ docType, content });
  } catch (error) {
    console.error('Document generation error:', error);
    return Response.json(
      { error: error.message || 'Document generation failed' },
      { status: 500 }
    );
  }
}
