create extension if not exists pgcrypto;
create extension if not exists vector;

create schema if not exists shared;
create schema if not exists ingestion;
create schema if not exists knowledge;
create schema if not exists agent;

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