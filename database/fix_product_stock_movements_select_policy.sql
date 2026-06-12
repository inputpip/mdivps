-- Fix stock report access to product_stock_movements.
-- Root cause: RLS is enabled on product_stock_movements but no SELECT policy exists,
-- so authenticated app users get an empty result set during stock report generation.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_stock_movements'
      AND policyname = 'product_stock_movements_allow_all'
  ) THEN
    CREATE POLICY product_stock_movements_allow_all
      ON public.product_stock_movements
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
