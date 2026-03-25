-- Script untuk menghapus Rule Check lama yang membatasi Jabatan Komisi

-- 1. Hapus batasan lama di tabel commission_entries agar bisa menerima role baru seperti operator, kasir, dll.
ALTER TABLE commission_entries DROP CONSTRAINT IF EXISTS commission_entries_role_check;

-- 2. Hapus juga batasan lama di tabel commission_rules jika ada.
ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_role_check;
