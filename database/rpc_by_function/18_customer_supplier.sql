-- =====================================================
-- 18 CUSTOMER SUPPLIER
-- Generated: 2026-01-09T00:29:07.865Z
-- Total functions: 3
-- =====================================================

-- Functions in this file:
--   generate_supplier_code
--   search_customers
--   set_supplier_code

-- =====================================================
-- Function: generate_supplier_code
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_supplier_code() RETURNS character varying
    LANGUAGE plpgsql
    AS $_$
DECLARE
  new_code VARCHAR(20);
  counter INTEGER;
BEGIN
  -- Get the current max number from existing codes
  SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM 4) AS INTEGER)), 0) + 1
  INTO counter
  FROM suppliers
  WHERE code ~ '^SUP[0-9]+$';
  
  -- Generate new code
  new_code := 'SUP' || LPAD(counter::TEXT, 4, '0');
  
  RETURN new_code;
END;
$_$;


-- =====================================================
-- Function: search_customers
-- =====================================================
CREATE OR REPLACE FUNCTION public.search_customers(search_term text DEFAULT ''::text, limit_count integer DEFAULT 50) RETURNS TABLE(id uuid, name text, phone text, address text, order_count integer, last_order_date timestamp with time zone, total_spent numeric)
    LANGUAGE plpgsql STABLE
    AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.phone,
    c.address,
    c."orderCount",
    MAX(t.order_date) as last_order_date,
    COALESCE(SUM(t.total), 0) as total_spent
  FROM public.customers c
  LEFT JOIN public.transactions t ON c.id = t.customer_id
  WHERE 
    (search_term = '' OR 
     c.name ILIKE '%' || search_term || '%' OR
     c.phone ILIKE '%' || search_term || '%')
  GROUP BY c.id, c.name, c.phone, c.address, c."orderCount"
  ORDER BY c.name
  LIMIT limit_count;
END;
$function$;


-- =====================================================
-- Function: set_supplier_code
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_supplier_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := generate_supplier_code();
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;


