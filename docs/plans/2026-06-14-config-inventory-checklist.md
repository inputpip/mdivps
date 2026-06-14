# Config Inventory Checklist & Step-by-Step Plan for Aquvit / Matahari

> **Untuk Hermes:** gunakan dokumen ini untuk eksekusi bertahap. Jangan lompat ke rewrite besar. Mulai dari inventory yang bisa diverifikasi, lalu bangun resolver config, lalu gating UI/route, lalu workflow, lalu journal mapping.

**Goal:** Membuat checklist inventory fitur existing dan urutan implementasi yang realistis agar sistem config-driven multi-branch benar-benar jalan di codebase `matahari`.

**Architecture:** Jalur implementasi dibagi menjadi 6 lapis: inventory sumber kebenaran existing, schema config baru, resolver config, gating UI/route, workflow binding, dan journal mapping. Semua fase harus tetap menjaga prinsip: role permission tetap ada, branch config menambah lapisan perilaku per branch, bukan menggantikannya.

**Tech Stack:** PostgreSQL + PostgREST/Supabase client, React + TypeScript + Vite, TanStack Query, BranchContext/AuthContext existing.

---

## 1. Ringkasan hasil cek codebase saat ini

Hasil ini disusun dari pengecekan langsung file-file berikut:

- `src/App.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/contexts/BranchContext.tsx`
- `src/hooks/usePermissions.ts`
- `src/hooks/useCompanySettings.ts`
- `src/pages/WebManagementPage.tsx`
- `database/table_schemas/branches.sql`
- `database/table_schemas/company_settings.sql`
- `database/rpc_by_function/*.sql`

### Fakta yang sudah terverifikasi

1. **Branch sudah ada**, dan `branches.settings` sudah tersedia.
   - Bukti: `database/table_schemas/branches.sql`
2. **BranchContext sudah aktif**, tetapi fokusnya masih pemilihan cabang dan filtering data.
   - Bukti: `src/contexts/BranchContext.tsx`
3. **Role/permission system sudah ada**, tetapi ini masih role-centric, belum branch-feature-centric.
   - Bukti: `src/hooks/usePermissions.ts`
4. **Menu sidebar masih hardcoded.**
   - Bukti: `src/components/layout/Sidebar.tsx`
5. **Route app masih hardcoded di App.tsx.**
   - Bukti: `src/App.tsx`
6. **Company settings masih key-value global sederhana**, belum cocok untuk branch-specific feature config.
   - Bukti: `database/table_schemas/company_settings.sql`, `src/hooks/useCompanySettings.ts`
7. **Beberapa domain bisnis sudah punya tabel/RPC sendiri**, artinya cocok untuk dipetakan ke feature catalog.
   - Delivery: `database/rpc_by_function/03_delivery.sql`
   - Production: `database/rpc_by_function/04_production.sql`
   - Accounting/journal: `database/rpc_by_function/05_accounting_journal.sql`
   - Purchase order: `database/rpc_by_function/08_purchase_order.sql`
   - Retasi: `database/rpc_by_function/10_retasi.sql`
   - Zakat: `database/rpc_by_function/17_zakat.sql`
   - Tax: `database/rpc_by_function/27_tax.sql`

### Problem yang harus diakui dari cek langsung

1. **UI, menu, dan route belum config-driven.**
2. **Workflow masih tersebar di page/service/RPC domain.**
3. **Posting jurnal masih domain-specific dan belum lewat satu policy resolver.**
4. **Ada referensi tabel di `WebManagementPage.tsx` yang tidak terlihat di dump schema saat ini**, misalnya:
   - `transaction_items`
   - `expense_categories`
   - `branch_transfers`
   - `loans`
   - `loan_payments`
   - `material_inventory_batches`
   - `material_usage_history`
   - `stock_movements`

Ini penting: sebelum implementasi config besar, daftar master fitur harus dibersihkan dulu agar tidak bergantung pada nama tabel yang sudah berubah / tidak sinkron.

---

## 2. Inventory checklist — apa saja yang harus didata dulu

Checklist ini adalah **fase 0 wajib**. Jangan coding config resolver besar sebelum ini selesai.

### 2.1. Checklist inventory sumber fitur

- [ ] Buat daftar semua page aktif dari `src/App.tsx`
- [ ] Buat daftar semua menu/sidebar item dari `src/components/layout/Sidebar.tsx`
- [ ] Buat daftar semua permission yang dipakai dari `src/hooks/usePermissions.ts`
- [ ] Buat daftar semua granular permission yang dipakai langsung di UI
- [ ] Buat daftar semua domain table schema dari `database/table_schemas/*.sql`
- [ ] Buat daftar semua domain RPC/function dari `database/rpc_by_function/*.sql`
- [ ] Tandai fitur mana yang hanya UI-level
- [ ] Tandai fitur mana yang mengubah workflow
- [ ] Tandai fitur mana yang mengubah jurnal/akuntansi
- [ ] Tandai fitur mana yang hanya relevan untuk cabang tertentu
- [ ] Tandai tabel/referensi yang sudah mismatch atau obsolete

### 2.2. Checklist inventory per lapisan

#### A. Feature layer
- [ ] Sales transaction / POS
- [ ] Driver POS
- [ ] Delivery
- [ ] Delivery report
- [ ] Retasi
- [ ] Quotations
- [ ] Production
- [ ] Materials / stock
- [ ] Customers
- [ ] Suppliers
- [ ] Purchase orders
- [ ] Employees
- [ ] Attendance
- [ ] Expenses / advances
- [ ] Receivables
- [ ] Accounts payable
- [ ] Journal
- [ ] Cash flow
- [ ] Financial reports
- [ ] Assets / maintenance
- [ ] Tax
- [ ] Zakat
- [ ] Branch management
- [ ] Roles / settings
- [ ] Company archive / audit logs / web management

#### B. UI / route layer
- [ ] Menu visibility
- [ ] Route access
- [ ] Dashboard widgets
- [ ] Page actions/buttons
- [ ] Form fields
- [ ] Mobile-only routes
- [ ] Desktop-only routes

#### C. Workflow layer
- [ ] Status transaksi penjualan
- [ ] Convert quotation → order
- [ ] Delivery completion flow
- [ ] Retasi flow
- [ ] Production flow
- [ ] Purchase order flow
- [ ] Receivable settlement flow
- [ ] Payroll / attendance flow

#### D. Journal layer
- [ ] Sales revenue posting
- [ ] Payment receipt posting
- [ ] Delivery fee posting
- [ ] Retasi posting
- [ ] Production/WIP posting
- [ ] Purchase material posting
- [ ] Expense posting
- [ ] Tax posting
- [ ] Zakat posting
- [ ] Closing entry posting

---

## 3. Inventory awal fitur existing yang sudah bisa dipetakan sekarang

Bagian ini adalah **seed list** awal berdasarkan file yang memang terlihat di repo sekarang.

| Feature key kandidat | Status awal | Impact UI | Impact workflow | Impact journal | Bukti awal |
|---|---|---:|---:|---:|---|
| `sales_pos` | core | yes | yes | yes | `src/App.tsx`, `transactions.sql` |
| `driver_pos` | optional branch | yes | yes | possible | `src/App.tsx`, `Sidebar.tsx` |
| `delivery` | optional branch | yes | yes | yes | `DeliveryPage.tsx`, `03_delivery.sql`, `deliveries.sql` |
| `delivery_report` | optional branch | yes | light | no/low | `DeliveryReportPage.tsx`, `delivery_photos.sql` |
| `retasi` | optional branch | yes | yes | yes | `RetasiPage.tsx`, `10_retasi.sql`, `retasi.sql` |
| `quotations` | optional branch | yes | yes | indirect | `QuotationsPage.tsx`, `quotations.sql`, `quotationService.ts` |
| `production` | branch-shaping | yes | yes | yes | `ProductionPage.tsx`, `04_production.sql`, `production_records.sql` |
| `materials_stock` | core | yes | yes | indirect | `MasterDataStockPage.tsx`, `materials.sql`, `material_stock_movements.sql` |
| `customers` | core | yes | no | indirect | `CustomerPage.tsx`, `customers.sql` |
| `suppliers` | optional | yes | no | indirect | `SupplierPage.tsx`, `suppliers.sql` |
| `purchase_orders` | optional branch | yes | yes | yes | `PurchaseOrderPage.tsx`, `08_purchase_order.sql`, `purchase_orders.sql` |
| `attendance` | optional branch | yes | yes | possible | `AttendancePage.tsx`, `28_attendance.sql`, `attendance.sql` |
| `employees` | common support | yes | no | indirect | `EmployeePage.tsx`, `employee*.sql` |
| `expenses_advances` | common support | yes | yes | yes | `ExpensesAndAdvancesPage.tsx`, `07_expense.sql`, `06_employee_advance.sql` |
| `receivables` | common support | yes | yes | yes | `ReceivablesPage.tsx`, `09_receivable_payable.sql`, `receivables.sql` |
| `accounts_payable` | optional branch | yes | yes | yes | `AccountsPayablePage.tsx`, `accounts_payable.sql` |
| `journal` | core finance | yes | no | yes | `JournalPage.tsx`, `05_accounting_journal.sql` |
| `cash_flow` | core finance | yes | no | yes | `CashFlowPage.tsx`, `cash_history.sql` |
| `financial_reports` | optional | yes | no | reads journal | `FinancialReportsPage.tsx` |
| `assets` | optional | yes | yes | yes | `AssetsPage.tsx`, `11_asset.sql`, `assets.sql` |
| `maintenance` | optional | yes | yes | possible | `MaintenancePage.tsx`, `asset_maintenance.sql` |
| `tax` | optional branch | yes | yes | yes | `TaxPage.tsx`, `27_tax.sql` |
| `zakat` | optional branch | yes | yes | yes | `ZakatPage.tsx`, `17_zakat.sql` |
| `roles_settings` | admin/system | yes | no | no | `RolesPage.tsx`, `SettingsPage.tsx` |
| `branch_management` | admin/system | yes | no | possible | `BranchManagementPage.tsx`, `branches.sql` |
| `audit_logs` | admin/system | yes | no | no | `AuditLogsPage.tsx`, `audit_logs.sql` |
| `company_archive` | admin/system | yes | no | no | `CompanyArchivePage.tsx` |
| `web_management` | owner/system | yes | no | no | `WebManagementPage.tsx` |

### 3.1. Fitur yang kemungkinan **non-prioritas** untuk mode fokus percetakan

Ini bukan berarti dihapus sekarang, tapi kandidat kuat untuk `is_enabled = false` pada branch percetakan awal:

- `delivery`
- `delivery_report`
- `driver_pos`
- `retasi`
- `customer_map`
- sebagian flow sales lapangan/mobile distribution

### 3.2. Fitur yang kemungkinan **tetap hidup** untuk mode fokus percetakan

- `sales_pos` atau order entry inti
- `quotations`
- `production`
- `materials_stock`
- `customers`
- `expenses_advances`
- `receivables`
- `journal`
- `cash_flow`
- `financial_reports`
- `purchase_orders`
- `suppliers`

---

## 4. Dokumen inventory kerja yang harus dibuat di repo

Sebelum implementasi, buat artefak kerja berikut:

### File 1 — master inventory fitur
- Path: `docs/plans/config-feature-inventory.md`
- Isi minimal:
  - feature_key
  - nama fitur
  - route terkait
  - menu terkait
  - permission terkait
  - tabel terkait
  - RPC/service terkait
  - impact workflow
  - impact journal
  - prioritas untuk branch percetakan

### File 2 — UI registry draft
- Path: `docs/plans/config-ui-registry.md`
- Isi minimal:
  - component_key
  - type (`menu` / `route` / `widget` / `action` / `field`)
  - file sumber
  - feature_key terkait
  - default visible

### File 3 — journal event inventory draft
- Path: `docs/plans/config-journal-event-inventory.md`
- Isi minimal:
  - event_key
  - asal domain
  - file/RPC pembuat jurnal
  - akun yang dipakai sekarang
  - fallback yang diinginkan saat fitur dimatikan

---

## 5. Step-by-step implementasi agar config ini jalan

Di bawah ini urutan yang aman. Jangan dibalik.

## Phase 0 — Bersihkan inventory dulu

**Objective:** memastikan kita tidak membangun config di atas daftar fitur/tabel yang salah.

**Files:**
- Modify: `docs/plans/2026-06-14-config-inventory-checklist.md`
- Create: `docs/plans/config-feature-inventory.md`
- Create: `docs/plans/config-ui-registry.md`
- Create: `docs/plans/config-journal-event-inventory.md`
- Verify against: `src/App.tsx`, `src/components/layout/Sidebar.tsx`, `database/table_schemas/*.sql`, `database/rpc_by_function/*.sql`

**Checklist:**
- [ ] Sinkronkan semua route dari `App.tsx`
- [ ] Sinkronkan semua menu dari `Sidebar.tsx`
- [ ] Cocokkan setiap feature dengan schema/RPC yang benar
- [ ] Tandai nama tabel yang obsolete atau mismatch
- [ ] Putuskan feature mana yang masuk MVP config phase-1

**Output selesai fase:**
- master inventory yang bersih dan tidak ambigu

---

## Phase 1 — Bangun schema config minimal

**Objective:** menyiapkan tabel config minimum supaya branch bisa punya fitur aktif/nonaktif dan binding workflow dasar.

**Files:**
- Create: `database/table_schemas/feature_catalog.sql`
- Create: `database/table_schemas/branch_feature_settings.sql`
- Create: `database/table_schemas/ui_component_registry.sql`
- Create: `database/table_schemas/branch_ui_settings.sql`
- Create: `database/table_schemas/workflow_definitions.sql`
- Create: `database/table_schemas/branch_workflow_bindings.sql`
- Create: `database/table_schemas/journal_event_catalog.sql`
- Create: `database/table_schemas/branch_journal_mappings.sql`
- Create: `database/table_schemas/config_audit_logs.sql`

**Checklist:**
- [ ] `feature_catalog` punya `feature_key` unik
- [ ] `branch_feature_settings` pakai `(branch_id, feature_key)` unik
- [ ] `ui_component_registry` punya `component_key` unik
- [ ] `branch_ui_settings` pakai `(branch_id, component_key)` unik
- [ ] `workflow_definitions` punya `workflow_key` unik
- [ ] `branch_workflow_bindings` pakai `(branch_id, entity_type)` unik
- [ ] `journal_event_catalog` punya `event_key` unik
- [ ] `branch_journal_mappings` pakai `(branch_id, event_key)` unik
- [ ] semua tabel punya `updated_at` dan `updated_by` bila relevan

**Catatan penting:**
- Jangan paksakan semua rule ke `branches.settings`
- `branches.settings` cukup untuk preferensi ringan / cache ringan / emergency toggle

---

## Phase 2 — Seed data awal config

**Objective:** isi daftar fitur dan komponen awal berdasarkan inventory repo yang sudah diverifikasi.

**Files:**
- Create: `database/seeds/feature_catalog_seed.sql`
- Create: `database/seeds/ui_component_registry_seed.sql`
- Create: `database/seeds/workflow_definitions_seed.sql`
- Create: `database/seeds/journal_event_catalog_seed.sql`

**Checklist:**
- [ ] seed `sales_pos`, `quotations`, `production`, `delivery`, `retasi`, `purchase_orders`, dst.
- [ ] seed komponen `menu.*`
- [ ] seed komponen `route.*`
- [ ] seed komponen `action.*` yang penting
- [ ] seed workflow default transaksi umum
- [ ] seed workflow produksi
- [ ] seed event jurnal utama

**Output selesai fase:**
- DB sudah punya kamus fitur resmi

---

## Phase 3 — Resolver config tunggal

**Objective:** frontend tidak lagi baca config acak dari banyak tempat.

**Files:**
- Create: `src/config/featureCatalog.ts`
- Create: `src/services/config/branchConfigService.ts`
- Create: `src/hooks/config/useBranchConfig.ts`
- Create: `src/hooks/config/useFeatureFlag.ts`
- Create: `src/hooks/config/useComponentVisibility.ts`
- Create: `src/hooks/config/useWorkflowConfig.ts`
- Create: `src/hooks/config/useJournalPolicy.ts`
- Modify: `src/contexts/BranchContext.tsx`

**Checklist:**
- [ ] `BranchContext` expose `resolvedConfig`
- [ ] ada cache/query untuk config branch aktif
- [ ] resolver merge `default_enabled` + branch override
- [ ] resolver merge feature → UI defaults → UI override
- [ ] resolver tersedia sebagai hook sederhana di page/component

**Definition of done:**
- page cukup tanya `useFeatureFlag('delivery')`
- page tidak query tabel config langsung satu-satu

---

## Phase 4 — Sidebar/menu menjadi config-driven

**Objective:** menu membaca resolver config, bukan hardcoded tampil semua lalu hanya disaring permission.

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Optional create: `src/config/navigationRegistry.ts`

**Checklist:**
- [ ] pisahkan registry menu dari render logic
- [ ] setiap item punya `feature_key` atau `component_key`
- [ ] render final = permission check + config visibility check
- [ ] sales-role special case diperkecil seminimal mungkin

**Definition of done:**
- jika branch mematikan `delivery`, menu delivery hilang tanpa edit manual item per item

---

## Phase 5 — Route handling

**Objective:** fitur nonaktif tidak muncul di navigasi normal, dan route lama diarahkan aman bila dibuka manual lewat URL.

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/FeatureRouteHandler.tsx`
- Verify: `src/components/ProtectedRoute.tsx`

**Checklist:**
- [ ] buat wrapper route handler berdasarkan `feature_key` / `component_key`
- [ ] route mobile dan desktop sama-sama lewat handler
- [ ] fallback route jelas (`/` atau halaman valid lain)
- [ ] logika route handler terpisah dari role auth
- [ ] alasan/status fitur dilihat user dari tab `Feature Settings`, bukan dari halaman route khusus

**Definition of done:**
- `menu hidden` dan `route redirected safely` selalu konsisten

---

## Phase 6 — Field/action gating

**Objective:** tombol, card, widget, dan field penting ikut tunduk pada branch config.

**Files:**
- Modify candidates:
  - `src/pages/TransactionListPage.tsx`
  - `src/pages/TransactionDetailPage.tsx`
  - `src/pages/ProductionPage.tsx`
  - `src/pages/QuotationsPage.tsx`
  - `src/pages/PurchaseOrderPage.tsx`
  - `src/pages/DashboardPage.tsx`

**Checklist:**
- [ ] tombol “Pengantaran” hanya muncul jika `delivery` aktif
- [ ] section `DeliveryManagement` di detail transaksi ikut gate
- [ ] aksi convert quotation ikut gate
- [ ] widget dashboard produksi ikut gate
- [ ] field yang khusus delivery/retasi tidak wajib saat feature mati

---

## Phase 7 — Workflow binding per branch

**Objective:** perbedaan perilaku branch pindah dari hardcoded page logic ke workflow definition.

**Files:**
- Create: `src/services/workflow/workflowResolver.ts`
- Create: `src/hooks/workflow/useWorkflowState.ts`
- Modify candidates:
  - `src/pages/TransactionDetailPage.tsx`
  - `src/pages/ProductionPage.tsx`
  - `src/pages/QuotationsPage.tsx`
  - domain RPC yang relevan

**Checklist:**
- [ ] definisikan workflow transaksi standar
- [ ] definisikan workflow produksi
- [ ] bind workflow ke branch via `branch_workflow_bindings`
- [ ] validasi required fields per state
- [ ] transisi state tidak hardcoded lagi di UI semata

**MVP paling aman:**
- mulai dari `transaction`
- lalu `production`
- baru setelah itu `delivery` / `retasi`

---

## Phase 8 — Journal mapping engine

**Objective:** jika fitur mati, jurnal tidak error dan tetap punya policy yang jelas.

**Files:**
- Create: `src/services/accounting/journalPolicyResolver.ts`
- Modify / inspect:
  - `database/rpc_by_function/05_accounting_journal.sql`
  - `database/rpc_by_function/03_delivery.sql`
  - `database/rpc_by_function/04_production.sql`
  - `database/rpc_by_function/10_retasi.sql`
  - `database/rpc_by_function/17_zakat.sql`
  - `database/rpc_by_function/27_tax.sql`
  - `src/services/closingEntryService.ts`

**Checklist:**
- [ ] semua posting utama punya `event_key`
- [ ] mapping akun per branch bisa di-resolve
- [ ] saat feature nonaktif ada policy `skip` / `reroute` / `error`
- [ ] domain code tidak langsung hardcode akun tanpa resolver
- [ ] perubahan policy tercatat di `config_audit_logs`

**Contoh target nyata:**
- jika `delivery = false`
- maka event jurnal `delivery_fee` tidak lagi pakai logika lama
- tetapi resolve ke policy branch yang aktif

---

## Phase 9 — Admin UI untuk config branch

**Objective:** owner/admin bisa mengelola config tanpa edit SQL manual.

**Files:**
- Modify: `src/pages/BranchManagementPage.tsx`
- Optional create:
  - `src/components/config/BranchFeatureSettingsPanel.tsx`
  - `src/components/config/BranchUISettingsPanel.tsx`
  - `src/components/config/BranchWorkflowBindingsPanel.tsx`
  - `src/components/config/BranchJournalMappingsPanel.tsx`

**Checklist:**
- [ ] tab feature flags
- [ ] tab UI visibility overrides
- [ ] tab workflow bindings
- [ ] tab journal mapping
- [ ] tab audit trail perubahan

---

## Phase 10 — Pilot branch percetakan

**Objective:** uji konsep pada satu branch percetakan tanpa merusak branch lain.

**Checklist konfigurasi awal branch percetakan:**
- [ ] `production = true`
- [ ] `quotations = true`
- [ ] `purchase_orders = true`
- [ ] `delivery = false`
- [ ] `delivery_report = false`
- [ ] `driver_pos = false`
- [ ] `retasi = false`
- [ ] route dan menu terkait distribution tersembunyi
- [ ] workflow transaksi mengarah ke flow produksi
- [ ] journal mapping untuk event delivery punya fallback jelas

**Verification:**
- [ ] login ke branch percetakan
- [ ] menu distribusi hilang
- [ ] route distribusi terblokir
- [ ] order bisa jalan lewat flow quotation/produksi
- [ ] jurnal transaksi tetap berhasil terbentuk

---

## 6. Urutan implementasi paling aman untuk MVP

Kalau mau yang paling realistis dan tidak terlalu melebar, kerjakan dalam urutan ini:

1. **Rapikan inventory**
2. **Buat schema config minimal**
3. **Seed feature + UI registry**
4. **Buat `useBranchConfig()`**
5. **Ubah sidebar jadi config-driven**
6. **Tambahkan route guard**
7. **Gate tombol/section delivery dan quotation**
8. **Pilot branch percetakan: delivery off, production on**
9. **Baru lanjut workflow binding**
10. **Terakhir journal mapping engine**

Kalau dibalik, risikonya besar:
- UI tampak benar tapi route masih bocor
- route tertutup tapi workflow lama masih jalan
- workflow berubah tapi jurnal masih hardcoded

---

## 7. Definisi “config ini sudah jalan”

Jangan anggap selesai hanya karena ada tabel config.

Config baru dianggap **benar-benar jalan** kalau semua ini lolos:

- [ ] branch A dan branch B bisa punya fitur aktif berbeda
- [ ] menu berbeda per branch tanpa edit source per branch
- [ ] route berbeda per branch tanpa bypass URL
- [ ] action/field penting ikut berubah
- [ ] workflow order bisa berbeda per branch
- [ ] jurnal tetap valid saat suatu fitur dimatikan
- [ ] owner/admin bisa melihat dan mengubah config
- [ ] perubahan config tercatat

---

## 8. Rekomendasi keputusan teknis untuk bos

Dari kondisi repo saat ini, jalur paling waras adalah:

1. **jangan rewrite besar dulu**
2. **jangan pakai business profile printing/distribution/hybrid**
3. **pakai feature checklist + ui registry + workflow binding + journal mapping**
4. **pilot dulu di branch percetakan**
5. **mulai dari gating delivery/retasi vs production/quotation**, karena itu area pembeda paling terasa

---

## 9. Next action yang paling tepat setelah dokumen ini

Kalau lanjut eksekusi, task pertama yang paling tepat adalah:

### Task berikutnya
Buat file:
- `docs/plans/config-feature-inventory.md`

Lalu isi **baris demi baris** dari route/menu/schema/RPC yang sudah ada sekarang, bukan asumsi.

Itu akan jadi fondasi implementasi semua fase berikutnya.
