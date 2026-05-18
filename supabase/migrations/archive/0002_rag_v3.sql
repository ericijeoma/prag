-- ============================================================
-- Prag — RAG V3 Upgrade
--
-- Adds:
--  - Hierarchical schema support on knowledge.chunks
--  - Chat memory (agent.chat_sessions, agent.chat_messages)
--  - Traceability (shared.traces + public.prag_log_trace)
--  - Batch insert RPC (public.prag_batch_insert_chunks)
--  - Hierarchical retrieval fields in match_chunks / prag_match_chunks
--
-- This migration is idempotent.
-- ============================================================

set search_path = public, extensions;

-- ============================================================
-- 1) Hierarchical chunk schema fields
-- ============================================================

alter table knowledge.chunks
  add column if not exists parent_text text;

alter table knowledge.chunks
  add column if not exists page_number int;

alter table knowledge.chunks
  add column if not exists is_child boolean not null default false;

create index if not exists idx_chunks_document_page
  on knowledge.chunks (tenant_id, document_id, page_number);

create index if not exists idx_chunks_is_child
  on knowledge.chunks (tenant_id, is_child);

-- ============================================================
-- 2) Traceability: shared.traces + public RPC
-- ============================================================

create table if not exists shared.traces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references shared.tenants(id) on delete cascade,
  trace_id text not null,
  event_type text not null,
  stage text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_traces_tenant_trace
  on shared.traces (tenant_id, trace_id);

alter table shared.traces enable row level security;
drop policy if exists traces_tenant_isolation on shared.traces;
create policy traces_tenant_isolation
  on shared.traces for all to service_role
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create or replace function public.prag_log_trace(
  p_tenant_id uuid,
  p_trace_id text,
  p_event_type text,
  p_stage text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into shared.traces (tenant_id, trace_id, event_type, stage, payload)
  values (
    p_tenant_id,
    coalesce(p_trace_id, ''),
    coalesce(p_event_type, 'unknown'),
    coalesce(p_stage, ''),
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.prag_log_trace(uuid, text, text, text, jsonb) from public;
grant execute on function public.prag_log_trace(uuid, text, text, text, jsonb) to service_role;

-- ============================================================
-- 3) Chat memory tables + RPC
-- ============================================================

create table if not exists agent.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references shared.tenants(id) on delete cascade,
  trace_id text not null,
  created_at timestamptz not null default now(),
  constraint chat_sessions_id_tenant_unique unique (id, tenant_id)
);

create table if not exists agent.chat_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references shared.tenants(id) on delete cascade,
  session_id uuid not null,
  role text not null,
  content text not null,
  trace_id text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint chat_messages_session_tenant_fk
    foreign key (session_id, tenant_id)
    references agent.chat_sessions (id, tenant_id)
    on delete cascade
);

create index if not exists idx_chat_messages_session_time
  on agent.chat_messages (tenant_id, session_id, created_at desc);

alter table agent.chat_sessions enable row level security;
alter table agent.chat_messages enable row level security;

drop policy if exists chat_sessions_tenant_isolation on agent.chat_sessions;
create policy chat_sessions_tenant_isolation
  on agent.chat_sessions for all to service_role
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

drop policy if exists chat_messages_tenant_isolation on agent.chat_messages;
create policy chat_messages_tenant_isolation
  on agent.chat_messages for all to service_role
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create or replace function public.prag_create_chat_session(
  p_tenant_id uuid,
  p_trace_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into agent.chat_sessions (tenant_id, trace_id)
  values (p_tenant_id, coalesce(p_trace_id, ''))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.prag_create_chat_session(uuid, text) from public;
grant execute on function public.prag_create_chat_session(uuid, text) to service_role;

create or replace function public.prag_store_chat_message(
  p_tenant_id uuid,
  p_session_id uuid,
  p_role text,
  p_content text,
  p_trace_id text,
  p_citations jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into agent.chat_messages (tenant_id, session_id, role, content, trace_id, citations)
  values (
    p_tenant_id,
    p_session_id,
    coalesce(p_role, 'user'),
    coalesce(p_content, ''),
    coalesce(p_trace_id, ''),
    coalesce(p_citations, '[]'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.prag_store_chat_message(uuid, uuid, text, text, text, jsonb) from public;
grant execute on function public.prag_store_chat_message(uuid, uuid, text, text, text, jsonb) to service_role;

create or replace function public.prag_get_chat_history(
  p_tenant_id uuid,
  p_session_id uuid,
  p_limit int default 10
)
returns table (
  id uuid,
  session_id uuid,
  role text,
  content text,
  trace_id text,
  citations jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.session_id,
    m.role,
    m.content,
    m.trace_id,
    m.citations,
    m.created_at
  from agent.chat_messages m
  where m.tenant_id = p_tenant_id
    and m.session_id = p_session_id
  order by m.created_at desc
  limit greatest(coalesce(p_limit, 10), 1);
$$;

revoke all on function public.prag_get_chat_history(uuid, uuid, int) from public;
grant execute on function public.prag_get_chat_history(uuid, uuid, int) to service_role;

-- ============================================================
-- 4) Batch insert chunks RPC (keeps O(1) PostgREST subrequests)
-- ============================================================

create or replace function public.prag_batch_insert_chunks(
  p_tenant_id uuid,
  p_chunks jsonb
)
returns table (out_id uuid, out_chunk_index int)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with input_rows as (
    select
      (x->>'document_id')::uuid as document_id,
      (x->>'chunk_index')::int as chunk_index,
      (x->>'chunk_text')::text as chunk_text,
      coalesce((x->'chunk_metadata')::jsonb, '{}'::jsonb) as chunk_metadata,
      nullif((x->>'parent_text')::text, '') as parent_text,
      (x->>'page_number')::int as page_number,
      coalesce((x->>'is_child')::boolean, false) as is_child
    from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) as x
  ), inserted as (
    insert into knowledge.chunks (
      tenant_id,
      document_id,
      chunk_index,
      chunk_text,
      chunk_metadata,
      parent_text,
      page_number,
      is_child
    )
    select
      p_tenant_id,
      r.document_id,
      r.chunk_index,
      r.chunk_text,
      r.chunk_metadata,
      r.parent_text,
      r.page_number,
      r.is_child
    from input_rows r
    returning id, chunk_index
  )
  select inserted.id as out_id, inserted.chunk_index as out_chunk_index
  from inserted
  order by inserted.chunk_index;
end;
$$;

revoke all on function public.prag_batch_insert_chunks(uuid, jsonb) from public;
grant execute on function public.prag_batch_insert_chunks(uuid, jsonb) to service_role;

-- ============================================================
-- 5) Retrieval: include parent_text/page_number/is_child + document title
-- ============================================================

create or replace function knowledge.match_chunks(
  p_tenant_id uuid,
  p_query_embedding extensions.vector(384),
  p_match_count int default 5
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  chunk_index int,
  chunk_text text,
  chunk_metadata jsonb,
  parent_text text,
  page_number int,
  is_child boolean,
  score float
)
language plpgsql
stable
security definer
set search_path = knowledge, public
as $$
begin
  return query
  select
    c.id as chunk_id,
    c.document_id,
    d.title as document_title,
    c.chunk_index,
    c.chunk_text,
    c.chunk_metadata,
    c.parent_text,
    c.page_number,
    c.is_child,
    (1 - (cv.embedding <=> p_query_embedding))::float as score
  from knowledge.chunk_vectors cv
  join knowledge.chunks c on c.id = cv.chunk_id
  join knowledge.documents d on d.id = c.document_id and d.tenant_id = c.tenant_id
  where c.tenant_id = p_tenant_id
    and cv.embedding is not null
  order by cv.embedding <=> p_query_embedding
  limit p_match_count;
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
  document_title text,
  chunk_index int,
  chunk_text text,
  chunk_metadata jsonb,
  parent_text text,
  page_number int,
  is_child boolean,
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

revoke all on function public.prag_match_chunks(uuid, vector, int) from public;
grant execute on function public.prag_match_chunks(uuid, vector, int) to service_role;

-- ============================================================
-- PostgREST schema cache reload
-- ============================================================

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end $$;
