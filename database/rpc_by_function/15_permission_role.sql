-- =====================================================
-- 15 PERMISSION ROLE
-- Generated: 2026-01-09T00:29:07.864Z
-- Total functions: 49
-- =====================================================

-- Functions in this file:
--   can_access_branch
--   can_access_pos
--   can_access_settings
--   can_create_advances
--   can_create_customers
--   can_create_employees
--   can_create_expenses
--   can_create_materials
--   can_create_products
--   can_create_quotations
--   can_create_transactions
--   can_delete_customers
--   can_delete_employees
--   can_delete_materials
--   can_delete_products
--   can_delete_transactions
--   can_edit_accounts
--   can_edit_customers
--   can_edit_employees
--   can_edit_materials
--   can_edit_products
--   can_edit_quotations
--   can_edit_transactions
--   can_manage_roles
--   can_view_accounts
--   can_view_advances
--   can_view_customers
--   can_view_employees
--   can_view_expenses
--   can_view_financial_reports
--   can_view_materials
--   can_view_products
--   can_view_quotations
--   can_view_receivables
--   can_view_stock_reports
--   can_view_transactions
--   check_user_permission
--   check_user_permission_all
--   check_user_permission_any
--   get_current_user_role
--   get_user_branch_id
--   get_user_role
--   has_perm
--   has_permission
--   is_admin
--   is_authenticated
--   is_owner
--   is_super_admin
--   validate_branch_access

-- =====================================================
-- Function: can_access_branch
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_access_branch(branch_uuid uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
DECLARE
    user_role TEXT;
    user_branch UUID;
BEGIN
    -- If no branch specified, allow (for shared data)
    IF branch_uuid IS NULL THEN
        RETURN true;
    END IF;
    SELECT role, branch_id INTO user_role, user_branch
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;
    -- Super admins, owners, and head office admins can access all branches
    IF user_role IN ('super_admin', 'head_office_admin', 'owner', 'admin') THEN
        RETURN true;
    END IF;
    -- Regular users can only access their own branch
    RETURN user_branch = branch_uuid;
END;
$function$;


-- =====================================================
-- Function: can_access_pos
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_access_pos() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('pos_access'); END;
$function$;


-- =====================================================
-- Function: can_access_settings
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_access_settings() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('settings_access'); END;
$function$;


-- =====================================================
-- Function: can_create_advances
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_create_advances() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('advances_create'); END;
$function$;


-- =====================================================
-- Function: can_create_customers
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_create_customers() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('customers_create'); END;
$function$;


-- =====================================================
-- Function: can_create_employees
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_create_employees() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('employees_create'); END;
$function$;


-- =====================================================
-- Function: can_create_expenses
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_create_expenses() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('expenses_create'); END;
$function$;


-- =====================================================
-- Function: can_create_materials
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_create_materials() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('materials_create'); END;
$function$;


-- =====================================================
-- Function: can_create_products
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_create_products() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('products_create'); END;
$function$;


-- =====================================================
-- Function: can_create_quotations
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_create_quotations() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('quotations_create'); END;
$function$;


-- =====================================================
-- Function: can_create_transactions
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_create_transactions() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('transactions_create'); END;
$function$;


-- =====================================================
-- Function: can_delete_customers
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_delete_customers() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('customers_delete'); END;
$function$;


-- =====================================================
-- Function: can_delete_employees
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_delete_employees() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('employees_delete'); END;
$function$;


-- =====================================================
-- Function: can_delete_materials
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_delete_materials() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('materials_delete'); END;
$function$;


-- =====================================================
-- Function: can_delete_products
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_delete_products() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('products_delete'); END;
$function$;


-- =====================================================
-- Function: can_delete_transactions
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_delete_transactions() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('transactions_delete'); END;
$function$;


-- =====================================================
-- Function: can_edit_accounts
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_edit_accounts() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('accounts_edit'); END;
$function$;


-- =====================================================
-- Function: can_edit_customers
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_edit_customers() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('customers_edit'); END;
$function$;


-- =====================================================
-- Function: can_edit_employees
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_edit_employees() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('employees_edit'); END;
$function$;


-- =====================================================
-- Function: can_edit_materials
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_edit_materials() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('materials_edit'); END;
$function$;


-- =====================================================
-- Function: can_edit_products
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_edit_products() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('products_edit'); END;
$function$;


-- =====================================================
-- Function: can_edit_quotations
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_edit_quotations() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('quotations_edit'); END;
$function$;


-- =====================================================
-- Function: can_edit_transactions
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_edit_transactions() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('transactions_edit'); END;
$function$;


-- =====================================================
-- Function: can_manage_roles
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_manage_roles() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('role_management'); END;
$function$;


-- =====================================================
-- Function: can_view_accounts
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_accounts() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('accounts_view'); END;
$function$;


-- =====================================================
-- Function: can_view_advances
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_advances() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('advances_view'); END;
$function$;


-- =====================================================
-- Function: can_view_customers
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_customers() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('customers_view'); END;
$function$;


-- =====================================================
-- Function: can_view_employees
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_employees() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('employees_view'); END;
$function$;


-- =====================================================
-- Function: can_view_expenses
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_expenses() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('expenses_view'); END;
$function$;


-- =====================================================
-- Function: can_view_financial_reports
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_financial_reports() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('financial_reports'); END;
$function$;


-- =====================================================
-- Function: can_view_materials
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_materials() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('materials_view'); END;
$function$;


-- =====================================================
-- Function: can_view_products
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_products() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('products_view'); END;
$function$;


-- =====================================================
-- Function: can_view_quotations
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_quotations() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('quotations_view'); END;
$function$;


-- =====================================================
-- Function: can_view_receivables
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_receivables() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('receivables_view'); END;
$function$;


-- =====================================================
-- Function: can_view_stock_reports
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_stock_reports() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('stock_reports'); END;
$function$;


-- =====================================================
-- Function: can_view_transactions
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_view_transactions() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN RETURN has_permission('transactions_view'); END;
$function$;


-- =====================================================
-- Function: check_user_permission
-- =====================================================
CREATE OR REPLACE FUNCTION public.check_user_permission(p_user_id uuid, p_permission text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_role TEXT;
  v_has_permission BOOLEAN := FALSE;
BEGIN
  -- Jika user_id NULL, return FALSE
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  -- Get user role from profiles table (localhost uses profiles, not employees)
  SELECT role INTO v_role
  FROM profiles
  WHERE id = p_user_id AND status = 'Aktif';
  -- Jika user tidak ditemukan atau tidak aktif
  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;
  -- Owner SELALU punya akses penuh
  IF v_role = 'owner' THEN
    RETURN TRUE;
  END IF;
  -- Admin punya semua akses kecuali role_management
  IF v_role = 'admin' AND p_permission != 'role_management' THEN
    RETURN TRUE;
  END IF;
  -- Cek dari role_permissions table
  SELECT (permissions->>p_permission)::BOOLEAN INTO v_has_permission
  FROM role_permissions
  WHERE role_id = v_role;
  RETURN COALESCE(v_has_permission, FALSE);
END;
$function$;


-- =====================================================
-- Function: check_user_permission_all
-- =====================================================
CREATE OR REPLACE FUNCTION public.check_user_permission_all(p_user_id uuid, p_permissions text[]) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_permission TEXT;
BEGIN
  FOREACH v_permission IN ARRAY p_permissions
  LOOP
    IF NOT check_user_permission(p_user_id, v_permission) THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$function$;


-- =====================================================
-- Function: check_user_permission_any
-- =====================================================
CREATE OR REPLACE FUNCTION public.check_user_permission_any(p_user_id uuid, p_permissions text[]) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_permission TEXT;
BEGIN
  FOREACH v_permission IN ARRAY p_permissions
  LOOP
    IF check_user_permission(p_user_id, v_permission) THEN
      RETURN TRUE;
    END IF;
  END LOOP;
  RETURN FALSE;
END;
$function$;


-- =====================================================
-- Function: get_current_user_role
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_current_user_role() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
BEGIN
  RETURN (
    SELECT role 
    FROM public.profiles 
    WHERE id = auth.uid()
  );
END;
$function$;


-- =====================================================
-- Function: get_user_branch_id
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_user_branch_id() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
DECLARE
  v_branch_id UUID;
BEGIN
  -- Get branch_id from profiles table based on auth.uid()
  SELECT branch_id INTO v_branch_id
  FROM profiles
  WHERE id = auth.uid();
  
  RETURN v_branch_id;
END;
$function$;


-- =====================================================
-- Function: get_user_role
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM profiles
  WHERE id = p_user_id AND status = 'Aktif';
  RETURN v_role;
END;
$function$;


-- =====================================================
-- Function: has_perm
-- =====================================================
CREATE OR REPLACE FUNCTION public.has_perm(perm_name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
    jwt_role TEXT;
    perms JSONB;
BEGIN
    -- Get role from JWT claims
    BEGIN
        jwt_role := current_setting('request.jwt.claims', true)::json->>'role';
    EXCEPTION WHEN OTHERS THEN
        jwt_role := NULL;
    END;
    -- No JWT role = deny
    IF jwt_role IS NULL OR jwt_role = '' THEN
        RETURN false;
    END IF;
    -- Owner always has all permissions
    IF jwt_role = 'owner' THEN
        RETURN true;
    END IF;
    -- Get permissions from role_permissions table
    SELECT permissions INTO perms
    FROM role_permissions
    WHERE role_id = jwt_role;
    -- If no permissions found for role, allow basic access (authenticated)
    IF perms IS NULL THEN
        RETURN true;  -- Allow authenticated users with unknown roles
    END IF;
    -- Check 'all' permission first
    IF (perms->>'all')::boolean = true THEN
        RETURN true;
    END IF;
    -- Check specific permission
    RETURN COALESCE((perms->>perm_name)::boolean, false);
END;
$function$;


-- =====================================================
-- Function: has_permission
-- =====================================================
CREATE OR REPLACE FUNCTION public.has_permission(permission_name text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
DECLARE
    user_role TEXT;
    permissions JSONB;
BEGIN
    user_role := auth.role();
    -- If no role or anon, check if there's a valid user_id (authenticated)
    IF user_role IS NULL OR user_role = 'anon' THEN
        -- Check if user is authenticated via auth.uid()
        IF auth.uid() IS NOT NULL THEN
            -- Get role from profiles table
            SELECT role INTO user_role FROM profiles WHERE id = auth.uid();
        END IF;
        -- Still no role? deny access
        IF user_role IS NULL OR user_role = 'anon' THEN
            RETURN false;
        END IF;
    END IF;
    -- Get permissions from role_permissions table
    SELECT rp.permissions INTO permissions
    FROM role_permissions rp
    WHERE rp.role_id = user_role;
    -- If role not found in role_permissions, fallback to roles table
    IF permissions IS NULL THEN
        SELECT r.permissions INTO permissions
        FROM roles r
        WHERE r.name = user_role AND r.is_active = true;
    END IF;
    -- No permissions found, but owner/admin should have access
    IF permissions IS NULL THEN
        IF user_role IN ('owner', 'admin', 'super_admin', 'head_office_admin') THEN
            RETURN true;
        END IF;
        RETURN false;
    END IF;
    -- Check 'all' permission (owner-level access)
    IF (permissions->>'all')::boolean = true THEN
        RETURN true;
    END IF;
    -- Check specific permission
    RETURN COALESCE((permissions->>permission_name)::boolean, false);
END;
$function$;


-- =====================================================
-- Function: is_admin
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;
    RETURN user_role IN ('admin', 'owner');
END;
$function$;


-- =====================================================
-- Function: is_authenticated
-- =====================================================
CREATE OR REPLACE FUNCTION auth.is_authenticated() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
BEGIN
    RETURN auth.uid() IS NOT NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION public.is_authenticated() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
DECLARE
    user_role TEXT;
BEGIN
    -- Check if there's a valid user_id
    IF auth.uid() IS NOT NULL THEN
        RETURN true;
    END IF;
    -- Or if role is not anon
    user_role := auth.role();
    RETURN user_role IS NOT NULL AND user_role != 'anon';
END;
$function$;


-- =====================================================
-- Function: is_owner
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_owner() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;
    RETURN user_role = 'owner';
END;
$function$;


-- =====================================================
-- Function: is_super_admin
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $function$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;
    RETURN user_role IN ('super_admin', 'head_office_admin', 'owner', 'admin');
END;
$function$;


-- =====================================================
-- Function: validate_branch_access
-- =====================================================
CREATE OR REPLACE FUNCTION public.validate_branch_access(p_user_id uuid, p_branch_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_user_branch_id UUID;
  v_role TEXT;
BEGIN
  -- Get user's branch and role from profiles table
  SELECT branch_id, role INTO v_user_branch_id, v_role
  FROM profiles
  WHERE id = p_user_id AND status = 'Aktif';
  -- Owner dan Admin bisa akses semua branch
  IF v_role IN ('owner', 'admin') THEN
    RETURN TRUE;
  END IF;
  -- User lain hanya bisa akses branch sendiri
  RETURN v_user_branch_id = p_branch_id;
END;
$function$;


