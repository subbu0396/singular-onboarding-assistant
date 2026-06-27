import OpenAI from 'openai';

export async function embedText(text) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),
  });

  return response.data[0].embedding;
}
