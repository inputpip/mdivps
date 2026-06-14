# Config Feature Inventory for Aquvit / Matahari

> **Tujuan dokumen ini:** menjadi master inventory fitur existing yang akan dipakai untuk membangun sistem config-driven multi-branch. Isi dokumen ini harus berdasarkan route, menu, schema, dan RPC yang benar-benar ada di repo saat ini — bukan asumsi.

**Sumber verifikasi utama:**
- `src/App.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/hooks/usePermissions.ts`
- `src/contexts/BranchContext.tsx`
- `database/table_schemas/*.sql`
- `database/rpc_by_function/*.sql`

---

## 1. Aturan klasifikasi inventory

Setiap fitur di bawah dicatat dengan dimensi ini:

- **feature_key**: nama fitur resmi kandidat untuk config system
- **domain**: area bisnis / area sistem
- **routes**: route yang memakai fitur itu
- **menu**: item sidebar yang mewakili fitur
- **permission**: permission/granular permission yang saat ini dipakai UI
- **tables**: tabel utama yang kelihatan relevan
- **rpc/functions**: fungsi/RPC domain yang terlihat relevan
- **workflow impact**:
  - `none` = nyaris hanya baca data / tampilan
  - `light` = ada aksi, tapi tidak jadi alur inti bisnis
  - `heavy` = mengubah flow/status/proses bisnis
- **journal impact**:
  - `none` = tidak memengaruhi jurnal
  - `indirect` = efeknya lewat domain lain
  - `direct` = domain ini memang membentuk / mengubah posting
- **printing priority**:
  - `keep` = kemungkinan tetap hidup di branch percetakan
  - `optional` = bisa hidup/mati tergantung kebutuhan
  - `disable-first` = kandidat kuat dimatikan pada pilot percetakan
- **notes**: catatan mismatch, dependensi, atau risiko

---

## 2. Route inventory dari `src/App.tsx`

### 2.1 Public route
- `/login`

### 2.2 Mobile route set
- `/`
- `/pos`
- `/driver-pos`
- `/attendance`
- `/transactions`
- `/transactions/:id`
- `/customers`
- `/customers/:id`
- `/customer-map`
- `/production`
- `/warehouse`
- `/retasi`
- `/delivery`
- `/sold-items`
- `/my-commission`
- `/expenses`
- `/mobile-maintenance`
- `/mobile-sales-report`
- `/delivery-report`
- `/quotations`
- `/quotations/new`
- `/journal`
- `/employees`

### 2.3 Desktop route set
- `/`
- `/pos`
- `/transactions`
- `/transactions/:id`
- `/products`
- `/products/:id`
- `/materials`
- `/production`
- `/materials/:materialId`
- `/customers`
- `/customers/:id`
- `/employees`
- `/payroll`
- `/suppliers`
- `/purchase-orders`
- `/accounts`
- `/accounts/:id`
- `/receivables`
- `/accounts-payable`
- `/expenses`
- `/advances`
- `/settings`
- `/account-settings`
- `/attendance`
- `/attendance/report`
- `/stock-report`
- `/transaction-items-report`
- `/material-movements`
- `/service-material-report`
- `/cash-flow`
- `/roles`
- `/retasi`
- `/delivery`
- `/driver-pos`
- `/commission-report`
- `/financial-reports`
- `/assets`
- `/maintenance`
- `/zakat`
- `/tax`
- `/branches`
- `/journal`
- `/material-usage-summary`
- `/web-management`
- `/company-archive`
- `/audit-logs`
- `/customer-map`
- `/quotations`
- `/quotations/new`
- `/sales-reports`
- `/delivery-report`

---

## 3. Sidebar inventory dari `src/components/layout/Sidebar.tsx`

### Section: Utama
- `/` → Dashboard
- `/pos` → Point of Sale (POS)
- `/driver-pos` → POS Supir
- `/transactions` → Data Transaksi
- `/quotations` → Penawaran
- `/delivery` → Pengantaran
- `/delivery-report` → Lapor Antar
- `/retasi` → Retasi
- `/transaction-items-report` → Laporan Produk Laku
- `/sales-reports` → Laporan Sales
- `/attendance` → Absensi
- `/expenses` → Pengeluaran & Kasbon

### Section: Manajemen Data
- `/materials` → Barang & Stok
- `/production` → Produksi
- `/customers` → Pelanggan
- `/customer-map` → Pelanggan Terdekat
- `/employees` → Karyawan
- `/suppliers` → Supplier
- `/purchase-orders` → Purchase Orders

### Section: Keuangan
- `/accounts` → Akun Keuangan
- `/journal` → Jurnal Umum
- `/cash-flow` → Buku Kas Harian
- `/receivables` → Piutang
- `/accounts-payable` → Hutang
- `/financial-reports` → Laporan Keuangan

### Section: Aset, Zakat & Pajak
- `/assets` → Aset & Maintenance
- `/maintenance` → Jadwal Maintenance
- `/zakat` → Zakat & Sedekah
- `/tax` → Pajak (PPN)

### Section: Laporan
- `/stock-report` → Laporan Stock
- `/material-movements` → Pergerakan Penggunaan Bahan
- `/attendance/report` → Laporan Absensi
- `/commission-report` → Komisi Saya

### Section: Pengaturan
- `/settings` → Pengaturan
- `/roles` → Manajemen Roles
- `/branches` → Manajemen Cabang
- `/web-management` → Web Management
- `/company-archive` → Arsip Berkas
- `/audit-logs` → Log Aktivitas (Audit)

---

## 4. Permission inventory yang terlihat di UI

### Simplified permissions dari `usePermissions.ts`
- `products`
- `products_manage`
- `pos_edit_price`
- `materials`
- `materials_manage`
- `transactions`
- `customers`
- `employees`
- `deliveries`
- `attendance`
- `financial`
- `receivable_backdate`
- `receivable_delete`
- `production`
- `reports`
- `settings`
- `roles`

### Granular permissions yang dipakai langsung di sidebar/UI
- `quotations_view`
- `quotations_create`
- `purchase_orders_view`
- `purchase_orders_create`
- `branch_access_<branch_id>` (dipakai di BranchContext untuk akses cabang)

### Catatan penting
- Saat ini **permission** menjawab: siapa boleh akses.
- Sistem config nanti harus menjawab: fitur apa hidup di branch aktif.
- Jadi `hasPermission(...)` harus tetap ada, lalu ditambah lapisan `isFeatureEnabled(...)` dan `isComponentVisible(...)`.

---

## 5. Master feature inventory

## 5.1 Core business & sales

### `dashboard`
- **domain:** system/home
- **routes:** `/`
- **menu:** Dashboard
- **permission:** none explicit di sidebar untuk item `/`
- **tables:** bergantung widget, belum tunggal
- **rpc/functions:** kemungkinan statistik/report aggregate
- **workflow impact:** none
- **journal impact:** none
- **printing priority:** keep
- **notes:** dashboard nanti perlu widget-level gating, bukan hanya page-level.

### `sales_pos`
- **domain:** sales
- **routes:** `/pos`
- **menu:** Point of Sale (POS)
- **permission:** `transactions`
- **tables:** `transactions.sql`, `transaction_payments.sql`, `payment_history.sql`, `stock_pricings.sql`, `bonus_pricings.sql`
- **rpc/functions:** `02_transactions.sql`, `24_payment_history.sql`
- **workflow impact:** heavy
- **journal impact:** direct
- **printing priority:** keep
- **notes:** ini salah satu fitur inti yang hampir pasti tetap hidup di percetakan sebagai order entry / transaksi inti.

### `transactions`
- **domain:** sales
- **routes:** `/transactions`, `/transactions/:id`
- **menu:** Data Transaksi
- **permission:** `transactions`
- **tables:** `transactions.sql`, `transaction_payments.sql`, `payment_history.sql`
- **rpc/functions:** `02_transactions.sql`, `24_payment_history.sql`
- **workflow impact:** heavy
- **journal impact:** direct
- **printing priority:** keep
- **notes:** detail transaksi terlihat punya coupling ke delivery section; nanti harus bisa gate per feature.

### `quotations`
- **domain:** sales pre-order
- **routes:** `/quotations`, `/quotations/new`
- **menu:** Penawaran
- **permission:** `quotations_view` / `quotations_create`
- **tables:** `quotations.sql`, `customer_pricings.sql`
- **rpc/functions:** `quotationService.ts` memakai RPC generate quotation number; domain transaction conversion perlu dicek lebih lanjut
- **workflow impact:** heavy
- **journal impact:** indirect
- **printing priority:** keep
- **notes:** kandidat kuat untuk branch percetakan; penting untuk flow penawaran → order → produksi.

### `sales_reports`
- **domain:** reports/sales
- **routes:** `/sales-reports`, `/transaction-items-report`, `/sold-items`, `/my-commission`, `/mobile-sales-report`
- **menu:** Laporan Sales, Laporan Produk Laku, Komisi Saya
- **permission:** `reports`
- **tables:** `transactions.sql`, `payment_history.sql`, `commission_entries.sql`, `commission_rules.sql`
- **rpc/functions:** `13_commission.sql`, `30_statistics.sql`
- **workflow impact:** none
- **journal impact:** indirect
- **printing priority:** optional
- **notes:** laporan perlu dipecah lagi nanti menjadi widget/action terpisah di UI registry.

---

## 5.2 Delivery / distribution cluster

### `driver_pos`
- **domain:** logistics/distribution
- **routes:** `/driver-pos`
- **menu:** POS Supir
- **permission:** `transactions` (menu), granular driver permission dimapping ke deliveries di hook
- **tables:** kemungkinan `deliveries.sql`, `delivery_items.sql`, `transactions.sql`
- **rpc/functions:** `03_delivery.sql`, `02_transactions.sql`
- **workflow impact:** heavy
- **journal impact:** indirect
- **printing priority:** disable-first
- **notes:** salah satu pembeda paling jelas antara distribusi vs percetakan.

### `delivery`
- **domain:** logistics/distribution
- **routes:** `/delivery`
- **menu:** Pengantaran
- **permission:** `deliveries`
- **tables:** `deliveries.sql`, `delivery_items.sql`, `delivery_photos.sql`
- **rpc/functions:** `03_delivery.sql`
- **workflow impact:** heavy
- **journal impact:** direct
- **printing priority:** disable-first
- **notes:** wajib jadi pilot feature untuk pembuktian gating + workflow + journal fallback.

### `delivery_report`
- **domain:** logistics/reporting
- **routes:** `/delivery-report`
- **menu:** Lapor Antar
- **permission:** `deliveries`
- **tables:** `delivery_photos.sql`, `deliveries.sql`
- **rpc/functions:** `03_delivery.sql`
- **workflow impact:** light
- **journal impact:** none/indirect
- **printing priority:** disable-first
- **notes:** walau hanya report/operasional, tetap harus ikut route guard kalau delivery dimatikan.

### `retasi`
- **domain:** logistics/returns
- **routes:** `/retasi`
- **menu:** Retasi
- **permission:** `deliveries`
- **tables:** `retasi.sql`, `retasi_items.sql`
- **rpc/functions:** `10_retasi.sql`
- **workflow impact:** heavy
- **journal impact:** direct
- **printing priority:** disable-first
- **notes:** kandidat kuat dimatikan pada pilot branch percetakan.

### `customer_map`
- **domain:** field sales / geo
- **routes:** `/customer-map`
- **menu:** Pelanggan Terdekat
- **permission:** `customers`
- **tables:** `customers.sql`, `customer_visits.sql`
- **rpc/functions:** `18_customer_supplier.sql`
- **workflow impact:** light
- **journal impact:** none
- **printing priority:** disable-first
- **notes:** lebih dekat ke kebutuhan distribusi/lapangan.

---

## 5.3 Production & inventory cluster

### `materials_stock`
- **domain:** inventory
- **routes:** `/materials`, `/materials/:materialId`, `/stock-report`, `/material-movements`, `/material-usage-summary`, `/service-material-report`, `/warehouse`
- **menu:** Barang & Stok, Laporan Stock, Pergerakan Penggunaan Bahan
- **permission:** `materials`, `reports`
- **tables:** `materials.sql`, `material_stock_movements.sql`, `inventory_batches.sql`, `inventory_batch_consumptions.sql`, `product_materials.sql`, `product_stock_movements.sql`
- **rpc/functions:** `01_inventory_fifo.sql`, `14_stock_adjustment.sql`
- **workflow impact:** heavy
- **journal impact:** indirect
- **printing priority:** keep
- **notes:** ini fondasi kuat untuk percetakan karena terkait bahan baku dan konsumsi material.

### `products_catalog`
- **domain:** products
- **routes:** `/products`, `/products/:id`
- **menu:** tidak muncul langsung di sidebar; desktop memakai `MasterDataStockPage`
- **permission:** terkait `products`
- **tables:** `products.sql`, `product_materials.sql`, `product_stock_movements.sql`
- **rpc/functions:** `01_inventory_fifo.sql`
- **workflow impact:** light
- **journal impact:** indirect
- **printing priority:** keep
- **notes:** perlu keputusan apakah `products` dan `materials` nanti jadi feature terpisah atau 1 cluster inventory.

### `production`
- **domain:** production
- **routes:** `/production`
- **menu:** Produksi
- **permission:** sidebar memakai `products` untuk menu ini; hook juga punya constant `production`
- **tables:** `production_records.sql`, `production_errors.sql`, `product_materials.sql`
- **rpc/functions:** `04_production.sql`
- **workflow impact:** heavy
- **journal impact:** direct
- **printing priority:** keep
- **notes:** ini feature paling penting untuk branch percetakan. Perlu workflow binding yang jelas.

### `purchase_orders`
- **domain:** purchasing
- **routes:** `/purchase-orders`
- **menu:** Purchase Orders
- **permission:** `purchase_orders_view` / `purchase_orders_create`
- **tables:** `purchase_orders.sql`, `purchase_order_items.sql`, `suppliers.sql`, `accounts_payable.sql`, `supplier_materials.sql`
- **rpc/functions:** `08_purchase_order.sql`
- **workflow impact:** heavy
- **journal impact:** direct
- **printing priority:** keep
- **notes:** sangat relevan untuk bahan baku percetakan.

### `suppliers`
- **domain:** purchasing/master data
- **routes:** `/suppliers`
- **menu:** Supplier
- **permission:** `materials`
- **tables:** `suppliers.sql`, `supplier_materials.sql`
- **rpc/functions:** `18_customer_supplier.sql`
- **workflow impact:** light
- **journal impact:** indirect
- **printing priority:** keep
- **notes:** support feature untuk purchasing.

---

## 5.4 Customers, people, HR

### `customers`
- **domain:** CRM/master data
- **routes:** `/customers`, `/customers/:id`
- **menu:** Pelanggan
- **permission:** `customers`
- **tables:** `customers.sql`, `customer_pricings.sql`, `customer_visits.sql`
- **rpc/functions:** `18_customer_supplier.sql`
- **workflow impact:** light
- **journal impact:** indirect
- **printing priority:** keep
- **notes:** pelanggan pasti tetap dibutuhkan di percetakan.

### `employees`
- **domain:** HR/master data
- **routes:** `/employees`
- **menu:** Karyawan
- **permission:** `employees`
- **tables:** `profiles.sql`, `employee_salaries.sql`, `employee_advances.sql`, `advance_repayments.sql`
- **rpc/functions:** `19_employee.sql`, `06_employee_advance.sql`, `12_payroll_salary.sql`
- **workflow impact:** light
- **journal impact:** indirect
- **printing priority:** optional
- **notes:** support domain; biasanya tetap dibutuhkan tapi bukan pembeda mode inti.

### `attendance`
- **domain:** HR/operations
- **routes:** `/attendance`, `/attendance/report`
- **menu:** Absensi, Laporan Absensi
- **permission:** `attendance`, `reports`
- **tables:** `attendance.sql`
- **rpc/functions:** `28_attendance.sql`
- **workflow impact:** light
- **journal impact:** indirect
- **printing priority:** optional
- **notes:** tidak wajib di fase pilot config pertama.

### `payroll`
- **domain:** HR/payroll
- **routes:** `/payroll`
- **menu:** tidak ada menu khusus di sidebar saat ini
- **permission:** kemungkinan financial/employees; perlu cek lebih detail di page
- **tables:** `payroll_records.sql`, `employee_salaries.sql`
- **rpc/functions:** `12_payroll_salary.sql`
- **workflow impact:** light
- **journal impact:** direct/indirect
- **printing priority:** optional
- **notes:** route ada, tetapi menu khusus belum terlihat di sidebar.

### `commissions`
- **domain:** HR/sales incentive
- **routes:** `/commission-report`, `/my-commission`
- **menu:** Komisi Saya
- **permission:** `reports`
- **tables:** `commission_entries.sql`, `commission_rules.sql`
- **rpc/functions:** `13_commission.sql`
- **workflow impact:** light
- **journal impact:** indirect
- **printing priority:** optional
- **notes:** mungkin tidak prioritas untuk branch percetakan awal.

---

## 5.5 Finance & accounting cluster

### `expenses_advances`
- **domain:** finance/ops
- **routes:** `/expenses`, `/advances`
- **menu:** Pengeluaran & Kasbon
- **permission:** `financial`
- **tables:** `expenses.sql`, `employee_advances.sql`, `advance_repayments.sql`, `payment_history.sql`
- **rpc/functions:** `07_expense.sql`, `06_employee_advance.sql`
- **workflow impact:** heavy
- **journal impact:** direct
- **printing priority:** keep
- **notes:** dibutuhkan hampir di semua mode bisnis.

### `accounts`
- **domain:** accounting/master
- **routes:** `/accounts`, `/accounts/:id`, `/account-settings`
- **menu:** Akun Keuangan
- **permission:** `financial`
- **tables:** `accounts.sql`, `accounts_balance_backup.sql`, `balance_adjustments.sql`
- **rpc/functions:** `05_accounting_journal.sql`
- **workflow impact:** none
- **journal impact:** direct
- **printing priority:** keep
- **notes:** nanti akan sangat terkait dengan journal mapping engine.

### `journal`
- **domain:** accounting
- **routes:** `/journal`
- **menu:** Jurnal Umum
- **permission:** `financial`
- **tables:** `journal_entries.sql`, `journal_entry_lines.sql`, `manual_journal_entries.sql`, `manual_journal_entry_lines.sql`, `closing_periods.sql`
- **rpc/functions:** `05_accounting_journal.sql`, `20_trigger_functions.sql`
- **workflow impact:** none
- **journal impact:** direct
- **printing priority:** keep
- **notes:** core domain untuk lapis journal mapping.

### `cash_flow`
- **domain:** accounting/cash
- **routes:** `/cash-flow`
- **menu:** Buku Kas Harian
- **permission:** `financial`
- **tables:** `cash_history.sql`, `payment_history.sql`
- **rpc/functions:** `24_payment_history.sql`, `05_accounting_journal.sql`
- **workflow impact:** light
- **journal impact:** direct
- **printing priority:** keep
- **notes:** hasil akhir tetap harus konsisten walau beberapa feature dimatikan.

### `receivables`
- **domain:** finance/ar
- **routes:** `/receivables`
- **menu:** Piutang
- **permission:** `financial`
- **tables:** `receivables.sql`, `transaction_payments.sql`, `payment_history.sql`
- **rpc/functions:** `09_receivable_payable.sql`, `24_payment_history.sql`
- **workflow impact:** heavy
- **journal impact:** direct
- **printing priority:** keep
- **notes:** biasanya tetap penting untuk order pelanggan percetakan.

### `accounts_payable`
- **domain:** finance/ap
- **routes:** `/accounts-payable`
- **menu:** Hutang
- **permission:** `financial`
- **tables:** `accounts_payable.sql`, `purchase_orders.sql`
- **rpc/functions:** `09_receivable_payable.sql`, `08_purchase_order.sql`
- **workflow impact:** heavy
- **journal impact:** direct
- **printing priority:** keep
- **notes:** penting jika purchasing bahan baku dipakai.

### `financial_reports`
- **domain:** reporting/finance
- **routes:** `/financial-reports`
- **menu:** Laporan Keuangan
- **permission:** `financial`
- **tables:** berbasis `journal_entries`, `journal_entry_lines`, `accounts`, `cash_history`
- **rpc/functions:** `30_statistics.sql`, `05_accounting_journal.sql`
- **workflow impact:** none
- **journal impact:** indirect (read-side)
- **printing priority:** keep
- **notes:** lebih ke hasil baca, tapi penting untuk validasi mode baru.

### `tax`
- **domain:** compliance/tax
- **routes:** `/tax`
- **menu:** Pajak (PPN)
- **permission:** `financial`
- **tables:** tabel tax spesifik tidak terlihat di schema dump; kemungkinan memakai jurnal + transaksi + setting
- **rpc/functions:** `27_tax.sql`
- **workflow impact:** heavy
- **journal impact:** direct
- **printing priority:** optional
- **notes:** perlu dicek lebih detail saat masuk inventory jurnal event.

### `zakat`
- **domain:** compliance/zakat
- **routes:** `/zakat`
- **menu:** Zakat & Sedekah
- **permission:** `financial`
- **tables:** `zakat_records.sql`, `nishab_reference.sql`
- **rpc/functions:** `17_zakat.sql`
- **workflow impact:** light
- **journal impact:** direct
- **printing priority:** optional
- **notes:** bukan pembeda mode percetakan, tapi tetap bisa jadi feature toggle terpisah.

### `closing_entries`
- **domain:** accounting/period close
- **routes:** tidak tampak sebagai route khusus
- **menu:** none
- **permission:** finance/admin terkait
- **tables:** `closing_periods.sql`, `journal_entries.sql`
- **rpc/functions:** `05_accounting_journal.sql`, `closingEntryService.ts`
- **workflow impact:** light
- **journal impact:** direct
- **printing priority:** keep
- **notes:** penting untuk inventory journal-event walau belum muncul sebagai page utama.

---

## 5.6 Assets & support operations

### `assets`
- **domain:** assets
- **routes:** `/assets`
- **menu:** Aset & Maintenance
- **permission:** `financial`
- **tables:** `assets.sql`
- **rpc/functions:** `11_asset.sql`
- **workflow impact:** light
- **journal impact:** direct/indirect
- **printing priority:** optional
- **notes:** support feature.

### `maintenance`
- **domain:** assets/maintenance
- **routes:** `/maintenance`, `/mobile-maintenance`
- **menu:** Jadwal Maintenance
- **permission:** `financial`
- **tables:** `asset_maintenance.sql`
- **rpc/functions:** `11_asset.sql`
- **workflow impact:** light
- **journal impact:** indirect
- **printing priority:** optional
- **notes:** bisa relevan untuk mesin percetakan, tapi bukan fase awal config.

---

## 5.7 System / admin cluster

### `settings`
- **domain:** system
- **routes:** `/settings`, `/account-settings`
- **menu:** Pengaturan
- **permission:** `settings`
- **tables:** `company_settings.sql`
- **rpc/functions:** kemungkinan update biasa via client; belum resolver branch-specific
- **workflow impact:** none
- **journal impact:** none
- **printing priority:** keep
- **notes:** ini justru kandidat tempat masuk UI config di masa depan, tapi `company_settings` saat ini masih global.

### `roles_permissions`
- **domain:** security/admin
- **routes:** `/roles`
- **menu:** Manajemen Roles
- **permission:** `roles`
- **tables:** `roles.sql`, `role_permissions.sql`, `user_roles.sql`
- **rpc/functions:** `15_permission_role.sql`, `22_rls_security.sql`
- **workflow impact:** none
- **journal impact:** none
- **printing priority:** keep
- **notes:** harus tetap dipisah dari feature config branch.

### `branch_management`
- **domain:** system/organization
- **routes:** `/branches`
- **menu:** Manajemen Cabang
- **permission:** `settings`
- **tables:** `branches.sql`, `companies.sql`
- **rpc/functions:** branch-specific access logic ada di `BranchContext`, bukan di tabel config baru
- **workflow impact:** none
- **journal impact:** indirect
- **printing priority:** keep
- **notes:** ini kandidat tempat panel config per branch ditempel nanti.

### `audit_logs`
- **domain:** system/audit
- **routes:** `/audit-logs`
- **menu:** Log Aktivitas (Audit)
- **permission:** `settings` + role owner
- **tables:** `audit_logs.sql`
- **rpc/functions:** `21_audit_log.sql`
- **workflow impact:** none
- **journal impact:** none
- **printing priority:** keep
- **notes:** config system baru nanti perlu audit log sendiri / integrasi.

### `web_management`
- **domain:** owner/system ops
- **routes:** `/web-management`
- **menu:** Web Management
- **permission:** `settings` + role owner
- **tables:** referensi data category campuran; sebagian mismatch dengan schema dump
- **rpc/functions:** campuran / utility admin
- **workflow impact:** none
- **journal impact:** none
- **printing priority:** optional
- **notes:** halaman ini berguna sebagai bahan inventory karena sudah punya grouping domain, tapi daftar tabelnya harus dianggap belum sepenuhnya akurat.

### `company_archive`
- **domain:** system/documents
- **routes:** `/company-archive`
- **menu:** Arsip Berkas
- **permission:** `settings` + role owner
- **tables:** tidak terpetakan dari schema yang dibaca sekarang
- **rpc/functions:** belum dicek detail
- **workflow impact:** none
- **journal impact:** none
- **printing priority:** optional
- **notes:** bukan fokus phase-1 config.

---

## 6. Tabel schema inventory per domain

## 6.1 Sales / transaction
- `transactions.sql`
- `transaction_payments.sql`
- `payment_history.sql`
- `stock_pricings.sql`
- `bonus_pricings.sql`
- `quotations.sql`

## 6.2 Delivery / distribution
- `deliveries.sql`
- `delivery_items.sql`
- `delivery_photos.sql`
- `retasi.sql`
- `retasi_items.sql`

## 6.3 Inventory / production / purchasing
- `products.sql`
- `product_materials.sql`
- `product_stock_movements.sql`
- `materials.sql`
- `material_stock_movements.sql`
- `inventory_batches.sql`
- `inventory_batch_consumptions.sql`
- `production_records.sql`
- `production_errors.sql`
- `purchase_orders.sql`
- `purchase_order_items.sql`
- `suppliers.sql`
- `supplier_materials.sql`

## 6.4 Customer / people / HR
- `customers.sql`
- `customer_pricings.sql`
- `customer_visits.sql`
- `profiles.sql`
- `attendance.sql`
- `employee_advances.sql`
- `advance_repayments.sql`
- `employee_salaries.sql`
- `payroll_records.sql`
- `commission_rules.sql`
- `commission_entries.sql`

## 6.5 Finance / accounting
- `accounts.sql`
- `accounts_balance_backup.sql`
- `accounts_payable.sql`
- `receivables.sql`
- `cash_history.sql`
- `expenses.sql`
- `journal_entries.sql`
- `journal_entry_lines.sql`
- `manual_journal_entries.sql`
- `manual_journal_entry_lines.sql`
- `balance_adjustments.sql`
- `closing_periods.sql`
- `debt_installments.sql`

## 6.6 Compliance / support
- `tax` belum tampak sebagai table schema spesifik pada list yang dibaca
- `zakat_records.sql`
- `nishab_reference.sql`
- `assets.sql`
- `asset_maintenance.sql`
- `notifications.sql`
- `audit_logs.sql`
- `company_settings.sql`
- `branches.sql`
- `companies.sql`
- `active_sessions.sql`
- `roles.sql`
- `role_permissions.sql`
- `user_roles.sql`

---

## 7. RPC/function inventory per domain

## 7.1 Core ops
- `01_inventory_fifo.sql`
- `02_transactions.sql`
- `03_delivery.sql`
- `04_production.sql`
- `05_accounting_journal.sql`

## 7.2 Finance / purchasing / receivable
- `06_employee_advance.sql`
- `07_expense.sql`
- `08_purchase_order.sql`
- `09_receivable_payable.sql`
- `24_payment_history.sql`

## 7.3 Support domain
- `10_retasi.sql`
- `11_asset.sql`
- `12_payroll_salary.sql`
- `13_commission.sql`
- `14_stock_adjustment.sql`
- `17_zakat.sql`
- `18_customer_supplier.sql`
- `19_employee.sql`
- `27_tax.sql`
- `28_attendance.sql`
- `30_statistics.sql`

## 7.4 System / security / admin
- `15_permission_role.sql`
- `16_notification.sql`
- `20_trigger_functions.sql`
- `21_audit_log.sql`
- `22_rls_security.sql`
- `23_uuid_utility.sql`
- `29_user_management.sql`

---

## 8. Kandidat feature catalog phase-1

Ini daftar kandidat awal yang paling masuk akal untuk dimasukkan dulu ke `feature_catalog`:

### 8.1 Inti transaksi & produksi
- `sales_pos`
- `transactions`
- `quotations`
- `materials_stock`
- `products_catalog`
- `production`
- `purchase_orders`
- `suppliers`
- `customers`

### 8.2 Logistics / distribution
- `driver_pos`
- `delivery`
- `delivery_report`
- `retasi`
- `customer_map`

### 8.3 Finance
- `expenses_advances`
- `accounts`
- `journal`
- `cash_flow`
- `receivables`
- `accounts_payable`
- `financial_reports`
- `tax`
- `zakat`
- `closing_entries`

### 8.4 HR / support
- `employees`
- `attendance`
- `payroll`
- `commissions`
- `assets`
- `maintenance`

### 8.5 System
- `settings`
- `roles_permissions`
- `branch_management`
- `audit_logs`
- `web_management`
- `company_archive`
- `dashboard`

---

## 9. Kandidat printing pilot config

### 9.1 Default ON untuk branch percetakan awal
- `dashboard`
- `sales_pos`
- `transactions`
- `quotations`
- `materials_stock`
- `products_catalog`
- `production`
- `purchase_orders`
- `suppliers`
- `customers`
- `expenses_advances`
- `accounts`
- `journal`
- `cash_flow`
- `receivables`
- `accounts_payable`
- `financial_reports`
- `branch_management`

### 9.2 Default OFF kandidat kuat pada pilot awal
- `driver_pos`
- `delivery`
- `delivery_report`
- `retasi`
- `customer_map`
- `commissions` (jika belum perlu)
- `attendance` (jika belum masuk scope pilot)
- `zakat` (jika tidak dibutuhkan di pilot)
- `tax` (tergantung operasional dan kesiapan mapping)

---

## 10. Mismatch / warning yang harus diingat

### 10.1 Referensi yang tampak tidak sinkron dengan schema list yang dibaca
Di `WebManagementPage.tsx` ada referensi seperti:
- `transaction_items`
- `expense_categories`
- `branch_transfers`
- `loans`
- `loan_payments`
- `loan_payment_schedules`
- `material_inventory_batches`
- `material_usage_history`
- `stock_movements`

Tetapi file schema dengan nama yang sama **tidak terlihat** di `database/table_schemas/` saat dicek.

**Artinya:**
- bisa jadi nama tabel lama
- bisa jadi ada tabel di DB live tetapi belum tersinkron di repo dump
- bisa jadi hanya referensi backup/import lama

Jadi saat membuat seed/registry final, item-item ini harus diverifikasi ulang dulu.

### 10.2 Inconsistency kecil permission/menu
- Menu `Produksi` di sidebar memakai `PERMISSIONS.PRODUCTS`, bukan `PERMISSIONS.PRODUCTION`
- Hook permissions punya constant `production`, tapi sidebar route produksi belum memakainya langsung

**Artinya:**
- inventory ini juga membantu melihat area yang perlu dirapikan sebelum config system dibuat.

---

## 11. Next step setelah dokumen ini

Urutan paling tepat sesudah ini:

1. buat `config-ui-registry.md`
2. buat `config-journal-event-inventory.md`
3. bersihkan mismatch tabel/fitur lama
4. baru buat schema config (`feature_catalog`, `branch_feature_settings`, dst.)

Kalau mau eksekusi paling aman, fitur pertama yang dipakai sebagai pembuktian sistem adalah:
- `delivery`
- `retasi`
- `production`
- `quotations`

Karena di situlah pembeda paling nyata antara branch distribusi vs branch percetakan.