-- =============================================
-- 02_create_matahari_objects.sql
-- Create missing Matahari objects in aquvit_new and mkw_db
-- authenticated-only (no anon)
-- Idempotent using IF NOT EXISTS where possible
-- Run after RLS cleanup
-- Date: 2026-07-09
-- =============================================

-- Note: This is a template. In real execution we should extract exact DDL from matahari using pg_dump --schema-only or \d+ 

DO $$
BEGIN
    RAISE NOTICE 'Creating Matahari objects in % with authenticated-only policy', current_database();

    -- Example for company_documents (adjust with exact DDL from matahari)
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'company_documents' AND relnamespace = 'public'::regnamespace) THEN
        CREATE TABLE public.company_documents (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            branch_id uuid NOT NULL,
            name text NOT NULL,
            description text,
            file_name text,
            file_type text,
            file_size bigint,
            file_data bytea,
            category text,
            created_at timestamptz DEFAULT now(),
            created_by uuid,
            updated_at timestamptz DEFAULT now()
        );
        RAISE NOTICE 'Created table company_documents';
    END IF;

    -- Add RLS + authenticated policy (no anon)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_documents' AND policyname = 'company_documents_allow_authenticated') THEN
        ALTER TABLE public.company_documents ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "company_documents_allow_authenticated" ON public.company_documents
            FOR ALL TO authenticated USING (true) WITH CHECK (true);
        RAISE NOTICE 'Added authenticated RLS policy on company_documents';
    END IF;

    -- Similar pattern for other tables: expense_category_mapping, material_payments, etc.
    -- RPC pay_debt_installment_atomic should be created with exact body from matahari

    RAISE NOTICE 'Object creation template completed for %', current_database();
END $$;

-- TODO: Replace with exact DDL extracted from matahari using:
-- pg_dump -d matahari --schema-only -t company_documents -t expense_category_mapping ...

