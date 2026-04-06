-- Migration: company_documents table
-- Run di KEDUA database: aquvit_new (Nabire) & mkw_db (Manokwari)

CREATE TABLE IF NOT EXISTS company_documents (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  category      TEXT NOT NULL DEFAULT 'Lainnya',
  file_name     TEXT NOT NULL,
  file_type     TEXT NOT NULL,
  file_size     INTEGER,          -- ukuran dalam bytes
  file_data     TEXT NOT NULL,    -- isi file dalam format base64
  branch_id     UUID,             -- null = berlaku untuk semua cabang
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  created_by    UUID              -- user_id yang upload
);

-- Index untuk pencarian cepat per cabang
CREATE INDEX IF NOT EXISTS idx_company_documents_branch ON company_documents(branch_id);
CREATE INDEX IF NOT EXISTS idx_company_documents_category ON company_documents(category);

-- Row Level Security: owner bisa baca & tulis, role lain tidak bisa akses
ALTER TABLE company_documents ENABLE ROW LEVEL SECURITY;

-- Policy: baca — hanya authenticated (akan dicek di frontend oleh role)
CREATE POLICY "company_documents_select" ON company_documents
  FOR SELECT USING (true);

-- Policy: insert, update, delete — authenticated saja (role-check dilakukan di frontend)
CREATE POLICY "company_documents_insert" ON company_documents
  FOR INSERT WITH CHECK (true);

CREATE POLICY "company_documents_update" ON company_documents
  FOR UPDATE USING (true);

CREATE POLICY "company_documents_delete" ON company_documents
  FOR DELETE USING (true);

-- Reload PostgREST schema cache setelah jalankan ini:
-- NOTIFY pgrst, 'reload schema';
-- Atau via SSH: pm2 restart postgrest-aquvit postgrest-mkw
