-- Step 1: Penambahan Kolom Baru (DDL)
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS assigned_driver_id uuid;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_assigned_driver_id_fkey;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_assigned_driver_id_fkey FOREIGN KEY (assigned_driver_id) REFERENCES public.profiles(id);

ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS latitude numeric, ADD COLUMN IF NOT EXISTS longitude numeric;

-- Step 2: Pembuatan Tabel Baru
CREATE TABLE IF NOT EXISTS public.delivery_reports (
      id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
      transaction_id text,
      driver_id uuid,
      status text DEFAULT 'pending'::text,
      notes text,
      photo_url text,
      latitude numeric,
      longitude numeric,
      reported_at timestamp with time zone DEFAULT now(),
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      CONSTRAINT delivery_reports_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id),
      CONSTRAINT delivery_reports_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE
);

ALTER TABLE public.delivery_reports ENABLE ROW LEVEL SECURITY; 

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'delivery_reports' AND policyname = 'delivery_reports_access_policy'
    ) THEN
        CREATE POLICY delivery_reports_access_policy ON public.delivery_reports TO authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Step 3: Pembuatan RPC Functions
CREATE OR REPLACE FUNCTION public.assign_driver_to_transaction(p_transaction_id text, p_driver_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.transactions
    SET assigned_driver_id = p_driver_id,
        updated_at = NOW()
    WHERE id = p_transaction_id;
    
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_delivery_report(p_transaction_id text, p_driver_id uuid, p_status text, p_notes text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_report_id UUID;
BEGIN
    INSERT INTO public.delivery_reports (
        transaction_id, driver_id, status, notes, photo_url, reported_at
    )
    VALUES (
        p_transaction_id, p_driver_id, p_status, p_notes, p_photo_url, NOW()
    )
    RETURNING id INTO v_report_id;
    
    RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_delivery_report(p_transaction_id text, p_driver_id uuid, p_status text, p_notes text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_report_id UUID;
BEGIN
    INSERT INTO public.delivery_reports (
        transaction_id, driver_id, status, notes, photo_url, latitude, longitude, reported_at
    )
    VALUES (
        p_transaction_id, p_driver_id, p_status, p_notes, p_photo_url, p_latitude, p_longitude, NOW()
    )
    RETURNING id INTO v_report_id;
    
    RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.debug_rls_check(p_target_branch_id uuid) RETURNS TABLE(user_id uuid, user_role text, user_branch_id uuid, user_allowed_branches uuid[], target_branch_id uuid, is_owner_admin boolean, matches_primary boolean, matches_allowed boolean, final_result boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_role text;
    v_user_branch_id uuid;
    v_allowed_branches uuid[];
    v_is_owner_admin boolean;
    v_matches_primary boolean;
    v_matches_allowed boolean;
BEGIN
    SELECT role, branch_id, allowed_branches 
    INTO v_role, v_user_branch_id, v_allowed_branches
    FROM public.profiles
    WHERE id = auth.uid();

    v_is_owner_admin := lower(v_role) IN ('owner', 'admin', 'superadmin', 'administrator');
    v_matches_primary := (v_user_branch_id = p_target_branch_id);
    
    IF v_allowed_branches IS NOT NULL THEN
        v_matches_allowed := (p_target_branch_id = ANY(v_allowed_branches));
    ELSE
        v_matches_allowed := false;
    END IF;

    RETURN QUERY SELECT 
        auth.uid(),
        v_role,
        v_user_branch_id,
        v_allowed_branches,
        p_target_branch_id,
        v_is_owner_admin,
        v_matches_primary,
        v_matches_allowed,
        (v_is_owner_admin OR v_matches_primary OR v_matches_allowed);
END;
$$;
