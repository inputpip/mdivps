-- Dry-run wrapper
BEGIN;

-- Isi dari 01_rls_authenticated_only.sql
DO $$
BEGIN
    RAISE NOTICE '=== Starting authenticated-only RLS cleanup for % ===', current_database();

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

    REVOKE ALL ON public.company_documents FROM anon;
    REVOKE ALL ON public.expense_category_mapping FROM anon;
    REVOKE ALL ON public.item_unit_conversions FROM anon;
    REVOKE ALL ON public.material_payments FROM anon;
    REVOKE ALL ON public.sales_commission_settings FROM anon;
    REVOKE ALL ON public.transaction_payments FROM anon;
    REVOKE ALL ON public.v_customer_summaries FROM anon;
    REVOKE ALL ON public.debt_installments FROM anon;

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.debt_installments TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_unit_conversions TO authenticated;

    IF current_database() = 'mkw_db' THEN
        ALTER TABLE public.quotations FORCE ROW LEVEL SECURITY;
        RAISE NOTICE 'FORCE RLS enabled on quotations in mkw_db';
    END IF;

    RAISE NOTICE '=== RLS authenticated-only cleanup completed for % ===', current_database();
END $$;

ROLLBACK;

RAISE NOTICE 'DRY-RUN COMPLETED SUCCESSFULLY for % - All changes rolled back', current_database();
