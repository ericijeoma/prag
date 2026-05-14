-- ============================================================
-- Public RPC wrappers for multi-schema access via PostgREST
--
-- Why:
-- Supabase PostgREST exposes only selected schemas. When the API doesn't expose
-- `knowledge`, `ingestion`, `agent`, `shared`, calling `.schema('knowledge')`
-- results in: "Invalid schema: knowledge".
--
-- Fix:
-- Provide SECURITY DEFINER functions in `public` that perform schema-qualified
-- operations in the private schemas, and only grant execute to `service_role`.
-- ============================================================

-- Ensure public schema exists (it will, but keep idempotent)
create schema if not exists public;

-- ============================================================
-- Inserts
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

-- ============================================================
-- Similarity search wrapper
-- ============================================================

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

-- ============================================================
-- Healthcheck RPC
-- ============================================================

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

  return jsonb_build_object(
    'ok', (v_has_shared and v_has_ingestion and v_has_knowledge and v_has_agent and v_has_pgvector and v_has_match_chunks),
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
    )
  );
end;
$$;

-- ============================================================
-- Lock down execute permissions (service-role only)
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
-- PostgREST schema cache reload
-- ============================================================
-- Ensure new/updated RPCs are visible immediately to PostgREST.
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    -- If notifications are restricted, ignore; schema will refresh eventually.
    null;
end $$;
