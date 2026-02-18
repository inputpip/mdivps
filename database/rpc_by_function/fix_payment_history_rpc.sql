-- Drop potential overloaded signatures to resolve ambiguity
DROP FUNCTION IF EXISTS public.get_payment_history_rpc(uuid, integer, date, date, text);
DROP FUNCTION IF EXISTS public.get_payment_history_rpc(uuid, integer, date, date, text, text);

-- Recreate the function with all parameters
CREATE OR REPLACE FUNCTION public.get_payment_history_rpc(
    p_branch_id uuid, 
    p_limit integer DEFAULT 100, 
    p_date_from date DEFAULT NULL, 
    p_date_to date DEFAULT NULL, 
    p_account_id text DEFAULT NULL,
    p_search_query text DEFAULT NULL
)
 RETURNS TABLE(id uuid, payment_date timestamp with time zone, amount numeric, transaction_id text, customer_name text, payment_method text, notes text, account_name text, user_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        ph.id,
        ph.payment_date,
        ph.amount,
        ph.transaction_id,
        COALESCE(t.customer_name, 'Non-transaction Payment') as customer_name,
        ph.payment_method,
        ph.notes,
        COALESCE(a.name, 'Kas Besar') as account_name,
        COALESCE(pr.full_name, ph.recorded_by_name, 'System') as user_name,
        ph.created_at
    FROM payment_history ph
    LEFT JOIN transactions t ON ph.transaction_id = t.id
    LEFT JOIN accounts a ON ph.account_id = a.id
    LEFT JOIN profiles pr ON ph.recorded_by = pr.id
    WHERE ph.branch_id = p_branch_id
      AND (p_date_from IS NULL OR DATE(ph.payment_date) >= p_date_from)
      AND (p_date_to IS NULL OR DATE(ph.payment_date) <= p_date_to)
      AND (p_account_id IS NULL OR p_account_id = 'all' OR ph.account_id = p_account_id)
      -- Search Condition
      AND (p_search_query IS NULL OR p_search_query = '' OR 
           ph.transaction_id ILIKE '%' || p_search_query || '%' OR 
           t.customer_name ILIKE '%' || p_search_query || '%' OR
           ph.notes ILIKE '%' || p_search_query || '%')
    ORDER BY ph.payment_date DESC
    LIMIT p_limit;
END;
$function$
;
