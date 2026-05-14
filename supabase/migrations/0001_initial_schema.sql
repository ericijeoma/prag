-- ============================================================
-- Prag — Initial Schema (Canonical Consolidated Migration)
--
-- Consolidated from:
--   - supabase/migrations/0001_init.sql
--   - supabase/migrations/0002_rls_and_match_chunks.sql
--   - supabase/migrations/0003_public_rpc_and_health.sql
--   - supabase/migrations/20260514080756_remote_schema.sql
--
-- Notes:
--   * 0002 supersedes 0001 for table/rls/index definitions.
--   * The pgvector extension is installed into the `extensions` schema.
--   * This migration is written to be idempotent (safe to re-run).
--   * No DROP statements are used except policy drops (required for idempotency).
-- ============================================================

-- ============================================================
-- Extensions (idempotent)
-- ============================================================

-- Supabase typically has this schema; create defensively for clean installs.
create schema if not exists extensions;

create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;

-- ============================================================
-- Schemas (idempotent)
-- ============================================================

-- shared: cross-cutting, multi-tenant primitives shared by all domains.
create schema if not exists shared;
comment on schema shared is 'Cross-cutting, multi-tenant primitives and shared reference data.';

-- ingestion: ingestion pipeline state (jobs, processing lifecycle).
create schema if not exists ingestion;
comment on schema ingestion is 'Ingestion pipeline state, including asynchronous job tracking.';

-- knowledge: core knowledge store (documents, chunks, embeddings).
create schema if not exists knowledge;
comment on schema knowledge is 'Knowledge store: documents, chunks, embeddings, and retrieval primitives.';

-- agent: agent execution tracking (runs, citations).
create schema if not exists agent;
comment on schema agent is 'Agent execution domain: runs, reasoning artifacts, and citations.';

-- public: PostgREST-exposed RPC wrappers for controlled multi-schema access.
create schema if not exists public;
comment on schema public is 'PostgREST-exposed RPC wrappers for controlled access to private schemas.';

-- Keep unqualified `vector` references (from 0002/0003) resolvable during
-- object creation. (We still schema-qualify `extensions.vector` where required.)
set search_path = public, extensions;

-- ============================================================
-- Tables (canonical from 0002; idempotent)
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
  -- Phase 2: hierarchical chunking
  parent_chunk_id uuid,
  created_at timestamptz not null default now(),
  constraint chunks_document_tenant_fk
    foreign key (document_id, tenant_id)
    references knowledge.documents (id, tenant_id)
    on delete cascade,
  constraint chunks_id_tenant_unique unique (id, tenant_id),
  constraint chunks_parent_chunk_fk
    foreign key (parent_chunk_id)
    references knowledge.chunks (id)
    on delete set null
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
    on delete cascade,
  constraint ingestion_jobs_status_check
    check (status in ('pending','processing','completed','failed'))
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

  -- Tenant-safe FKs prevent citations pointing across tenants.
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
-- Idempotent “schema drift” fixes (safe to re-run)
-- ============================================================

-- Ensure Phase 2 column exists even if an older schema is present.
alter table knowledge.chunks
  add column if not exists parent_chunk_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'knowledge'
      and t.relname = 'chunks'
      and c.conname = 'chunks_parent_chunk_fk'
  ) then
    alter table knowledge.chunks
      add constraint chunks_parent_chunk_fk
      foreign key (parent_chunk_id)
      references knowledge.chunks (id)
      on delete set null;
  end if;
end$$;

-- Ensure ingestion status constraint exists (older schemas may not have it).
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'ingestion'
      and t.relname = 'jobs'
      and c.conname = 'ingestion_jobs_status_check'
  ) then
    alter table ingestion.jobs
      add constraint ingestion_jobs_status_check
      check (status in ('pending','processing','completed','failed'));
  end if;
end$$;

-- ============================================================
-- Indexes for performance (canonical from 0002 + required HNSW)
-- ============================================================

create index if not exists idx_documents_tenant_id
  on knowledge.documents (tenant_id);

create index if not exists idx_chunks_tenant_document
  on knowledge.chunks (tenant_id, document_id);

create index if not exists idx_chunk_vectors_tenant
  on knowledge.chunk_vectors (tenant_id);

-- Required HNSW index definition (matches remote schema exactly), created idempotently.
-- Replace the DO block with this simplified idempotent command
CREATE INDEX IF NOT EXISTS idx_chunk_vectors_embedding_hnsw 
ON knowledge.chunk_vectors 
USING hnsw (embedding extensions.vector_cosine_ops);

create index if not exists idx_agent_runs_tenant
  on agent.runs (tenant_id);

create index if not exists idx_ingestion_jobs_tenant_status
  on ingestion.jobs (tenant_id, status);

-- ============================================================
-- Row Level Security (copied from 0002 exactly)
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
-- Functions
--   - knowledge.match_chunks: from 0002, adapted to extensions.vector
--   - public.* RPC wrappers: from 0003 (healthcheck updated per requirements)
-- ============================================================

create or replace function knowledge.match_chunks(
  p_tenant_id uuid,
  p_query_embedding extensions.vector(384),
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
-- Public RPC wrappers for multi-schema access via PostgREST
-- (from 0003; keep signatures/behavior, but ensure vector type is resolvable)
-- ============================================================

create or replace function public.prag_insert_document(
  p_tenant_id uuid,
  p_title text,
  p_content text,
  p_metadata jsonb default '{}'::jsonb,
  p_file_path text default null,
  p_source_type text default 'upload'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into knowledge.documents (
    tenant_id,
    title,
    content,
    metadata,
    file_path,
    source_type
  )
  values (
    p_tenant_id,
    p_title,
    p_content,
    coalesce(p_metadata, '{}'::jsonb),
    p_file_path,
    coalesce(p_source_type, 'upload')
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.prag_insert_chunk(
  p_tenant_id uuid,
  p_document_id uuid,
  p_chunk_index int,
  p_chunk_text text,
  p_chunk_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into knowledge.chunks (
    tenant_id,
    document_id,
    chunk_index,
    chunk_text,
    chunk_metadata
  )
  values (
    p_tenant_id,
    p_document_id,
    p_chunk_index,
    p_chunk_text,
    coalesce(p_chunk_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.prag_insert_chunk_vector(
  p_tenant_id uuid,
  p_chunk_id uuid,
  p_embedding vector(384)
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into knowledge.chunk_vectors (
    tenant_id,
    chunk_id,
    embedding
  )
  values (
    p_tenant_id,
    p_chunk_id,
    p_embedding
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.prag_match_chunks(
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
language sql
stable
security definer
set search_path = public
as $$
  select *
  from knowledge.match_chunks(
    p_tenant_id => p_tenant_id,
    p_query_embedding => p_query_embedding,
    p_match_count => p_match_count
  );
$$;

create or replace function public.prag_healthcheck()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_shared boolean;
  v_has_ingestion boolean;
  v_has_knowledge boolean;
  v_has_agent boolean;
  v_has_pgvector boolean;
  v_has_match_chunks boolean;
  v_has_parent_chunk_id boolean;
begin
  select exists(select 1 from pg_namespace where nspname = 'shared') into v_has_shared;
  select exists(select 1 from pg_namespace where nspname = 'ingestion') into v_has_ingestion;
  select exists(select 1 from pg_namespace where nspname = 'knowledge') into v_has_knowledge;
  select exists(select 1 from pg_namespace where nspname = 'agent') into v_has_agent;

  select exists(select 1 from pg_extension where extname = 'vector') into v_has_pgvector;

  select exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'knowledge'
      and p.proname = 'match_chunks'
  ) into v_has_match_chunks;

  -- Phase 2 readiness: ensure hierarchical chunking column is present.
  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'knowledge'
      and table_name = 'chunks'
      and column_name = 'parent_chunk_id'
  ) into v_has_parent_chunk_id;

  return jsonb_build_object(
    'ok', (v_has_shared and v_has_ingestion and v_has_knowledge and v_has_agent and v_has_pgvector and v_has_match_chunks and v_has_parent_chunk_id),
    'schemas', jsonb_build_object(
      'shared', v_has_shared,
      'ingestion', v_has_ingestion,
      'knowledge', v_has_knowledge,
      'agent', v_has_agent
    ),
    'extensions', jsonb_build_object(
      'pgvector', v_has_pgvector
    ),
    'rpcs', jsonb_build_object(
      'knowledge.match_chunks', v_has_match_chunks,
      'public.prag_match_chunks', true,
      'public.prag_insert_document', true,
      'public.prag_insert_chunk', true,
      'public.prag_insert_chunk_vector', true
    ),
    'columns', jsonb_build_object(
      'knowledge.chunks.parent_chunk_id', v_has_parent_chunk_id
    )
  );
end;
$$;

-- ============================================================
-- Permissions (copied from 0003 exactly)
-- ============================================================

revoke all on function public.prag_insert_document(uuid, text, text, jsonb, text, text) from public;
revoke all on function public.prag_insert_chunk(uuid, uuid, int, text, jsonb) from public;
revoke all on function public.prag_insert_chunk_vector(uuid, uuid, vector) from public;
revoke all on function public.prag_match_chunks(uuid, vector, int) from public;
revoke all on function public.prag_healthcheck() from public;

grant execute on function public.prag_insert_document(uuid, text, text, jsonb, text, text) to service_role;
grant execute on function public.prag_insert_chunk(uuid, uuid, int, text, jsonb) to service_role;
grant execute on function public.prag_insert_chunk_vector(uuid, uuid, vector) to service_role;
grant execute on function public.prag_match_chunks(uuid, vector, int) to service_role;
grant execute on function public.prag_healthcheck() to service_role;

-- ============================================================
-- Seed data (copied from 0002 exactly)
-- ============================================================

insert into shared.tenants (id, name)
values ('00000000-0000-0000-0000-000000000001', 'default')
on conflict (id) do nothing;

-- ============================================================
-- PostgREST schema cache reload (copied from 0003 exactly)
-- ============================================================

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    -- If notifications are restricted, ignore; schema will refresh eventually.
    null;
end $$;
