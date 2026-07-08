-- Add void metadata to material_stock_movements so voided usage can stay auditable
-- while being excluded from operational reports.

BEGIN;

ALTER TABLE public.material_stock_movements
  ADD COLUMN IF NOT EXISTS is_voided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS voided_by uuid NULL,
  ADD COLUMN IF NOT EXISTS voided_by_name text NULL,
  ADD COLUMN IF NOT EXISTS void_reason text NULL;

CREATE INDEX IF NOT EXISTS idx_material_stock_movements_not_voided
  ON public.material_stock_movements (is_voided, created_at DESC);

COMMENT ON COLUMN public.material_stock_movements.is_voided IS 'True when the movement has been voided/cancelled and should be excluded from operational reports.';
COMMENT ON COLUMN public.material_stock_movements.voided_at IS 'Timestamp when the movement was voided.';
COMMENT ON COLUMN public.material_stock_movements.voided_by IS 'User id that voided the movement.';
COMMENT ON COLUMN public.material_stock_movements.voided_by_name IS 'Display name of the user that voided the movement.';
COMMENT ON COLUMN public.material_stock_movements.void_reason IS 'Reason for voiding the movement.';

UPDATE public.material_stock_movements
SET is_voided = false
WHERE is_voided IS DISTINCT FROM false;

COMMIT;
