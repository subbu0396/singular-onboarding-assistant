-- Run in Supabase SQL Editor to set up the RAG knowledge base.

create extension if not exists vector;

create table if not exists integration_patterns (
  id bigserial primary key,
  platform text not null,
  category text not null,
  title text not null,
  content text not null,
  embedding vector(1536),
  created_at timestamp with time zone default now()
);

create index if not exists integration_patterns_embedding_idx
  on integration_patterns
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create or replace function match_patterns(
  query_embedding vector(1536),
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
