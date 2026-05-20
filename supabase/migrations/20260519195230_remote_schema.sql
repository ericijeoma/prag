


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "agent";


ALTER SCHEMA "agent" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "ingestion";


ALTER SCHEMA "ingestion" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "knowledge";


ALTER SCHEMA "knowledge" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "shared";


ALTER SCHEMA "shared" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "knowledge"."match_chunks"("p_tenant_id" "uuid", "p_query_embedding" "extensions"."vector", "p_match_count" integer DEFAULT 5) RETURNS TABLE("chunk_id" "uuid", "document_id" "uuid", "document_title" "text", "chunk_index" integer, "chunk_text" "text", "chunk_metadata" "jsonb", "parent_chunk_id" "uuid", "score" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    c.document_id,
    d.title AS document_title,
    c.chunk_index,
    c.chunk_text,
    c.chunk_metadata,
    c.parent_chunk_id,
    1 - (cv.embedding <=> p_query_embedding) AS score
  FROM knowledge.chunks c
  JOIN knowledge.chunk_vectors cv ON c.id = cv.chunk_id
  JOIN knowledge.documents d ON c.document_id = d.id
  WHERE d.tenant_id = p_tenant_id
  ORDER BY cv.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;


ALTER FUNCTION "knowledge"."match_chunks"("p_tenant_id" "uuid", "p_query_embedding" "extensions"."vector", "p_match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "knowledge"."match_chunks"("p_tenant_id" "uuid", "p_query_embedding" "extensions"."vector", "p_match_count" integer DEFAULT 5, "p_filter" "jsonb" DEFAULT '{}'::"jsonb") RETURNS TABLE("chunk_id" "uuid", "document_id" "uuid", "document_title" "text", "chunk_index" integer, "chunk_text" "text", "chunk_metadata" "jsonb", "parent_chunk_id" "uuid", "score" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    c.document_id,
    d.title AS document_title, -- Added this
    c.chunk_index,
    c.chunk_text,
    c.chunk_metadata,
    c.parent_chunk_id,
    1 - (cv.embedding <=> p_query_embedding) AS score
  FROM knowledge.chunks c
  JOIN knowledge.chunk_vectors cv ON c.id = cv.chunk_id
  JOIN knowledge.documents d ON c.document_id = d.id -- The Join
  WHERE d.tenant_id = p_tenant_id
  ORDER BY cv.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;


ALTER FUNCTION "knowledge"."match_chunks"("p_tenant_id" "uuid", "p_query_embedding" "extensions"."vector", "p_match_count" integer, "p_filter" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_append_session_message"("p_session_key" "text", "p_role" "text", "p_content" "text", "p_query_rewrite" "text" DEFAULT NULL::"text", "p_retrieved_chunk_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_citation_map" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'knowledge', 'public'
    AS $$
declare
  v_session_id uuid;
  v_message_id uuid;
begin
  select id
  into v_session_id
  from knowledge.sessions
  where session_key = p_session_key;

  if v_session_id is null then
    raise exception 'session not found for session_key=%', p_session_key;
  end if;

  insert into knowledge.session_messages (
    session_id,
    role,
    content,
    query_rewrite,
    retrieved_chunk_ids,
    citation_map
  )
  values (
    v_session_id,
    p_role,
    p_content,
    p_query_rewrite,
    coalesce(p_retrieved_chunk_ids, '{}'::uuid[]),
    coalesce(p_citation_map, '{}'::jsonb)
  )
  returning id into v_message_id;

  update knowledge.sessions
  set updated_at = now()
  where id = v_session_id;

  return v_message_id;
end;
$$;


ALTER FUNCTION "public"."prag_append_session_message"("p_session_key" "text", "p_role" "text", "p_content" "text", "p_query_rewrite" "text", "p_retrieved_chunk_ids" "uuid"[], "p_citation_map" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_batch_insert_chunks"("p_tenant_id" "text", "p_chunks" "jsonb"[]) RETURNS TABLE("out_id" "uuid", "out_chunk_index" integer)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  INSERT INTO knowledge.chunks (tenant_id, document_id, chunk_index, chunk_text, chunk_metadata)
  SELECT 
    p_tenant_id::uuid,
    (val->>'document_id')::uuid,
    (val->>'chunk_index')::int,
    (val->>'chunk_text'),
    (val->'chunk_metadata')::jsonb
  FROM unnest(p_chunks) AS val
  RETURNING knowledge.chunks.id, knowledge.chunks.chunk_index;
END;
$$;


ALTER FUNCTION "public"."prag_batch_insert_chunks"("p_tenant_id" "text", "p_chunks" "jsonb"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_create_chat_session"("p_tenant_id" "uuid", "p_trace_id" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO agent.chat_sessions (tenant_id, trace_id)
  VALUES (p_tenant_id, p_trace_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."prag_create_chat_session"("p_tenant_id" "uuid", "p_trace_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_create_ingestion_job"("p_tenant_id" "uuid", "p_document_id" "uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ingestion', 'public'
    AS $$
DECLARE
    v_job_id uuid;
BEGIN
    INSERT INTO ingestion.jobs (tenant_id, document_id, status, metadata)
    VALUES (p_tenant_id, p_document_id, 'PENDING', p_metadata)
    RETURNING id INTO v_job_id;
    RETURN v_job_id;
END;
$$;


ALTER FUNCTION "public"."prag_create_ingestion_job"("p_tenant_id" "uuid", "p_document_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_fail_ingestion_job"("p_trace_id" "text", "p_error_message" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'knowledge', 'public'
    AS $$
  update knowledge.ingestion_jobs
  set
    status = 'failed',
    error_message = p_error_message,
    finished_at = now()
  where trace_id = p_trace_id;
$$;


ALTER FUNCTION "public"."prag_fail_ingestion_job"("p_trace_id" "text", "p_error_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_finish_ingestion_job"("p_trace_id" "text", "p_chunk_count" integer, "p_page_count" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'knowledge', 'public'
    AS $$
  update knowledge.ingestion_jobs
  set
    status = 'completed',
    chunk_count = p_chunk_count,
    page_count = coalesce(p_page_count, page_count),
    finished_at = now()
  where trace_id = p_trace_id;
$$;


ALTER FUNCTION "public"."prag_finish_ingestion_job"("p_trace_id" "text", "p_chunk_count" integer, "p_page_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_get_chat_history"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_limit" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "session_id" "uuid", "role" "text", "content" "text", "trace_id" "text", "citations" "jsonb", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT id, session_id, role, content, trace_id, citations, created_at
  FROM agent.chat_messages
  WHERE tenant_id  = p_tenant_id
    AND session_id = p_session_id
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;


ALTER FUNCTION "public"."prag_get_chat_history"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_healthcheck"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."prag_healthcheck"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_insert_chunk"("p_tenant_id" "uuid", "p_document_id" "uuid", "p_chunk_index" integer, "p_chunk_text" "text", "p_chunk_metadata" "jsonb", "p_parent_chunk_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'knowledge', 'public'
    AS $$
DECLARE
    v_chunk_id uuid;
BEGIN
    INSERT INTO knowledge.chunks (
        tenant_id, document_id, chunk_index, chunk_text, chunk_metadata, parent_chunk_id
    )
    VALUES (
        p_tenant_id, p_document_id, p_chunk_index, p_chunk_text, p_chunk_metadata, p_parent_chunk_id
    )
    RETURNING id INTO v_chunk_id;
    RETURN v_chunk_id;
END;
$$;


ALTER FUNCTION "public"."prag_insert_chunk"("p_tenant_id" "uuid", "p_document_id" "uuid", "p_chunk_index" integer, "p_chunk_text" "text", "p_chunk_metadata" "jsonb", "p_parent_chunk_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_insert_chunk_vector"("p_tenant_id" "uuid", "p_chunk_id" "uuid", "p_embedding" "extensions"."vector") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."prag_insert_chunk_vector"("p_tenant_id" "uuid", "p_chunk_id" "uuid", "p_embedding" "extensions"."vector") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_insert_document"("p_tenant_id" "text", "p_title" "text", "p_content" "text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_file_path" "text" DEFAULT NULL::"text", "p_source_type" "text" DEFAULT 'upload'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_doc_id uuid;
BEGIN
    INSERT INTO knowledge.documents (
        tenant_id, title, content, metadata, file_path, source_type
    )
    VALUES (
        p_tenant_id::uuid, 
        p_title, p_content, p_metadata, p_file_path, p_source_type
    )
    RETURNING id INTO v_doc_id;
    
    RETURN v_doc_id;
END;
$$;


ALTER FUNCTION "public"."prag_insert_document"("p_tenant_id" "text", "p_title" "text", "p_content" "text", "p_metadata" "jsonb", "p_file_path" "text", "p_source_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_log_trace"("p_tenant_id" "uuid", "p_trace_id" "text", "p_event_type" "text", "p_stage" "text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO agent.trace_logs (
    tenant_id, trace_id, event_type, stage, payload
  )
  VALUES (
    p_tenant_id,
    p_trace_id,
    p_event_type,
    p_stage,
    COALESCE(p_payload, '{}'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."prag_log_trace"("p_tenant_id" "uuid", "p_trace_id" "text", "p_event_type" "text", "p_stage" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_match_chunks"("p_tenant_id" "uuid", "p_query_embedding" "extensions"."vector", "p_match_count" integer) RETURNS TABLE("chunk_id" "uuid", "document_id" "uuid", "document_title" "text", "chunk_index" integer, "chunk_text" "text", "parent_text" "text", "page_number" integer, "score" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    d.title,
    c.chunk_index,
    c.chunk_text,
    c.parent_text,
    c.page_number,
    1 - (cv.embedding <=> p_query_embedding) AS score
  FROM knowledge.chunks c
  JOIN knowledge.documents d ON c.document_id = d.id
  JOIN knowledge.chunk_vectors cv ON c.id = cv.chunk_id
  WHERE c.tenant_id = p_tenant_id
  ORDER BY cv.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;


ALTER FUNCTION "public"."prag_match_chunks"("p_tenant_id" "uuid", "p_query_embedding" "extensions"."vector", "p_match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_start_ingestion_job"("p_tenant_id" "uuid", "p_trace_id" "text", "p_source_type" "text", "p_title" "text", "p_page_count" integer DEFAULT NULL::integer) RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'knowledge', 'public'
    AS $$
  insert into knowledge.ingestion_jobs (
    tenant_id,
    trace_id,
    source_type,
    title,
    status,
    page_count,
    chunk_count,
    started_at
  )
  values (
    p_tenant_id,
    p_trace_id,
    p_source_type,
    p_title,
    'running',
    p_page_count,
    0,
    now()
  )
  returning id;
$$;


ALTER FUNCTION "public"."prag_start_ingestion_job"("p_tenant_id" "uuid", "p_trace_id" "text", "p_source_type" "text", "p_title" "text", "p_page_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_store_chat_message"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_role" "text", "p_content" "text", "p_trace_id" "text", "p_citations" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO agent.chat_messages (
    tenant_id, session_id, role, content, trace_id, citations
  )
  VALUES (
    p_tenant_id, p_session_id, p_role, p_content,
    p_trace_id, COALESCE(p_citations, '[]'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."prag_store_chat_message"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_role" "text", "p_content" "text", "p_trace_id" "text", "p_citations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prag_upsert_session"("p_tenant_id" "uuid", "p_session_key" "text", "p_summary" "text" DEFAULT NULL::"text", "p_state" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'knowledge', 'public'
    AS $$
  insert into knowledge.sessions (
    session_key,
    tenant_id,
    summary,
    state,
    updated_at
  )
  values (
    p_session_key,
    p_tenant_id,
    p_summary,
    coalesce(p_state, '{}'::jsonb),
    now()
  )
  on conflict (session_key)
  do update set
    tenant_id = excluded.tenant_id,
    summary = coalesce(excluded.summary, knowledge.sessions.summary),
    state = coalesce(excluded.state, knowledge.sessions.state),
    updated_at = now()
  returning id;
$$;


ALTER FUNCTION "public"."prag_upsert_session"("p_tenant_id" "uuid", "p_session_key" "text", "p_summary" "text", "p_state" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "agent"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "trace_id" "text" NOT NULL,
    "citations" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_messages_role_check" CHECK (("role" = ANY (ARRAY['system'::"text", 'user'::"text", 'assistant'::"text"])))
);


ALTER TABLE "agent"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "agent"."chat_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "trace_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "agent"."chat_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "agent"."citations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "run_id" "uuid" NOT NULL,
    "document_id" "uuid",
    "chunk_id" "uuid",
    "citation_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "agent"."citations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "agent"."runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_query" "text" NOT NULL,
    "plan" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "final_answer" "text",
    "verification" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "agent"."runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "agent"."trace_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "trace_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "stage" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trace_logs_event_type_check" CHECK (("event_type" = ANY (ARRAY['ingest'::"text", 'transform'::"text", 'retrieve'::"text", 'generate'::"text"])))
);


ALTER TABLE "agent"."trace_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ingestion"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "document_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "error_log" "text"
);


ALTER TABLE "ingestion"."jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "knowledge"."chunk_vectors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "chunk_id" "uuid" NOT NULL,
    "embedding" "extensions"."vector"(384) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "knowledge"."chunk_vectors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "knowledge"."chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "chunk_index" integer NOT NULL,
    "chunk_text" "text" NOT NULL,
    "chunk_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_chunk_id" "uuid",
    "parent_text" "text",
    "is_parent" boolean DEFAULT false,
    "page_number" integer,
    "is_child" boolean
);


ALTER TABLE "knowledge"."chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "knowledge"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "file_path" "text",
    "source_type" "text" DEFAULT 'upload'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "knowledge"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "knowledge"."ingestion_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trace_id" "text" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "source_type" "text" DEFAULT 'upload'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "error_message" "text",
    "page_count" integer,
    "chunk_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone
);


ALTER TABLE "knowledge"."ingestion_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "knowledge"."pipeline_traces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trace_id" "text" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "stage" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "knowledge"."pipeline_traces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "knowledge"."session_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "query_rewrite" "text",
    "retrieved_chunk_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "citation_map" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "knowledge"."session_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "knowledge"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_key" "text" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "summary" "text",
    "state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "knowledge"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."traces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trace_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "stage" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "tenant_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."traces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "shared"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "shared"."tenants" OWNER TO "postgres";


ALTER TABLE ONLY "agent"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "agent"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "agent"."citations"
    ADD CONSTRAINT "citations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "agent"."runs"
    ADD CONSTRAINT "runs_id_tenant_unique" UNIQUE ("id", "tenant_id");



ALTER TABLE ONLY "agent"."runs"
    ADD CONSTRAINT "runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "agent"."trace_logs"
    ADD CONSTRAINT "trace_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ingestion"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "knowledge"."chunk_vectors"
    ADD CONSTRAINT "chunk_vectors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "knowledge"."chunks"
    ADD CONSTRAINT "chunks_id_tenant_unique" UNIQUE ("id", "tenant_id");



ALTER TABLE ONLY "knowledge"."chunks"
    ADD CONSTRAINT "chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "knowledge"."documents"
    ADD CONSTRAINT "documents_id_tenant_unique" UNIQUE ("id", "tenant_id");



ALTER TABLE ONLY "knowledge"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "knowledge"."ingestion_jobs"
    ADD CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "knowledge"."ingestion_jobs"
    ADD CONSTRAINT "ingestion_jobs_trace_id_key" UNIQUE ("trace_id");



ALTER TABLE ONLY "knowledge"."pipeline_traces"
    ADD CONSTRAINT "pipeline_traces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "knowledge"."session_messages"
    ADD CONSTRAINT "session_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "knowledge"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "knowledge"."sessions"
    ADD CONSTRAINT "sessions_session_key_key" UNIQUE ("session_key");



ALTER TABLE ONLY "public"."traces"
    ADD CONSTRAINT "traces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "shared"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_agent_runs_tenant" ON "agent"."runs" USING "btree" ("tenant_id");



CREATE INDEX "idx_chat_messages_session" ON "agent"."chat_messages" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "idx_chat_sessions_tenant" ON "agent"."chat_sessions" USING "btree" ("tenant_id");



CREATE INDEX "idx_trace_logs_tenant" ON "agent"."trace_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_trace_logs_trace_id" ON "agent"."trace_logs" USING "btree" ("trace_id");



CREATE INDEX "idx_ingestion_jobs_tenant_status" ON "ingestion"."jobs" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_chunk_vectors_embedding_hnsw" ON "knowledge"."chunk_vectors" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "idx_chunk_vectors_tenant" ON "knowledge"."chunk_vectors" USING "btree" ("tenant_id");



CREATE INDEX "idx_chunks_parent_id" ON "knowledge"."chunks" USING "btree" ("parent_chunk_id");



CREATE INDEX "idx_chunks_tenant_document" ON "knowledge"."chunks" USING "btree" ("tenant_id", "document_id");



CREATE INDEX "idx_documents_tenant_id" ON "knowledge"."documents" USING "btree" ("tenant_id");



CREATE INDEX "idx_ingestion_jobs_trace" ON "knowledge"."ingestion_jobs" USING "btree" ("trace_id", "created_at");



CREATE INDEX "idx_ingestion_jobs_trace_id" ON "knowledge"."ingestion_jobs" USING "btree" ("trace_id");



CREATE INDEX "idx_pipeline_traces_trace" ON "knowledge"."pipeline_traces" USING "btree" ("trace_id", "created_at");



CREATE INDEX "idx_pipeline_traces_trace_id" ON "knowledge"."pipeline_traces" USING "btree" ("trace_id");



CREATE INDEX "idx_session_messages_session_created" ON "knowledge"."session_messages" USING "btree" ("session_id", "created_at");



CREATE INDEX "idx_sessions_key" ON "knowledge"."sessions" USING "btree" ("session_key");



CREATE INDEX "idx_traces_trace_id" ON "public"."traces" USING "btree" ("trace_id");



ALTER TABLE ONLY "agent"."chat_messages"
    ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent"."chat_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "agent"."chat_messages"
    ADD CONSTRAINT "chat_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "shared"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "agent"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "shared"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "agent"."citations"
    ADD CONSTRAINT "citations_chunk_tenant_fk" FOREIGN KEY ("chunk_id", "tenant_id") REFERENCES "knowledge"."chunks"("id", "tenant_id") ON DELETE CASCADE;



ALTER TABLE ONLY "agent"."citations"
    ADD CONSTRAINT "citations_document_tenant_fk" FOREIGN KEY ("document_id", "tenant_id") REFERENCES "knowledge"."documents"("id", "tenant_id") ON DELETE CASCADE;



ALTER TABLE ONLY "agent"."citations"
    ADD CONSTRAINT "citations_run_tenant_fk" FOREIGN KEY ("run_id", "tenant_id") REFERENCES "agent"."runs"("id", "tenant_id") ON DELETE CASCADE;



ALTER TABLE ONLY "agent"."citations"
    ADD CONSTRAINT "citations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "shared"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "agent"."runs"
    ADD CONSTRAINT "runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "shared"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "agent"."trace_logs"
    ADD CONSTRAINT "trace_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "shared"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ingestion"."jobs"
    ADD CONSTRAINT "ingestion_jobs_document_tenant_fk" FOREIGN KEY ("document_id", "tenant_id") REFERENCES "knowledge"."documents"("id", "tenant_id") ON DELETE CASCADE;



ALTER TABLE ONLY "ingestion"."jobs"
    ADD CONSTRAINT "jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "shared"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "knowledge"."chunk_vectors"
    ADD CONSTRAINT "chunk_vectors_chunk_tenant_fk" FOREIGN KEY ("chunk_id", "tenant_id") REFERENCES "knowledge"."chunks"("id", "tenant_id") ON DELETE CASCADE;



ALTER TABLE ONLY "knowledge"."chunk_vectors"
    ADD CONSTRAINT "chunk_vectors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "shared"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "knowledge"."chunks"
    ADD CONSTRAINT "chunks_document_tenant_fk" FOREIGN KEY ("document_id", "tenant_id") REFERENCES "knowledge"."documents"("id", "tenant_id") ON DELETE CASCADE;



ALTER TABLE ONLY "knowledge"."chunks"
    ADD CONSTRAINT "chunks_parent_chunk_id_fkey" FOREIGN KEY ("parent_chunk_id") REFERENCES "knowledge"."chunks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "knowledge"."chunks"
    ADD CONSTRAINT "chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "shared"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "knowledge"."documents"
    ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "shared"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "knowledge"."session_messages"
    ADD CONSTRAINT "session_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "knowledge"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE "agent"."chat_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_messages_tenant_isolation" ON "agent"."chat_messages" TO "service_role" USING (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid")) WITH CHECK (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid"));



ALTER TABLE "agent"."chat_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_sessions_tenant_isolation" ON "agent"."chat_sessions" TO "service_role" USING (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid")) WITH CHECK (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid"));



ALTER TABLE "agent"."citations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "citations_tenant_isolation" ON "agent"."citations" TO "service_role" USING (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid")) WITH CHECK (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid"));



ALTER TABLE "agent"."runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "runs_tenant_isolation" ON "agent"."runs" TO "service_role" USING (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid")) WITH CHECK (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid"));



ALTER TABLE "agent"."trace_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trace_logs_tenant_isolation" ON "agent"."trace_logs" TO "service_role" USING (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid")) WITH CHECK (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid"));



ALTER TABLE "ingestion"."jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "jobs_tenant_isolation" ON "ingestion"."jobs" TO "service_role" USING (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid")) WITH CHECK (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid"));



CREATE POLICY "allow pipeline trace inserts" ON "knowledge"."pipeline_traces" FOR INSERT WITH CHECK (true);



CREATE POLICY "allow pipeline trace reads" ON "knowledge"."pipeline_traces" FOR SELECT USING (true);



ALTER TABLE "knowledge"."chunk_vectors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chunk_vectors_tenant_isolation" ON "knowledge"."chunk_vectors" TO "service_role" USING (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid")) WITH CHECK (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid"));



ALTER TABLE "knowledge"."chunks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chunks_tenant_isolation" ON "knowledge"."chunks" TO "service_role" USING (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid")) WITH CHECK (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid"));



ALTER TABLE "knowledge"."documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "documents_tenant_isolation" ON "knowledge"."documents" TO "service_role" USING (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid")) WITH CHECK (("tenant_id" = ("current_setting"('app.tenant_id'::"text", true))::"uuid"));



ALTER TABLE "knowledge"."ingestion_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "knowledge"."pipeline_traces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "knowledge"."session_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "knowledge"."sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Allow public inserts for worker tracing" ON "public"."traces" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public reads for worker tracing" ON "public"."traces" FOR SELECT USING (true);



ALTER TABLE "public"."traces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "shared"."tenants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenants_service_only" ON "shared"."tenants" TO "service_role" USING (true) WITH CHECK (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "ingestion" TO "anon";
GRANT USAGE ON SCHEMA "ingestion" TO "authenticated";
GRANT USAGE ON SCHEMA "ingestion" TO "service_role";



GRANT USAGE ON SCHEMA "knowledge" TO "anon";
GRANT USAGE ON SCHEMA "knowledge" TO "authenticated";
GRANT USAGE ON SCHEMA "knowledge" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


















































































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "public"."prag_append_session_message"("p_session_key" "text", "p_role" "text", "p_content" "text", "p_query_rewrite" "text", "p_retrieved_chunk_ids" "uuid"[], "p_citation_map" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."prag_append_session_message"("p_session_key" "text", "p_role" "text", "p_content" "text", "p_query_rewrite" "text", "p_retrieved_chunk_ids" "uuid"[], "p_citation_map" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_append_session_message"("p_session_key" "text", "p_role" "text", "p_content" "text", "p_query_rewrite" "text", "p_retrieved_chunk_ids" "uuid"[], "p_citation_map" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."prag_batch_insert_chunks"("p_tenant_id" "text", "p_chunks" "jsonb"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."prag_batch_insert_chunks"("p_tenant_id" "text", "p_chunks" "jsonb"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_batch_insert_chunks"("p_tenant_id" "text", "p_chunks" "jsonb"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prag_create_chat_session"("p_tenant_id" "uuid", "p_trace_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prag_create_chat_session"("p_tenant_id" "uuid", "p_trace_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."prag_create_chat_session"("p_tenant_id" "uuid", "p_trace_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_create_chat_session"("p_tenant_id" "uuid", "p_trace_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."prag_create_ingestion_job"("p_tenant_id" "uuid", "p_document_id" "uuid", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."prag_create_ingestion_job"("p_tenant_id" "uuid", "p_document_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_create_ingestion_job"("p_tenant_id" "uuid", "p_document_id" "uuid", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."prag_fail_ingestion_job"("p_trace_id" "text", "p_error_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."prag_fail_ingestion_job"("p_trace_id" "text", "p_error_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_fail_ingestion_job"("p_trace_id" "text", "p_error_message" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."prag_finish_ingestion_job"("p_trace_id" "text", "p_chunk_count" integer, "p_page_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."prag_finish_ingestion_job"("p_trace_id" "text", "p_chunk_count" integer, "p_page_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_finish_ingestion_job"("p_trace_id" "text", "p_chunk_count" integer, "p_page_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prag_get_chat_history"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prag_get_chat_history"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."prag_get_chat_history"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_get_chat_history"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prag_healthcheck"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prag_healthcheck"() TO "anon";
GRANT ALL ON FUNCTION "public"."prag_healthcheck"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_healthcheck"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prag_insert_chunk"("p_tenant_id" "uuid", "p_document_id" "uuid", "p_chunk_index" integer, "p_chunk_text" "text", "p_chunk_metadata" "jsonb", "p_parent_chunk_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."prag_insert_chunk"("p_tenant_id" "uuid", "p_document_id" "uuid", "p_chunk_index" integer, "p_chunk_text" "text", "p_chunk_metadata" "jsonb", "p_parent_chunk_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_insert_chunk"("p_tenant_id" "uuid", "p_document_id" "uuid", "p_chunk_index" integer, "p_chunk_text" "text", "p_chunk_metadata" "jsonb", "p_parent_chunk_id" "uuid") TO "service_role";






GRANT ALL ON FUNCTION "public"."prag_insert_document"("p_tenant_id" "text", "p_title" "text", "p_content" "text", "p_metadata" "jsonb", "p_file_path" "text", "p_source_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."prag_insert_document"("p_tenant_id" "text", "p_title" "text", "p_content" "text", "p_metadata" "jsonb", "p_file_path" "text", "p_source_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_insert_document"("p_tenant_id" "text", "p_title" "text", "p_content" "text", "p_metadata" "jsonb", "p_file_path" "text", "p_source_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prag_log_trace"("p_tenant_id" "uuid", "p_trace_id" "text", "p_event_type" "text", "p_stage" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prag_log_trace"("p_tenant_id" "uuid", "p_trace_id" "text", "p_event_type" "text", "p_stage" "text", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."prag_log_trace"("p_tenant_id" "uuid", "p_trace_id" "text", "p_event_type" "text", "p_stage" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_log_trace"("p_tenant_id" "uuid", "p_trace_id" "text", "p_event_type" "text", "p_stage" "text", "p_payload" "jsonb") TO "service_role";






GRANT ALL ON FUNCTION "public"."prag_start_ingestion_job"("p_tenant_id" "uuid", "p_trace_id" "text", "p_source_type" "text", "p_title" "text", "p_page_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."prag_start_ingestion_job"("p_tenant_id" "uuid", "p_trace_id" "text", "p_source_type" "text", "p_title" "text", "p_page_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_start_ingestion_job"("p_tenant_id" "uuid", "p_trace_id" "text", "p_source_type" "text", "p_title" "text", "p_page_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prag_store_chat_message"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_role" "text", "p_content" "text", "p_trace_id" "text", "p_citations" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prag_store_chat_message"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_role" "text", "p_content" "text", "p_trace_id" "text", "p_citations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."prag_store_chat_message"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_role" "text", "p_content" "text", "p_trace_id" "text", "p_citations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_store_chat_message"("p_tenant_id" "uuid", "p_session_id" "uuid", "p_role" "text", "p_content" "text", "p_trace_id" "text", "p_citations" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."prag_upsert_session"("p_tenant_id" "uuid", "p_session_key" "text", "p_summary" "text", "p_state" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."prag_upsert_session"("p_tenant_id" "uuid", "p_session_key" "text", "p_summary" "text", "p_state" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prag_upsert_session"("p_tenant_id" "uuid", "p_session_key" "text", "p_summary" "text", "p_state" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";






























GRANT ALL ON TABLE "ingestion"."jobs" TO "anon";
GRANT ALL ON TABLE "ingestion"."jobs" TO "authenticated";
GRANT ALL ON TABLE "ingestion"."jobs" TO "service_role";



GRANT ALL ON TABLE "knowledge"."chunk_vectors" TO "anon";
GRANT ALL ON TABLE "knowledge"."chunk_vectors" TO "authenticated";
GRANT ALL ON TABLE "knowledge"."chunk_vectors" TO "service_role";



GRANT ALL ON TABLE "knowledge"."chunks" TO "anon";
GRANT ALL ON TABLE "knowledge"."chunks" TO "authenticated";
GRANT ALL ON TABLE "knowledge"."chunks" TO "service_role";



GRANT ALL ON TABLE "knowledge"."documents" TO "anon";
GRANT ALL ON TABLE "knowledge"."documents" TO "authenticated";
GRANT ALL ON TABLE "knowledge"."documents" TO "service_role";



GRANT ALL ON TABLE "knowledge"."ingestion_jobs" TO "anon";
GRANT ALL ON TABLE "knowledge"."ingestion_jobs" TO "authenticated";
GRANT ALL ON TABLE "knowledge"."ingestion_jobs" TO "service_role";



GRANT ALL ON TABLE "knowledge"."pipeline_traces" TO "anon";
GRANT ALL ON TABLE "knowledge"."pipeline_traces" TO "authenticated";
GRANT ALL ON TABLE "knowledge"."pipeline_traces" TO "service_role";



GRANT ALL ON TABLE "knowledge"."session_messages" TO "anon";
GRANT ALL ON TABLE "knowledge"."session_messages" TO "authenticated";
GRANT ALL ON TABLE "knowledge"."session_messages" TO "service_role";



GRANT ALL ON TABLE "knowledge"."sessions" TO "anon";
GRANT ALL ON TABLE "knowledge"."sessions" TO "authenticated";
GRANT ALL ON TABLE "knowledge"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."traces" TO "anon";
GRANT ALL ON TABLE "public"."traces" TO "authenticated";
GRANT ALL ON TABLE "public"."traces" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "knowledge" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "knowledge" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "knowledge" GRANT ALL ON TABLES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































