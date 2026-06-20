-- Review-only migration for order-based production statuses.
-- Do NOT run automatically. Apply after local UI review if approved.

BEGIN;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transaction_status_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transaction_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'Pesanan Masuk'::text,
        'Antri Produksi'::text,
        'Sedang Produksi'::text,
        'Selesai Produksi'::text,
        'Siap Antar'::text,
        'Diantar Sebagian'::text,
        'Selesai'::text,
        'Dibatalkan'::text
      ]
    )
  );

-- Make finished-production orders visible to delivery queue paths that read direct status.
-- Some older RPCs/views only include 'Siap Antar' / 'Diantar Sebagian'; update those RPCs separately before production rollout.

COMMIT;
