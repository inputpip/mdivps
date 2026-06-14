# Matahari Fokus Percetakan Implementation Plan

> **Untuk Hermes:** implementasi berikut harus menjaga `matahari` tetap terpisah dari repo lama dan dijalankan bertahap dengan verifikasi build di setiap fase.

**Goal:** Mengubah codebase `matahari` dari salinan penuh Aquvit menjadi aplikasi yang fokus ke operasional percetakan, dengan menu, route, integrasi server, dan data model yang lebih sempit.

**Architecture:** Jangan fork logika mode di dalam app lama. Perlakukan `matahari` sebagai produk baru yang lahir dari snapshot Aquvit, lalu pangkas modul non-percetakan sedikit demi sedikit. Fase awal mempertahankan build tetap hidup sambil memisahkan konfigurasi server dan navigasi; fase berikutnya baru membersihkan domain data dan flow bisnis.

**Tech Stack:** Vite + React + TypeScript, React Router, TanStack Query, PostgREST auth flow, Capacitor Android, Tailwind/shadcn UI.

---

## 1. Fakta codebase saat ini

Hasil audit cepat pada repo `matahari`:

- App masih memuat **58 page** warisan Aquvit lintas domain distribusi, sales, keuangan, HR, audit, zakat, pajak, dll.
- `src/App.tsx` masih punya konsep **2 server**:
  - `Aquvit Nabire` → `https://nbx.aquvit.id`
  - `Aquvit Manokwari` → `https://mkw.aquvit.id`
- `src/integrations/supabase/client.ts` masih hardcoded ke domain Aquvit lama dan storage key `aquvit_selected_server`.
- `src/components/layout/Sidebar.tsx` masih menampilkan menu besar campuran operasional distribusi + keuangan + laporan + pengaturan owner.
- `package.json` masih memiliki script build berbasis tenant lama:
  - `build:nabire`
  - `build:manokwari`
  - `apk:nabire`
  - `apk:manokwari`
- Repo masih membawa aset/skrip yang tidak relevan untuk fokus percetakan, termasuk area backup, delivery, retasi, sales mobile, dan laporan keuangan penuh.

**Implikasi:** kita belum perlu langsung rewrite total. Yang paling aman adalah memisahkan dulu "kerangka produk percetakan" dari "warisan fitur Aquvit".

---

## 2. Prinsip perubahan

1. **Matahari adalah produk baru**, bukan mode di dalam Aquvit lama.
2. **Jangan sentuh repo `folder baru` saat refactor `matahari`.**
3. **Build harus tetap hidup setiap fase.** Hindari hapus puluhan file sekaligus tanpa route cleanup lebih dulu.
4. **Pangkas dari permukaan ke inti**:
   - branding + target server
   - route + menu
   - page/domain
   - auth/role/permission
   - schema DB baru
5. **DB percetakan baru** harus diperlakukan sebagai kontrak baru; jangan biarkan UI bergantung diam-diam ke endpoint Aquvit lama.
6. **Pengantaran, retasi, sales lapangan, zakat, pajak, dan akuntansi lengkap** dianggap keluar dari scope default kecuali nanti diputuskan masuk lagi.

---

## 3. Target scope produk percetakan (versi awal)

### In scope inti
- Dashboard percetakan
- Master pelanggan
- Master bahan / kertas / tinta / finishing
- Master produk/jasa cetak
- Estimasi / penawaran
- Pesanan kerja / order produksi
- Status pesanan
- Proses produksi
- Laporan produksi
- Stok bahan baku yang relevan ke percetakan
- Pengaturan perusahaan / user dasar

### Out of scope awal
- Delivery / pengantaran
- Retasi
- POS supir
- Laporan sales lapangan
- Maintenance aset umum non-percetakan
- Zakat / pajak / akuntansi penuh
- Arsip/audit owner yang spesifik Aquvit lama
- Multi-tenant Nabire vs Manokwari sebagai identitas utama produk

---

## 4. Struktur fase implementasi

## Fase 0 — Bekukan baseline dan dokumentasi

**Objective:** memastikan perubahan dilakukan dari baseline yang jelas.

**Files:**
- Create: `docs/plans/2026-06-13-matahari-fokus-percetakan.md`
- Verify: `package.json`
- Verify: `src/App.tsx`
- Verify: `src/components/layout/Sidebar.tsx`
- Verify: `src/integrations/supabase/client.ts`

**Langkah:**
1. Simpan plan ini di repo.
2. Pastikan branch `main` repo `matahari` sudah punya commit dasar `base`.
3. Semua implementasi berikut dilakukan di commit kecil bertahap.

**Verifikasi:**
- File plan tersimpan.
- `git status` bersih atau perubahan hanya dokumentasi yang dipahami.

---

## Fase 1 — Tetapkan identitas produk Matahari

**Objective:** mengganti identitas produk dari Aquvit multi-lokasi menjadi produk percetakan tunggal.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Header.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/hooks/useCompanySettings.ts` *(jika branding masih diambil dari setting lama)*
- Modify: `public/favicon.ico`
- Modify: `index.html`
- Modify: `package.json`

**Perubahan utama:**
1. Ganti label server/produk agar tidak lagi menampilkan `Aquvit Nabire` / `Aquvit Manokwari` sebagai entry utama.
2. Putuskan salah satu pendekatan:
   - **single server hardcoded** untuk fase awal, atau
   - selector baru dengan identitas server percetakan yang relevan.
3. Ganti judul aplikasi, favicon, dan teks identitas ke **Matahari / Percetakan**.
4. Rapikan script build agar tidak memakai naming `nabire` dan `manokwari` lagi.

**Verifikasi:**
- Run: `npm run build`
- Expected: build sukses tanpa referensi branding Aquvit lama di jalur utama.

---

## Fase 2 — Potong navigasi ke menu percetakan saja

**Objective:** sidebar dan route utama hanya menampilkan area yang relevan untuk percetakan.

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`
- Create: `src/config/printMenu.ts` *(disarankan untuk memisahkan definisi menu dari komponen sidebar)*

**Menu target awal:**
- Dashboard
- Pelanggan
- Bahan & Stok
- Produk/Jasa Cetak
- Penawaran
- Pesanan Produksi
- Produksi
- Laporan Produksi
- Pengaturan

**Menu yang disembunyikan lebih dulu:**
- POS
- POS Supir
- Pengantaran
- Lapor Antar
- Retasi
- Absensi
- Pengeluaran & Kasbon
- Akun Keuangan
- Jurnal Umum
- Buku Kas Harian
- Piutang/Hutang versi lama
- Zakat/Pajak
- Audit logs
- Web management
- Company archive
- Sales reports mobile

**Strategi aman:**
1. Sembunyikan route dari menu dulu.
2. Setelah build aman, baru hapus import lazy page yang tidak terpakai.
3. Setelah route bersih, baru hapus file page/domain pendukung.

**Verifikasi:**
- Run: `npm run build`
- Expected: sidebar tampil minimal dan route lama tidak menjadi dependency wajib.

---

## Fase 3 — Tetapkan route inti percetakan

**Objective:** definisikan jalur layar utama yang benar-benar dipertahankan.

**Files:**
- Modify: `src/App.tsx`
- Create: `src/pages/print/PrintDashboardPage.tsx`
- Create: `src/pages/print/PrintOrdersPage.tsx`
- Create: `src/pages/print/PrintProductionReportPage.tsx`
- Optionally modify existing pages:
  - `src/pages/DashboardPage.tsx`
  - `src/pages/ProductionPage.tsx`
  - `src/pages/CustomerPage.tsx`
  - `src/pages/QuotationsPage.tsx`

**Keputusan desain:**
- Untuk fase awal, boleh reuse page lama yang paling dekat.
- Tetapi page baru khusus percetakan sebaiknya mulai ditempatkan di namespace baru:
  - `src/pages/print/*`
  - `src/components/print/*`
  - `src/hooks/print/*`
  - `src/types/print/*`

**Tujuan route akhir minimal:**
- `/`
- `/customers`
- `/materials`
- `/products` atau pengganti dari stok/produk
- `/quotations`
- `/print-orders`
- `/production`
- `/production-report`
- `/settings`

**Verifikasi:**
- Run: `npm run build`
- Manual: cek tiap route inti masih render.

---

## Fase 4 — Bersihkan integrasi server lama dan hardcode tenant Aquvit

**Objective:** memutus ketergantungan identitas aplikasi pada `nbx.aquvit.id` dan `mkw.aquvit.id`.

**Files:**
- Modify: `src/integrations/supabase/client.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/ServerSelector.tsx`
- Search impact:
  - seluruh `src/` untuk `nbx.aquvit.id`
  - seluruh `src/` untuk `mkw.aquvit.id`
  - seluruh `src/` untuk `aquvit_selected_server`
  - seluruh `src/` untuk `VITE_APK_SERVER`

**Perubahan utama:**
1. Ganti storage key ke nama baru, misalnya `matahari_selected_server`.
2. Pindahkan mapping server dari domain Aquvit ke domain/server percetakan baru.
3. Hapus komentar dan fallback yang masih mengarahkan ke MKW default.
4. Audit JWT / auth URL agar tidak diam-diam tetap menunjuk ke server lama.

**Catatan kritis:**
Kalau DB/auth percetakan baru belum siap, fase ini bisa dipecah:
- **4A:** bungkus konfigurasi agar lebih modular.
- **4B:** switch endpoint ke server percetakan saat backend siap.

**Verifikasi:**
- `search_files` untuk string domain lama di `src/` harus menyusut drastis.
- `npm run build` tetap lolos.

---

## Fase 5 — Bentuk domain model percetakan yang eksplisit

**Objective:** jangan lagi memaksa domain percetakan hidup di atas istilah distribusi lama.

**Files kandidat baru:**
- Create: `src/types/print-order.ts`
- Create: `src/types/print-product.ts`
- Create: `src/types/print-material.ts`
- Create: `src/types/production-stage.ts`
- Create: `src/hooks/print/usePrintOrders.ts`
- Create: `src/hooks/print/useProductionStages.ts`
- Create: `src/services/printOrderService.ts`

**Masalah warisan yang perlu dihentikan:**
- istilah `delivery`, `retasi`, `driver`, `sales visit` dipakai untuk kasus yang bukan percetakan
- produk jadi dan bahan baku tercampur model distribusi lama
- laporan produksi masih bercampur dengan laporan stok distribusi

**Output fase ini:**
- model `print_orders`
- model tahapan produksi
- model bahan baku percetakan
- model item pesanan cetak
- status pesanan yang jelas:
  - draft
  - disetujui
  - masuk produksi
  - finishing
  - siap ambil/kirim *(opsional nanti)*
  - selesai
  - batal

---

## Fase 6 — Mapping database baru percetakan

**Objective:** siapkan kontrak data untuk PostgreSQL baru yang fokus percetakan.

**Folder disarankan:**
- Create: `database/matahari/`
- Create: `database/matahari/table_schemas/`
- Create: `database/matahari/rpc/`
- Create: `database/matahari/seeds/`

**Tabel awal yang disarankan:**
- `customers`
- `print_products`
- `print_product_categories`
- `print_materials`
- `print_material_units`
- `print_boms`
- `print_orders`
- `print_order_items`
- `print_order_status_logs`
- `production_jobs`
- `production_job_steps`
- `production_outputs`
- `material_stock_movements`
- `company_settings`
- `profiles`
- `roles`
- `user_roles`

**Catatan desain:**
- Lebih baik pakai nama tabel baru yang eksplisit daripada mendaur ulang seluruh schema Aquvit.
- Kalau perlu migrasi data master dari app lama, buat skrip import terpisah; jangan bikin UI produksi tergantung pada schema distribusi lama.

---

## Fase 7 — Pangkas modul lama yang sudah tidak dipakai

**Objective:** setelah route dan domain baru stabil, hapus warisan yang membebani maintenance.

**Target penghapusan bertahap:**
- `src/pages/Mobile*` yang tidak relevan
- `src/pages/Delivery*`
- `src/pages/Retasi*`
- `src/pages/Sales*` yang murni distribusi
- `src/components/*Delivery*`
- `src/components/*Retasi*`
- `src/components/*Commission*` bila di luar scope
- SQL lama yang hanya relevan ke distribusi/pengantaran

**Aturan aman:**
1. Cari dulu apakah file masih di-import.
2. Hapus satu domain penuh.
3. Jalankan build.
4. Commit.
5. Lanjut ke domain berikutnya.

---

## Fase 8 — Sederhanakan role dan permission

**Objective:** permission sistem menyesuaikan organisasi percetakan, bukan warisan ERP distribusi lengkap.

**Files kandidat:**
- Modify: `src/hooks/usePermissions.ts`
- Modify: `src/hooks/useGranularPermission.ts`
- Modify: `src/contexts/AuthContext.tsx`
- Modify: halaman role/setting bila tetap dipakai

**Role awal disarankan:**
- owner
- admin percetakan
- operator produksi
- customer service / order admin
- gudang bahan
- kasir *(opsional kalau masih ada transaksi pembayaran di app)*

**Permission awal disarankan:**
- customer view/manage
- material view/manage
- product view/manage
- quotation view/manage
- print-order view/manage
- production view/manage
- report view
- settings manage

---

## Fase 9 — Build matrix dan verifikasi rutin

**Objective:** setiap fase punya pintu keluar yang jelas.

**Perintah minimum:**
```bash
npm install
npm run build
npm run lint
```

**Checklist verifikasi setelah setiap fase:**
- build sukses
- route utama render
- sidebar tidak menampilkan menu di luar scope
- tidak ada hardcode domain Aquvit lama di jalur utama
- tidak ada import yatim setelah file dipangkas

---

## 5. Urutan kerja yang saya sarankan

### Tahap A — 1 hari pertama
1. Finalkan plan
2. Ganti `origin` repo agar stabil *(sudah selesai)*
3. Ubah branding Matahari
4. Sembunyikan menu non-percetakan
5. Build dan commit

### Tahap B — 1–2 hari berikutnya
1. Rapikan route inti
2. Buat namespace `print/*`
3. Isolasi endpoint config lama
4. Build dan commit kecil per fase

### Tahap C — setelah backend/DB percetakan siap
1. Mapping auth baru
2. Mapping PostgREST/DB baru
3. Implementasi tabel `print_orders` dan `production_jobs`
4. Migrasi master data yang diperlukan saja

---

## 6. Risiko utama

1. **Refactor terlalu besar sekaligus** → app langsung merah dan sulit dilacak.
2. **Masih pakai endpoint Aquvit lama diam-diam** → terasa berhasil padahal belum benar-benar mandiri.
3. **Reuse nama tabel lama berlebihan** → domain percetakan ikut mewarisi kerumitan distribusi.
4. **Menu disembunyikan tapi dependency belum dihapus** → build tetap berat dan membingungkan.
5. **APK/server selection tidak dibersihkan** → produk baru tetap terasa “mode tempelan”.

---

## 7. Definisi selesai fase awal (MVP refactor)

Fase awal dianggap selesai kalau:

- `matahari` sudah branding percetakan penuh
- `origin` hanya ke repo `inputpip/mdivps` *(sudah selesai)*
- menu utama hanya menampilkan area percetakan
- route pengantaran/retasi/sales mobile tidak lagi muncul di jalur utama
- konfigurasi server tidak lagi mengutamakan Nabire vs Manokwari sebagai identitas produk
- build lolos
- ada fondasi file/namespace baru `print/*`

---

## 8. Langkah implementasi pertama yang paling masuk akal

Kalau langsung lanjut eksekusi, saya sarankan mulai dari 3 perubahan paling aman ini:

1. **Branding + server config rename**
   - `src/App.tsx`
   - `src/integrations/supabase/client.ts`
   - `package.json`

2. **Sidebar/menu fokus percetakan**
   - `src/components/layout/Sidebar.tsx`

3. **Route inti percetakan + nonaktifkan route lama dari jalur utama**
   - `src/App.tsx`

Setelah tiga ini beres, baru lanjut ke domain model dan database baru.

---

## 9. Commit strategy

Disarankan commit kecil seperti ini:

```bash
git commit -m "docs: add matahari print-focus refactor plan"
git commit -m "refactor: rebrand matahari app shell"
git commit -m "refactor: reduce sidebar to print operations"
git commit -m "refactor: isolate print routes"
git commit -m "feat: add initial print domain models"
```

---

## 10. Keputusan penting yang masih perlu dipilih

Sebelum implementasi penuh, kita masih perlu memutuskan:

1. **Single server percetakan dulu atau tetap multi server?**
2. **Pesanan percetakan mau berbasis quotation dahulu atau order langsung?**
3. **Keuangan awal ikut masuk atau ditunda?**
4. **Pengiriman hasil cetak nanti masuk scope atau tetap di luar?**
5. **Master pelanggan lama mau diimpor atau mulai bersih dari DB baru?**

Kalau keputusan ini sudah final, implementasi bisa jauh lebih cepat dan tidak bolak-balik.
