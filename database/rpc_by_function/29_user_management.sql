-- =====================================================
-- 29 USER MANAGEMENT
-- Generated: 2026-01-09T00:29:07.868Z
-- Total functions: 1
-- =====================================================

-- Functions in this file:
--   handle_new_user

-- =====================================================
-- Function: handle_new_user
-- =====================================================
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, status)
  VALUES (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    new.raw_user_meta_data ->> 'role',
    new.raw_user_meta_data ->> 'status'
  );
  RETURN new;
END;
$function$;


