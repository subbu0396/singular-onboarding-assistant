export const runtime = 'edge';
export const maxDuration = 30;

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json({ error: 'API key not configured' }, { status: 500 });
  }

  const { documentText } = await req.json();

  if (!documentText || documentText.trim().length < 50) {
    return Response.json({ error: 'Document is too short or empty' }, { status: 400 });
  }

  const systemPrompt = `You are a technical integration requirements extractor. Your job is to read unstructured client documents — SOWs, onboarding emails, RFPs, technical specs, or meeting notes — and extract structured integration requirements from them.

Return ONLY a valid JSON object. No markdown, no backticks, no preamble, no explanation. Just the raw JSON.

If a field cannot be determined from the document, set it to null.
Never guess or infer beyond what the document explicitly states.`;

  const userPrompt = `Extract integration requirements from this document and return them as a JSON object with exactly these keys:

{
  "clientName": string or null,
  "industry": one of ["E-commerce","Gaming","Fintech","Travel","OTT/Media","Other"] or null,
  "primaryMarket": one of ["India","SEA","MENA","US","Europe","Other"] or null,
  "platforms": array of any from ["iOS","Android","React Native","Flutter","Unity"] or [],
  "currentMMP": one of ["None","AppsFlyer","Adjust","Branch","Firebase","Other"] or null,
  "attributionModel": one of ["Last Touch","Data Driven","Multi-Touch"] or null,
  "integrationMethods": array of any from ["S2S Postbacks","SKAdNetwork","Google Ads","Meta Ads","Firebase Import","Custom Dashboard Export"] or [],
  "exportMethods": array of any from ["S3","SFTP","Snowflake","BigQuery","API Pull"] or [],
  "eventTracking": one of ["SDK Events","S2S Events","Both"] or null,
  "backendLanguage": one of ["Python","Node.js","Java","PHP","Ruby","Go","Other"] or null,
  "hasDataWarehouse": true or false or null,
  "usesCDP": true or false or null,
  "cdpName": string or null,
  "authMethod": one of ["OAuth 2.0","API Key","SAML SSO","Other"] or null,
  "goLiveDate": ISO date string (YYYY-MM-DD) or null,
  "urgency": one of ["Standard 4-6 weeks","Accelerated 2-3 weeks","Critical <2 weeks"] or null,
  "openQuestions": array of strings (unanswered questions or ambiguities found in the document) or [],
  "extractionConfidence": one of ["high","medium","low"]
}

For extractionConfidence:
- "high" = document is a formal spec or SOW with clear technical details
- "medium" = document is an email or brief with some technical details
- "low" = document is vague, a meeting transcript, or mostly non-technical

Document to extract from:
---
${documentText.slice(0, 12000)}
---`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Extraction failed');
    }

    const data = await response.json();
    const rawText = data.content[0].text.trim();

    const cleaned = rawText
      .replace(/^```json\n?/, '')
      .replace(/^```\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    const extracted = JSON.parse(cleaned);

    return Response.json({ extracted });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return Response.json(
        { error: 'Could not parse extraction result. Try again.' },
        { status: 500 }
      );
    }
    return Response.json({ error: err.message || 'Extraction failed' }, { status: 500 });
  }
}
