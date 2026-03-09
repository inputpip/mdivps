-- Add is_active column to products table
-- Default all current products to active (true)

ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- Ensure existing products are set to active
UPDATE public.products SET is_active = true WHERE is_active IS NULL;

-- Log the change for reference
COMMENT ON COLUMN public.products.is_active IS 'Status aktif produk. Jika false, produk tidak muncul di POS.';
