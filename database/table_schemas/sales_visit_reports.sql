-- Create sales_visit_reports table if not exists
CREATE TABLE IF NOT EXISTS public.sales_visit_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    branch_id uuid REFERENCES public.branches(id),
    sales_id uuid REFERENCES public.profiles(id),
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
    notes text,
    latitude double precision,
    longitude double precision,
    photo_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid REFERENCES public.profiles(id)
);

-- Ensure columns exist if table was already created with different structure
ALTER TABLE public.sales_visit_reports ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.sales_visit_reports ADD COLUMN IF NOT EXISTS sales_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.sales_visit_reports ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE public.sales_visit_reports ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.sales_visit_reports ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.sales_visit_reports ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE public.sales_visit_reports ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE public.sales_visit_reports ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id);

-- Explicitly Grant Permissions (Critical for "permission denied" error)
GRANT ALL ON TABLE public.sales_visit_reports TO authenticated;
GRANT ALL ON TABLE public.sales_visit_reports TO anon;
-- service_role removed as it may not exist in all environments

-- Enable RLS
ALTER TABLE public.sales_visit_reports ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies
DROP POLICY IF EXISTS "sales_visit_reports_allow_all" ON public.sales_visit_reports;
CREATE POLICY "sales_visit_reports_allow_all" ON public.sales_visit_reports 
    FOR ALL 
    TO authenticated, anon 
    USING (true) 
    WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sales_visit_reports_branch_id ON public.sales_visit_reports(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_visit_reports_customer_id ON public.sales_visit_reports(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_visit_reports_sales_id ON public.sales_visit_reports(sales_id);
CREATE INDEX IF NOT EXISTS idx_sales_visit_reports_created_at ON public.sales_visit_reports(created_at);
