export const runtime = 'edge';

import { embedText } from '@/lib/embeddings';

export async function POST(req) {
  const adminToken = process.env.ADMIN_TOKEN;
  const authHeader = req.headers.get('authorization');

  if (!adminToken || authHeader !== `Bearer ${adminToken}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { platform, category, title, content } = await req.json();

  if (!platform || !category || !title || !content) {
    return Response.json(
      { error: 'platform, category, title, and content are all required' },
      { status: 400 }
    );
  }

  if (!process.env.VOYAGE_API_KEY) {
    return Response.json({ error: 'VOYAGE_API_KEY not configured' }, { status: 500 });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return Response.json(
      { error: 'SUPABASE_URL and SUPABASE_SERVICE_KEY must be configured' },
      { status: 500 }
    );
  }

  const embedding = await embedText(`${platform} ${category} ${title} ${content}`);

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('integration_patterns')
    .insert({ platform, category, title, content, embedding })
    .select('id, title')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    success: true,
    id: data.id,
    title: data.title,
  });
}
