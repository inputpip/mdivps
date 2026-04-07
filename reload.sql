GRANT SELECT ON public.v_realisasi_penjualan TO authenticated, anon;
GRANT SELECT ON public.v_kalkulasi_komisi TO authenticated, anon;
NOTIFY pgrst, 'reload schema';
