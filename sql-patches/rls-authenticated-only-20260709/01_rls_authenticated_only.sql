-- =============================================
-- 01_rls_authenticated_only.sql
-- Standardisasi RLS: authenticated only, cabut akses anon
-- Idempotent - aman dijalankan berkali-kali
-- Run per DB setelah backup
-- Date: 2026-07-09
-- =============================================

DO $$
BEGIN
    RAISE NOTICE '=== Starting authenticated-only RLS cleanup for % ===', current_database();

    -- Drop anon policy on debt_installments if exists
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'debt_installments' 
          AND policyname = 'debt_installments_anon_all'
    ) THEN
        DROP POLICY IF EXISTS "debt_installments_anon_all" ON public.debt_installments;
        RAISE NOTICE 'Dropped policy debt_installments_anon_all';
    ELSE
        RAISE NOTICE 'Policy debt_installments_anon_all already absent';
    END IF;

    -- Revoke anon grants on key tables (idempotent)
    REVOKE ALL ON public.company_documents FROM anon;
    REVOKE ALL ON public.expense_category_mapping FROM anon;
    REVOKE ALL ON public.item_unit_conversions FROM anon;
    REVOKE ALL ON public.material_payments FROM anon;
    REVOKE ALL ON public.sales_commission_settings FROM anon;
    REVOKE ALL ON public.transaction_payments FROM anon;
    REVOKE ALL ON public.v_customer_summaries FROM anon;
    REVOKE ALL ON public.debt_installments FROM anon;

    RAISE NOTICE 'Revoked anon grants on application tables';

    -- Ensure authenticated has proper access (example for main tables)
    -- These are examples - adjust based on existing policies
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.debt_installments TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_unit_conversions TO authenticated;

    RAISE NOTICE 'Granted authenticated access where needed';

    -- Force RLS on quotations for mkw_db if needed (idempotent check)
    IF current_database() = 'mkw_db' THEN
        ALTER TABLE public.quotations FORCE ROW LEVEL SECURITY;
        RAISE NOTICE 'FORCE RLS enabled on quotations in mkw_db';
    END IF;

    RAISE NOTICE '=== RLS authenticated-only cleanup completed for % ===', current_database();
END $$;

-- Verify after run
SELECT '-- Verification query --';
SELECT policyname, roles, cmd 
FROM pg_policies 
WHERE tablename IN ('debt_installments', 'item_unit_conversions') 
  AND schemaname = 'public';

