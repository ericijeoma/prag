create extension if not exists "vector" with schema "extensions";

drop extension if exists "pg_net";

drop function if exists "knowledge"."match_chunks"(p_tenant_id uuid, p_query_embedding public.vector, p_match_count integer);

drop function if exists "public"."prag_insert_chunk_vector"(p_tenant_id uuid, p_chunk_id uuid, p_embedding public.vector);

drop function if exists "public"."prag_insert_document"(p_tenant_id uuid, p_title text, p_content text, p_metadata jsonb, p_file_path text, p_source_type text);

drop function if exists "public"."prag_match_chunks"(p_tenant_id uuid, p_query_embedding public.vector, p_match_count integer);

drop index if exists "knowledge"."idx_chunk_vectors_embedding_hnsw";

alter table "knowledge"."chunk_vectors" alter column "embedding" set data type extensions.vector(384) using "embedding"::extensions.vector(384);

drop extension if exists "vector";

CREATE INDEX idx_chunk_vectors_embedding_hnsw ON knowledge.chunk_vectors USING hnsw (embedding extensions.vector_cosine_ops) WITH (m='16', ef_construction='64');

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION knowledge.match_chunks(p_tenant_id uuid, p_query_embedding extensions.vector, p_match_count integer DEFAULT 5)
 RETURNS TABLE(chunk_id uuid, document_id uuid, chunk_index integer, chunk_text text, chunk_metadata jsonb, score double precision)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    c.id as chunk_id,
    c.document_id,
    c.chunk_index,
    c.chunk_text,
    c.chunk_metadata,
    -- The <=> is the cosine distance operator
    1 - (cv.embedding <=> p_query_embedding) as score
  FROM knowledge.chunks c
  JOIN knowledge.chunk_vectors cv ON c.id = cv.chunk_id
  WHERE c.tenant_id = p_tenant_id
  ORDER BY cv.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prag_insert_chunk_vector(p_tenant_id uuid, p_chunk_id uuid, p_embedding extensions.vector)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.prag_insert_document(p_tenant_id text, p_title text, p_content text, p_metadata jsonb DEFAULT '{}'::jsonb, p_file_path text DEFAULT NULL::text, p_source_type text DEFAULT 'upload'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.prag_match_chunks(p_tenant_id text, p_query_embedding extensions.vector, p_match_count integer DEFAULT 5)
 RETURNS TABLE(chunk_id uuid, document_id uuid, chunk_index integer, chunk_text text, chunk_metadata jsonb, score double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'knowledge', 'extensions', 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        c.id as chunk_id,
        c.document_id,
        c.chunk_index,
        c.chunk_text,
        c.chunk_metadata,
        -- The <=> cosine operator will now resolve perfectly
        1 - (cv.embedding <=> p_query_embedding) as score
    FROM knowledge.chunks c
    JOIN knowledge.chunk_vectors cv ON c.id = cv.chunk_id
    WHERE c.tenant_id = p_tenant_id::uuid
    ORDER BY cv.embedding <=> p_query_embedding
    LIMIT p_match_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$
;

grant delete on table "ingestion"."jobs" to "anon";

grant insert on table "ingestion"."jobs" to "anon";

grant references on table "ingestion"."jobs" to "anon";

grant select on table "ingestion"."jobs" to "anon";

grant trigger on table "ingestion"."jobs" to "anon";

grant truncate on table "ingestion"."jobs" to "anon";

grant update on table "ingestion"."jobs" to "anon";

grant delete on table "ingestion"."jobs" to "authenticated";

grant insert on table "ingestion"."jobs" to "authenticated";

grant references on table "ingestion"."jobs" to "authenticated";

grant select on table "ingestion"."jobs" to "authenticated";

grant trigger on table "ingestion"."jobs" to "authenticated";

grant truncate on table "ingestion"."jobs" to "authenticated";

grant update on table "ingestion"."jobs" to "authenticated";

grant delete on table "ingestion"."jobs" to "service_role";

grant insert on table "ingestion"."jobs" to "service_role";

grant references on table "ingestion"."jobs" to "service_role";

grant select on table "ingestion"."jobs" to "service_role";

grant trigger on table "ingestion"."jobs" to "service_role";

grant truncate on table "ingestion"."jobs" to "service_role";

grant update on table "ingestion"."jobs" to "service_role";


