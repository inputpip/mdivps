-- =====================================================
-- 21 AUDIT LOG
-- Generated: 2026-01-09T00:29:07.866Z
-- Total functions: 6
-- =====================================================

-- Functions in this file:
--   audit_profiles_changes
--   cleanup_old_audit_logs
--   create_audit_log
--   enable_audit_for_table
--   get_record_history
--   log_performance

-- =====================================================
-- Function: audit_profiles_changes
-- =====================================================
CREATE OR REPLACE FUNCTION public.audit_profiles_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.create_audit_log(
      'profiles',
      'DELETE',
      OLD.id::TEXT,
      row_to_json(OLD)::JSONB,
      NULL,
      jsonb_build_object('deleted_user_name', OLD.full_name)
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.create_audit_log(
      'profiles',
      'UPDATE',
      NEW.id::TEXT,
      row_to_json(OLD)::JSONB,
      row_to_json(NEW)::JSONB,
      jsonb_build_object('updated_fields', (
        SELECT jsonb_object_agg(key, value)
        FROM jsonb_each(row_to_json(NEW)::JSONB)
        WHERE value != (row_to_json(OLD)::JSONB ->> key)::JSONB
      ))
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public.create_audit_log(
      'profiles',
      'INSERT',
      NEW.id::TEXT,
      NULL,
      row_to_json(NEW)::JSONB,
      jsonb_build_object('new_user_name', NEW.full_name)
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;


-- =====================================================
-- Function: cleanup_old_audit_logs
-- =====================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_audit_logs() RETURNS integer
    LANGUAGE plpgsql
    AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.audit_logs 
  WHERE timestamp < NOW() - INTERVAL '90 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log the cleanup operation
  PERFORM public.create_audit_log(
    'audit_logs',
    'CLEANUP',
    'system',
    NULL,
    jsonb_build_object('deleted_count', deleted_count),
    jsonb_build_object('operation', 'automatic_cleanup')
  );
  
  RETURN deleted_count;
END;
$function$;


-- =====================================================
-- Function: create_audit_log
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_audit_log(p_table_name text, p_operation text, p_record_id text, p_old_data jsonb DEFAULT NULL::jsonb, p_new_data jsonb DEFAULT NULL::jsonb, p_additional_info jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  audit_id UUID;
  current_user_id UUID;
  current_user_role TEXT;
  current_user_email TEXT;
  current_user_name TEXT;
BEGIN
  -- Get current user from JWT claims (PostgREST compatible)
  BEGIN
    current_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    current_user_id := NULL;
  END;
  
  -- Get user info from profiles table (not auth.users)
  IF current_user_id IS NOT NULL THEN
    SELECT p.role, p.email, p.full_name INTO current_user_role, current_user_email, current_user_name
    FROM public.profiles p
    WHERE p.id = current_user_id;
  ELSE
    -- Fallback to JWT role claim
    BEGIN
      current_user_role := current_setting('request.jwt.claims', true)::json->>'role';
    EXCEPTION WHEN OTHERS THEN
      current_user_role := 'unknown';
    END;
  END IF;
  
  -- Insert audit log
  INSERT INTO public.audit_logs (
    table_name,
    operation,
    record_id,
    old_data,
    new_data,
    user_id,
    user_email,
    user_role,
    additional_info
  ) VALUES (
    p_table_name,
    p_operation,
    p_record_id,
    p_old_data,
    p_new_data,
    current_user_id,
    COALESCE(current_user_email, 'system'),
    COALESCE(current_user_role, 'unknown'),
    p_additional_info
  ) RETURNING id INTO audit_id;
  
  RETURN audit_id;
END;
$function$;


-- =====================================================
-- Function: enable_audit_for_table
-- =====================================================
CREATE OR REPLACE FUNCTION public.enable_audit_for_table(target_table text) RETURNS void
    LANGUAGE plpgsql
    AS $function$
DECLARE
  trigger_name text;
BEGIN
  trigger_name := 'audit_trigger_' || target_table;
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, target_table);
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger_func()',
    trigger_name, target_table
  );
  RAISE NOTICE 'Audit trigger enabled for table: %', target_table;
END;
$function$;


-- =====================================================
-- Function: get_record_history
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_record_history(p_table_name text, p_record_id text) RETURNS TABLE(audit_time timestamp with time zone, operation text, user_email text, changed_fields jsonb, old_data jsonb, new_data jsonb)
    LANGUAGE plpgsql
    AS $function$
BEGIN
  RETURN QUERY
  SELECT al.created_at, al.operation, al.user_email, al.changed_fields, al.old_data, al.new_data
  FROM audit_logs al
  WHERE al.table_name = p_table_name AND al.record_id = p_record_id
  ORDER BY al.created_at DESC;
END;
$function$;


-- =====================================================
-- Function: log_performance
-- =====================================================
CREATE OR REPLACE FUNCTION public.log_performance(p_operation_name text, p_duration_ms integer, p_table_name text DEFAULT NULL::text, p_record_count integer DEFAULT NULL::integer, p_query_type text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO public.performance_logs (
    operation_name,
    duration_ms,
    user_id,
    table_name,
    record_count,
    query_type,
    metadata
  ) VALUES (
    p_operation_name,
    p_duration_ms,
    auth.uid(),
    p_table_name,
    p_record_count,
    p_query_type,
    p_metadata
  ) RETURNING id INTO log_id;
  
  RETURN log_id;
END;
$function$;


