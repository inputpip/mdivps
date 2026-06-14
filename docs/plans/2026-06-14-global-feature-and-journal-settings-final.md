# Aquvit / Matahari — Final Direction for Global Feature Settings & Journal Settings

> **Untuk Hermes:** jadikan dokumen ini sebagai acuan utama sebelum implementasi lanjutan. Jangan mulai dari hapus fitur massal atau fork flow baru. Mulai dari UI settings, registry config global, gating, lalu journal resolver.

**Goal:** Membangun ERP Aquvit/Matahari yang fleksibel lewat satu konfigurasi app global sehingga fitur bisa dinyalakan/dimatikan dari UI, bagian tampilan bisa disembunyikan, dan jalur jurnal bisa diatur user tanpa edit kode setiap kali kebutuhan bisnis berubah.

**Architecture:** Sistem tetap 1 codebase dan 1 perilaku app-global untuk semua branch. Adaptasi dilakukan lewat 4 lapisan: feature toggle, UI visibility, workflow behavior, dan journal rules. User pertama-tama berinteraksi lewat dua pusat kontrol: `Feature Settings` dan `Journal Settings`. Dari sana, sistem mengatur menu, route, section, field, action, serta policy debit/kredit per event jurnal.

**Tech Stack:** PostgreSQL + PostgREST, React + TypeScript + Vite, TanStack Query, existing Auth/Permissions, existing `company_settings`, existing journal RPC/functions.

---

## 1. Keputusan utama yang dipakai

Arah final yang dipakai adalah:

- tetap **1 codebase**
- tetap **1 config app global**
- tidak memakai framing business profile seperti `printing / distribution / hybrid`
- tidak memakai behavior berbeda per branch untuk fase ini
- perubahan harus dimulai dari **settings UI**, bukan dari hapus route atau rewrite flow besar-besaran
- jurnal tidak diubah bebas manual, tetapi melalui **rule/event yang tervalidasi**

Dengan kata lain:

> target utama adalah **config-driven ERP simplification**

Bukan:
- fork aplikasi baru
- branch-specific feature model
- hardcode hide/show di sidebar tanpa source of truth
- editor jurnal bebas tanpa struktur event

---

## 2. Masalah yang sedang ingin diselesaikan

ERP sekarang masih terlalu statis.

Masalah utamanya:

1. fitur seperti `pengantaran`, `retasi`, `penawaran`, `driver POS`, dan fitur lain masih tertanam di menu/route/section tertentu
2. menonaktifkan fitur belum punya UI resmi yang bisa dipakai user
3. beberapa flow bisnis masih tetap berjalan walau secara kebutuhan bisnis sebenarnya tidak dipakai
4. jurnal masih terlalu bergantung ke jalur RPC/hardcode lama
5. belum ada tempat yang jelas untuk user mengatur apakah event jurnal harus:
   - wajib
   - optional
   - skip
   - reroute
   - manual
6. beberapa tabel/kolom/field di UI seharusnya bisa disembunyikan tanpa harus langsung dihapus dari database

---

## 3. Bentuk solusi yang dipilih

Solusi dibagi menjadi 4 lapisan global:

### A. Feature Settings
Mengatur apakah fitur bisnis hidup atau mati untuk seluruh aplikasi.

Contoh fitur:
- Pengantaran
- Retasi
- Penawaran
- Produksi
- Purchase Order
- Absensi
- Pajak
- Zakat
- Aset & Maintenance

### B. UI Visibility Settings
Mengatur apakah komponen UI tertentu ditampilkan atau disembunyikan.

Komponen yang bisa digate:
- menu
- route
- widget dashboard
- action button
- section halaman
- field form
- kolom tabel

### C. Workflow Rules
Mengatur perilaku bisnis jika fitur hidup/mati.

Contoh:
- jika `Pengantaran = OFF`, transaksi tidak lagi menampilkan jalur input pengantaran
- jika `Penawaran = OFF`, transaksi tidak lagi diarahkan lewat quotation flow
- jika `Retasi = OFF`, menu/route/aksi retasi hilang dan flow distribusi tidak memanggil retasi

### D. Journal Settings
Mengatur rule jurnal per event bisnis.

Contoh:
- event delivery-related di-skip saat fitur delivery nonaktif
- event penjualan tunai tetap required
- event piutang tetap required
- event tertentu diarahkan ke akun debit/kredit lain lewat reroute

---

## 4. Dua pusat kontrol UI yang wajib dibuat dulu

Sebelum ubah behavior besar, aplikasi harus punya 2 tab/pusat kontrol resmi.

## 4.1 Feature Settings
Lokasi paling cocok:
- tab baru di `SettingsPage.tsx`

Fungsi tab ini:
- menampilkan daftar fitur utama dalam bentuk checkbox / switch / card toggle
- menjelaskan dampak fitur bila dinyalakan atau dimatikan
- memberi catatan alasan perubahan
- menjadi sumber kontrol resmi untuk app-global feature toggle

### Bentuk UI yang diinginkan
Setiap item fitur minimal punya:
- nama fitur
- deskripsi singkat
- status aktif / nonaktif
- catatan dampak workflow
- indikator apakah fitur memengaruhi jurnal
- tombol/area “lihat komponen UI terkait”

### Contoh item
#### Pengantaran
- Status: ON / OFF
- Dampak UI:
  - menu Pengantaran
  - route Pengantaran
  - section delivery di detail transaksi
- Dampak jurnal:
  - delivery fee posting
  - delivery release

#### Penawaran
- Status: ON / OFF
- Dampak UI:
  - menu Penawaran
  - route quotation list/new
- Dampak workflow:
  - order langsung ke transaksi tanpa quotation flow

#### Retasi
- Status: ON / OFF
- Dampak UI:
  - menu Retasi
  - route Retasi
- Dampak jurnal:
  - retasi event di-disable

---

## 4.2 Journal Settings
Lokasi paling cocok:
- tab baru di `JournalPage.tsx`
- atau sub-tab di area jurnal

Fungsi tab ini:
- menampilkan daftar event jurnal resmi
- menampilkan policy aktif tiap event
- memungkinkan user mengubah debit/kredit berdasarkan rule yang tervalidasi
- menjadi pusat kontrol jalur jurnal saat fitur berubah

### Bentuk UI yang diinginkan
Journal Settings harus dibangun dalam dua level:

#### Level 1 — Event list / event cards
Menampilkan event seperti:
- Penjualan Tunai
- Penjualan Piutang
- Pelunasan Piutang
- Pengantaran
- Retasi
- Produksi
- Pembelian
- Pengeluaran Operasional
- Komisi
- Pajak

Setiap event menampilkan:
- nama event
- feature terkait
- policy aktif
- status enabled/disabled
- akun default debit/kredit ringkas

#### Level 2 — Flow / diagram editor
User klik event → buka panel diagram / flow rule.

Node minimal yang ditampilkan:
- Trigger Event
- Debit Account Rule
- Credit Account Rule
- Validation Rule
- Policy Outcome

Tujuan diagram ini:
- memudahkan user paham alur jurnal
- bukan menyimpan diagram bebas, tetapi menjadi UI untuk mengedit data rule yang terstruktur

### Prinsip penting
Diagram flow adalah **representasi UI**, bukan source of truth utama.

Source of truth tetap harus berupa struktur data seperti:
- journal event registry
- journal settings
- account role mappings
- journal rule lines / policy config

---

## 5. Prinsip penting untuk feature toggle

### 5.1 Tidak cukup hide menu saja
Kalau fitur dimatikan:
- menu disembunyikan
- route diarahkan aman
- section/action/field terkait ikut di-hide
- workflow lama tidak boleh diam-diam tetap aktif
- jurnal event terkait harus jelas policy-nya

### 5.2 Permission dan feature toggle adalah dua hal berbeda
- **Permission** = siapa boleh akses
- **Feature toggle** = fitur apa yang hidup di seluruh app

Keduanya harus jalan bersama.

### 5.3 UI visibility tidak selalu sama dengan feature status
Ada komponen yang:
- otomatis ikut feature utama
- ada juga yang boleh di-override manual

Karena itu kita butuh registry komponen UI, bukan hanya boolean per fitur.

### 5.4 Kolom tabel dan field form juga harus bisa digate
Bukan hanya page dan menu.

Contoh target gating:
- field ongkos kirim
- field driver
- field delivery status
- kolom retasi
- kolom quotation reference
- section delivery management

---

## 6. Prinsip penting untuk Journal Settings

### 6.1 Jangan buat editor jurnal liar
User boleh ubah jalur jurnal, tapi tetap dalam event registry resmi.

### 6.2 Pisahkan event bisnis dari reference teknis
Yang diatur user adalah event bisnis seperti:
- `sales.invoice.cash`
- `sales.invoice.credit`
- `sales.receivable.payment`
- `sales.delivery.release`
- `sales.return.retasi`
- `production.finish_goods`

Bukan hanya label teknis seperti `reference_type`.

### 6.3 Policy event harus eksplisit
Setiap event minimal punya policy:
- `required`
- `optional`
- `skip`
- `reroute`
- `manual`

### 6.4 Saat fitur dimatikan, jurnalnya juga harus ikut logis
Contoh:
- `Pengantaran = OFF`
  - event delivery-related tidak boleh tetap posting seolah flow pengantaran masih hidup
- `Retasi = OFF`
  - event retasi di-disable atau skip
- `Penawaran = OFF`
  - biasanya tidak berpengaruh langsung ke jurnal, tapi workflow-nya berubah

---

## 7. Struktur data yang dibutuhkan

Agar UI settings dan journal settings bisa hidup, sistem butuh source of truth yang rapi.

Minimal struktur yang dipakai:

### 7.1 `feature_catalog`
Daftar fitur resmi sistem.

Contoh field:
- `feature_key`
- `feature_name`
- `category`
- `description`
- `default_enabled`
- `affects_ui`
- `affects_workflow`
- `affects_journal`

### 7.2 `app_feature_settings`
Status fitur global yang aktif saat ini.

Contoh field:
- `feature_key`
- `is_enabled`
- `explanation`
- `notes`
- `config`

### 7.3 `ui_component_registry`
Daftar komponen UI yang bisa digate.

Komponen type:
- `menu`
- `route`
- `widget`
- `action`
- `section`
- `field`
- `table_column`

> Catatan: `table_column` boleh ditambahkan sebagai type resmi agar kebutuhan hide kolom tabel lebih eksplisit.

### 7.4 `app_ui_settings`
Override visibilitas global per komponen UI.

### 7.5 `journal_event_registry`
Daftar event jurnal yang resmi dan bisa diatur.

### 7.6 `app_journal_settings`
Policy aktif untuk tiap event jurnal.

### 7.7 `app_account_role_mappings`
Mapping role akun untuk resolver debit/kredit.

---

## 8. Contoh resolved config yang harus dibaca app

Frontend idealnya membaca satu hasil akhir seperti ini:

```ts
export interface ResolvedAppConfig {
  features: Record<string, {
    enabled: boolean;
    label: string;
    explanation?: string;
  }>;
  components: Record<string, {
    visible: boolean;
    explanation?: string;
  }>;
  journal: Record<string, {
    enabled: boolean;
    policy: 'required' | 'optional' | 'skip' | 'reroute' | 'manual';
    explanation?: string;
  }>;
}
```

Contoh perilaku:
- `features.delivery.enabled = false`
- `components['menu.delivery'].visible = false`
- `components['route.delivery'].visible = false`
- `components['section.transaction.delivery_management'].visible = false`
- `journal['sales.delivery.release'].policy = 'skip'`

---

## 9. Inventory awal fitur yang paling penting untuk phase pertama

Karena perubahan harus incremental, phase pertama cukup fokus ke fitur yang paling berpengaruh:

### Prioritas phase 1
- Pengantaran
- Retasi
- Penawaran
- Produksi
- Purchase Order

### Komponen UI phase 1
- `menu.delivery`
- `menu.delivery_report`
- `menu.retasi`
- `menu.quotations`
- `route.delivery`
- `route.retasi`
- `route.quotations.list`
- `route.quotations.new`
- `section.transaction.delivery_management`
- `field.transaction.delivery_fee`
- `field.transaction.driver_name`
- `table_column.transaction.delivery_status`

### Event jurnal phase 1
- `sales.invoice.cash`
- `sales.invoice.credit`
- `sales.receivable.payment`
- `sales.delivery.release`
- `sales.return.retasi`
- `production.finish_goods`

---

## 10. Arah implementasi UI yang paling tepat

## 10.1 Settings Page
Tambahkan tab baru:
- `Feature Settings`

Tab lama `Company / Branches / Telegram / Integrations` tetap bisa hidup.

Isi awal `Feature Settings`:
- daftar fitur dalam bentuk card + switch/checkbox
- badge dampak: UI / Workflow / Journal
- panel penjelasan
- daftar komponen terkait

## 10.2 Journal Page
Tambahkan tab baru:
- `Journal Settings`

Isi awal `Journal Settings`:
- daftar event jurnal
- policy selector
- status enabled/disabled
- account role / debit / credit mapping summary
- tombol buka detail flow

## 10.3 Flow Diagram UX
Versi awal tidak perlu terlalu rumit.

Bisa dimulai dengan:
- list event di kiri
- flow summary di kanan
- node sederhana:
  - Trigger
  - Debit
  - Credit
  - Policy
  - Validation

Setelah stabil, baru dikembangkan jadi flow diagram yang lebih interaktif.

---

## 11. Batasan implementasi yang harus dijaga

1. jangan langsung hapus fitur dari database
2. jangan langsung rewrite seluruh RPC jurnal
3. jangan membuat diagram bebas tanpa validasi struktur rule
4. jangan mencampur branch-specific logic ke phase awal
5. jangan membuat blocked explanation page yang berlebihan jika cukup redirect aman + explanation di settings
6. jangan hanya sembunyikan menu tapi biarkan flow lama tetap aktif di balik layar

---

## 12. Urutan kerja yang disarankan

### Phase 1 — Dokumentasi final + scope freeze
- tetapkan dokumen ini sebagai acuan utama
- hentikan drift istilah yang bentrok di docs lama

### Phase 2 — Database config foundation
- feature catalog
- app feature settings
- ui component registry
- app ui settings
- journal event registry
- app journal settings
- account role mappings

### Phase 3 — Frontend config reader
- `useAppConfig`
- `useFeatureGate`
- `useJournalConfig`
- resolved config helper

### Phase 4 — Feature Settings UI
- tab baru di settings
- switch/checkbox fitur
- explanation + notes

### Phase 5 — UI gating phase 1
- sidebar
- route handling
- detail transaksi section delivery
- beberapa field/kolom awal

### Phase 6 — Journal Settings UI
- tab baru di journal
- event cards/list
- policy selector
- debit/credit summary

### Phase 7 — Flow diagram / advanced editor
- visual editor yang tetap berbasis structured data

### Phase 8 — Journal resolver integration
- event tertentu mulai membaca app_journal_settings
- fitur nonaktif mulai mengubah policy jurnal secara nyata

---

## 13. File implementasi awal yang paling mungkin disentuh

### Docs
- `docs/plans/2026-06-14-global-feature-and-journal-settings-final.md`

### Frontend
- `src/pages/SettingsPage.tsx`
- `src/pages/JournalPage.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/App.tsx`
- `src/pages/TransactionDetailPage.tsx`

### Hooks / types baru
- `src/types/appConfig.ts`
- `src/hooks/useAppConfig.ts`
- `src/hooks/useFeatureGate.ts`
- `src/hooks/useJournalConfig.ts`
- `src/components/guards/FeatureRouteHandler.tsx`

### Database
- `database/migrations/*_global_app_config_phase1.sql`

---

## 14. Keputusan terhadap docs lama

Docs lama masih berguna sebagai bahan mentah, tetapi tidak semuanya sudah konsisten.

Karena itu pendekatannya:
- **jangan hapus docs lama dulu sekarang**
- jadikan dokumen ini sebagai **acuan utama/final direction**
- setelah implementasi awal lebih jelas, baru putuskan:
  - mana docs lama yang di-merge
  - mana yang diarsipkan
  - mana yang dihapus

Ini lebih aman daripada langsung hapus semua dokumen lama.

---

## 15. Kesimpulan final

Arah final sistem adalah:

- user punya **Feature Settings** untuk hidup-matikan fitur
- user punya **Journal Settings** untuk atur policy event jurnal dan jalur debit/kredit
- menu, route, section, field, dan kolom tabel ikut membaca config global
- jurnal juga ikut membaca config global, bukan hardcode penuh
- sistem tetap satu codebase dan satu perilaku global
- perubahan dilakukan bertahap, aman, dan bisa diuji satu per satu

Kalau implementasi ini dijalankan dengan benar, ERP Aquvit/Matahari akan jauh lebih fleksibel tanpa harus pecah jadi banyak versi aplikasi.
