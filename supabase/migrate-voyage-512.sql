-- Migrate existing integration_patterns from OpenAI (1536) to Voyage (512) embeddings.
-- Run in Supabase SQL Editor, then re-run: npm run seed:kb

drop index if exists integration_patterns_embedding_idx;
alter table integration_patterns drop column if exists embedding;

alter table integration_patterns add column embedding vector(512);

create index integration_patterns_embedding_idx
  on integration_patterns
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create or replace function match_patterns(
  query_embedding vector(512),
  match_threshold float default 0.75,
  match_count int default 5
)
returns table (
  id bigint,
  platform text,
  category text,
  title text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    id,
    platform,
    category,
    title,
    content,
    1 - (embedding <=> query_embedding) as similarity
  from integration_patterns
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
