# Roadmap Perbaikan Sistem Jurnal Atomic 🚀

Dokumen ini merangkum daftar modul yang masih memiliki celah keamanan (risiko nomor jurnal duplikat) dan langkah-langkah yang diperlukan untuk memperbaikinya agar setara dengan standar keamanan Modul Penjualan (v4.6).

## 📌 Status Terakhir (2026-02-10)
- **Sudah Aman (v4.6+):** Penjualan, Payroll, Panjar Karyawan, Pembayaran Komisi.
- **Masih Berisiko (Legacy Logic):** Produksi, Stok Opname, Pembayaran Piutang, Zakat, & Pajak.

---

## 🛠 Daftar Modul yang Harus Diperbarui

### 1. Modul Produksi (`04_production.sql`)
*   **Target Fungsi:** `create_production_record_atomic` (atau fungsi utama produksi).
*   **Masalah:** Menggunakan `MAX(entry_number)` manual. Jika produksi dicatat bersamaan, salah satu akan gagal (Duplicate Key).
*   **Langkah Update:**
    *   Hapus logika `v_entry_number` manual.
    *   Siapkan variabel `v_journal_lines` dalam format JSONB.
    *   Panggil `public.create_journal_atomic` untuk membuat header dan line jurnal sekaligus.

### 2. Modul Stok Opname & Penyesuaian (`14_stock_adjustment.sql`)
*   **Target Fungsi:** `create_stock_adjustment_rpc` dan `create_production_journal_rpc`.
*   **Masalah:** Logika `COUNT(*) + 1` sering meleset jika ada transaksi di detik yang sama.
*   **Langkah Update:** Migrasikan ke `create_journal_atomic`. Pastikan tipe referensi dicatat sebagai `'adjustment'`.

### 3. Modul Pembayaran Piutang (`09_receivable_payable.sql`)
*   **Target Fungsi:** `pay_receivable_complete_rpc`.
*   **Masalah:** Menggunakan prefix `JE-PAY-` dengan angka random. Angka random tetap punya peluang tabrakan (collission).
*   **Langkah Update:** Ubah agar mengikuti format global `JE-YYYYMMDD-XXXX` melalui `create_journal_atomic`.

### 4. Modul Zakat & Pajak (`17_zakat.sql` & `27_tax.sql`)
*   **Masalah:** Pola jurnal manual yang identik dengan modul Panjar (sebelum diperbaiki).
*   **Langkah Update:** Refactor sederhana untuk menggunakan fungsi jurnal terpusat.

---

## 📋 Prosedur Standar Perbaikan (Template)

Untuk setiap fungsi di atas, ikuti pola berikut:

1.  **Hapus** variabel `v_entry_number`.
2.  **Tambahkan** variabel `v_journal_res RECORD` dan `v_journal_lines JSONB`.
3.  **Susun** baris jurnal ke dalam JSONB:
    ```sql
    v_journal_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_debit_acc, 'debit_amount', v_amt, 'credit_amount', 0, 'description', '...'),
      jsonb_build_object('account_id', v_credit_acc, 'debit_amount', 0, 'credit_amount', v_amt, 'description', '...')
    );
    ```
4.  **Eksekusi** melalui fungsi atomic:
    ```sql
    SELECT * INTO v_journal_res FROM public.create_journal_atomic(
      p_branch_id, v_desc, v_ref_type, v_ref_id, v_journal_lines, v_date, TRUE
    );
    ```
5.  **Validasi** hasil rpc:
    ```sql
    IF NOT v_journal_res.success THEN
       RETURN QUERY SELECT FALSE, ..., v_journal_res.error_message;
       RETURN;
    END IF;
    ```

---

## 📅 Catatan untuk Sesi Berikutnya
- Prioritaskan **Modul Produksi** karena intensitas penggunaannya tinggi.
- Setelah semua file SQL diperbarui, lakukan upload massal ke VPS (Nabire & Manokwari) dan restart PostgREST.

**Selamat beristirahat!** ☕
