-- =====================================================
-- 19 EMPLOYEE
-- Generated: 2026-01-09T00:29:07.865Z
-- Total functions: 2
-- =====================================================

-- Functions in this file:
--   deactivate_employee
--   update_profiles_updated_at

-- =====================================================
-- Function: deactivate_employee
-- =====================================================
CREATE OR REPLACE FUNCTION public.deactivate_employee(employee_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
BEGIN
    UPDATE profiles 
    SET status = 'Tidak Aktif', 
        updated_at = NOW()
    WHERE id = employee_id;
END;
$function$;


-- =====================================================
-- Function: update_profiles_updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_profiles_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$function$;


