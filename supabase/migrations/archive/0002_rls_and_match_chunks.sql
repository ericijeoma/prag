-- ============================================================
-- Extensions (idempotent)
-- ============================================================
create extension if not exists pgcrypto;
create extension if not exists vector;

-- ============================================================
-- Schemas (idempotent)
-- ============================================================
create schema if not exists shared;
create schema if not exists ingestion;
create schema if not exists knowledge;
create schema if not exists agent;

-- ============================================================
-- Tables (idempotent)
-- ============================================================
create table if not exists shared.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists knowledge.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references shared.tenants(id) on delete cascade,
  title text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  file_path text,
  source_type text not null default 'upload',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_id_tenant_unique unique (id, tenant_id)
);

create table if not exists knowledge.chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references shared.tenants(id) on delete cascade,
  document_id uuid not null,
  chunk_index integer not null,
  chunk_text text not null,
  chunk_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chunks_document_tenant_fk
    foreign key (document_id, tenant_id)
    references knowledge.documents (id, tenant_id)
    on delete cascade,
  constraint chunks_id_tenant_unique unique (id, tenant_id)
);

create table if not exists knowledge.chunk_vectors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references shared.tenants(id) on delete cascade,
  chunk_id uuid not null,
  embedding vector(384) not null,
  created_at timestamptz not null default now(),
  constraint chunk_vectors_chunk_tenant_fk
    foreign key (chunk_id, tenant_id)
    references knowledge.chunks (id, tenant_id)
    on delete cascade
);

create table if not exists ingestion.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references shared.tenants(id) on delete cascade,
  document_id uuid,
  status text not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingestion_jobs_document_tenant_fk
    foreign key (document_id, tenant_id)
    references knowledge.documents (id, tenant_id)
    on delete cascade
);

create table if not exists agent.runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references shared.tenants(id) on delete cascade,
  user_query text not null,
  plan jsonb not null default '{}'::jsonb,
  final_answer text,
  verification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint runs_id_tenant_unique unique (id, tenant_id)
);

create table if not exists agent.citations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references shared.tenants(id) on delete cascade,
  run_id uuid not null,
  document_id uuid,
  chunk_id uuid,
  citation_text text not null,
  created_at timestamptz not null default now(),
  constraint citations_run_tenant_fk
    foreign key (run_id, tenant_id)
    references agent.runs (id, tenant_id)
    on delete cascade,
  constraint citations_document_tenant_fk
    foreign key (document_id, tenant_id)
    references knowledge.documents (id, tenant_id)
    on delete cascade,
  constraint citations_chunk_tenant_fk
    foreign key (chunk_id, tenant_id)
    references knowledge.chunks (id, tenant_id)
    on delete cascade
);

-- ============================================================
-- Indexes for performance
-- ============================================================
create index if not exists idx_documents_tenant_id
  on knowledge.documents (tenant_id);

create index if not exists idx_chunks_tenant_document
  on knowledge.chunks (tenant_id, document_id);

create index if not exists idx_chunk_vectors_tenant
  on knowledge.chunk_vectors (tenant_id);

-- pgvector HNSW index for fast approximate nearest neighbour search
create index if not exists idx_chunk_vectors_embedding_hnsw
  on knowledge.chunk_vectors
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_agent_runs_tenant
  on agent.runs (tenant_id);

create index if not exists idx_ingestion_jobs_tenant_status
  on ingestion.jobs (tenant_id, status);

-- ============================================================
-- Row Level Security
-- ============================================================

-- ============================================================
-- Row Level Security
-- ============================================================

alter table shared.tenants enable row level security;
alter table knowledge.documents enable row level security;
alter table knowledge.chunks enable row level security;
alter table knowledge.chunk_vectors enable row level security;
alter table ingestion.jobs enable row level security;
alter table agent.runs enable row level security;
alter table agent.citations enable row level security;

-- Drop policies before recreating (idempotent workaround)
drop policy if exists tenants_service_only on shared.tenants;
drop policy if exists documents_tenant_isolation on knowledge.documents;
drop policy if exists chunks_tenant_isolation on knowledge.chunks;
drop policy if exists chunk_vectors_tenant_isolation on knowledge.chunk_vectors;
drop policy if exists jobs_tenant_isolation on ingestion.jobs;
drop policy if exists runs_tenant_isolation on agent.runs;
drop policy if exists citations_tenant_isolation on agent.citations;

create policy tenants_service_only
  on shared.tenants for all to service_role
  using (true) with check (true);

create policy documents_tenant_isolation
  on knowledge.documents for all to service_role
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy chunks_tenant_isolation
  on knowledge.chunks for all to service_role
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy chunk_vectors_tenant_isolation
  on knowledge.chunk_vectors for all to service_role
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy jobs_tenant_isolation
  on ingestion.jobs for all to service_role
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy runs_tenant_isolation
  on agent.runs for all to service_role
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy citations_tenant_isolation
  on agent.citations for all to service_role
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- match_chunks function
-- ============================================================
create or replace function knowledge.match_chunks(
  p_tenant_id uuid,
  p_query_embedding vector(384),
  p_match_count int default 5
)
returns table (
  chunk_id uuid,
  document_id uuid,
  chunk_index int,
  chunk_text text,
  chunk_metadata jsonb,
  score float
)
language plpgsql
stable
security definer
set search_path = knowledge, public
as $$
begin
  if p_tenant_id is null then
    raise exception 'p_tenant_id must not be null';
  end if;
  if p_query_embedding is null then
    raise exception 'p_query_embedding must not be null';
  end if;
  if p_match_count is null or p_match_count < 1 then
    raise exception 'p_match_count must be >= 1';
  end if;

  return query
  select
    c.id as chunk_id,
    c.document_id,
    c.chunk_index,
    c.chunk_text,
    c.chunk_metadata,
    (1 - (cv.embedding <=> p_query_embedding))::float as score
  from knowledge.chunk_vectors cv
  join knowledge.chunks c on c.id = cv.chunk_id
  where c.tenant_id = p_tenant_id
    and cv.embedding is not null
  order by cv.embedding <=> p_query_embedding
  limit p_match_count;
end;
$$;

-- ============================================================
-- Seed the default single tenant
-- ============================================================
insert into shared.tenants (id, name)
values ('00000000-0000-0000-0000-000000000001', 'default')
on conflict (id) do nothing;