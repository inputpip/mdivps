-- =====================================================
-- 30 STATISTICS
-- Generated: 2026-01-09T00:29:07.868Z
-- Total functions: 1
-- =====================================================

-- Functions in this file:
--   refresh_daily_stats

-- =====================================================
-- Function: refresh_daily_stats
-- =====================================================
CREATE OR REPLACE FUNCTION public.refresh_daily_stats() RETURNS void
    LANGUAGE plpgsql
    AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW public.daily_stats;
END;
$function$;


