-- =====================================================
-- 22 RLS SECURITY
-- Generated: 2026-01-09T00:29:07.866Z
-- Total functions: 4
-- =====================================================

-- Functions in this file:
--   disable_rls
--   enable_rls
--   get_rls_policies
--   get_rls_status

-- =====================================================
-- Function: disable_rls
-- =====================================================
CREATE OR REPLACE FUNCTION public.disable_rls(table_name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
BEGIN
  -- Check if user has permission (only owner role)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only owner can manage RLS settings';
  END IF;
  -- Disable RLS on the specified table
  EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', table_name);
  
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to disable RLS on table %: %', table_name, SQLERRM;
END;
$function$;


-- =====================================================
-- Function: enable_rls
-- =====================================================
CREATE OR REPLACE FUNCTION public.enable_rls(table_name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
BEGIN
  -- Check if user has permission (only owner role)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only owner can manage RLS settings';
  END IF;
  -- Enable RLS on the specified table
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to enable RLS on table %: %', table_name, SQLERRM;
END;
$function$;


-- =====================================================
-- Function: get_rls_policies
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_rls_policies(table_name text DEFAULT NULL::text) RETURNS TABLE(schema_name text, table_name text, policy_name text, cmd text, roles text, qual text)
    LANGUAGE sql SECURITY DEFINER
    AS $function$
  SELECT 
    schemaname::text as schema_name,
    tablename::text as table_name,
    policyname::text as policy_name,
    cmd::text,
    array_to_string(roles, ', ')::text as roles,
    qual::text
  FROM pg_policies 
  WHERE schemaname = 'public'
    AND (table_name IS NULL OR tablename = table_name)
  ORDER BY tablename, policyname;
$function$;


-- =====================================================
-- Function: get_rls_status
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_rls_status() RETURNS TABLE(schema_name text, table_name text, rls_enabled boolean)
    LANGUAGE sql SECURITY DEFINER
    AS $function$
  SELECT 
    schemaname::text as schema_name,
    tablename::text as table_name,
    rowsecurity as rls_enabled
  FROM pg_tables 
  WHERE schemaname = 'public'
  ORDER BY tablename;
$function$;


