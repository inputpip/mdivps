-- =====================================================
-- 28 ATTENDANCE
-- Generated: 2026-01-09T00:29:07.868Z
-- Total functions: 3
-- =====================================================

-- Functions in this file:
--   sync_attendance_checkin
--   sync_attendance_ids
--   sync_attendance_user_id

-- =====================================================
-- Function: sync_attendance_checkin
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_attendance_checkin() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
    -- If check_in_time is provided, use it for check_in
    IF NEW.check_in_time IS NOT NULL AND NEW.check_in IS NULL THEN
        NEW.check_in := NEW.check_in_time;
    -- If check_in is provided, use it for check_in_time
    ELSIF NEW.check_in IS NOT NULL AND NEW.check_in_time IS NULL THEN
        NEW.check_in_time := NEW.check_in;
    END IF;
    
    -- Same for check_out
    IF NEW.check_out_time IS NOT NULL AND NEW.check_out IS NULL THEN
        NEW.check_out := NEW.check_out_time;
    ELSIF NEW.check_out IS NOT NULL AND NEW.check_out_time IS NULL THEN
        NEW.check_out_time := NEW.check_out;
    END IF;
    
    RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: sync_attendance_ids
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_attendance_ids() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
    -- Sync user_id and employee_id
    IF NEW.user_id IS NOT NULL AND NEW.employee_id IS NULL THEN
        NEW.employee_id := NEW.user_id;
    ELSIF NEW.employee_id IS NOT NULL AND NEW.user_id IS NULL THEN
        NEW.user_id := NEW.employee_id;
    END IF;
    
    -- Set date if not provided
    IF NEW.date IS NULL THEN
        NEW.date := CURRENT_DATE;
    END IF;
    
    RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: sync_attendance_user_id
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_attendance_user_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
    -- If date is not provided, set to today
    IF NEW.date IS NULL THEN
        NEW.date := CURRENT_DATE;
    END IF;
    RETURN NEW;
END;
$function$;


