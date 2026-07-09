-- Backup RLS policies and grants before authenticated-only standardization
-- Run on each DB: matahari, aquvit_new, mkw_db
-- Date: 2026-07-09

SELECT '-- Backup for DB: ' || current_database() as phase;

-- Current policies involving anon
SELECT 'POLICY_ANON' as type, schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies 
WHERE 'anon' = ANY(roles) OR policyname LIKE '%anon%'
ORDER BY schemaname, tablename, policyname;

-- Current grants to anon
SELECT 'GRANT_ANON' as type, table_schema, table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon'
ORDER BY table_schema, table_name, privilege_type;

-- RLS status
SELECT 'RLS_STATUS' as type, relname, relrowsecurity as rls_enabled, relforcerowsecurity as force_rls
FROM pg_class 
WHERE relnamespace = 'public'::regnamespace 
  AND relkind IN ('r','v')
ORDER BY relname;

