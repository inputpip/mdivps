# Config UI Registry for Aquvit / Matahari

> **Tujuan dokumen ini:** membuat draft registry komponen UI yang nanti bisa digate oleh sistem config fitur app global. Registry ini menjadi jembatan antara `feature_catalog` dan implementasi frontend seperti sidebar, route handling, widget dashboard, tombol aksi, section halaman, dan field form.

**Sumber verifikasi utama:**
- `src/App.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/pages/TransactionDetailPage.tsx`
- `src/pages/TransactionListPage.tsx`
- `src/pages/*`
- `src/components/*`

---

## 1. Prinsip registry UI

Setiap komponen UI yang bisa berubah dari config fitur app global harus punya:

- `component_key` unik
- `component_type`
  - `menu`
  - `route`
  - `widget`
  - `action`
  - `section`
  - `field`
- `feature_key` terkait
- `default_visible`
- `visibility_strategy`
  - `feature_driven` → ikut feature utama
  - `explicit_override` → bisa beda dari feature utama
- `source_file`
- `notes`

### Aturan desain penting

1. **Jangan langsung gate lewat label/menu text.**
   Harus ada `component_key` stabil.
2. **Menu dan route harus dipisah.**
   Menu hidden ≠ route diarahkan aman saat diakses manual.
3. **Action dan section penting harus dicatat juga.**
   Contoh: tombol `Input Pengantaran` di detail transaksi.
4. **Field sensitif workflow harus bisa digate.**
   Misal field delivery fee, delivery status, atau produksi.

---

## 2. Struktur `component_key` yang disarankan

Gunakan pola ini:

### Menu
- `menu.dashboard`
- `menu.sales_pos`
- `menu.delivery`

### Route
- `route.dashboard`
- `route.delivery`
- `route.quotations.new`

### Widget
- `widget.dashboard.production_queue`
- `widget.dashboard.sales_summary`

### Action
- `action.transaction.input_delivery`
- `action.transaction.generate_invoice_pdf`
- `action.report.transaction_items.export_excel`

### Section
- `section.transaction.delivery_management`
- `section.transaction.payment_summary`
- `section.settings.audit_logs`

### Field
- `field.transaction.delivery_fee`
- `field.transaction.driver_name`
- `field.production.start_at`

---

## 3. Registry menu draft

## 3.1 Section Utama

- `menu.dashboard`
  - type: `menu`
  - route: `/`
  - feature: `dashboard`
  - default_visible: `true`
  - strategy: `feature_driven`
  - source: `src/components/layout/Sidebar.tsx`

- `menu.sales_pos`
  - route: `/pos`
  - feature: `sales_pos`
  - default_visible: `true`

- `menu.driver_pos`
  - route: `/driver-pos`
  - feature: `driver_pos`
  - default_visible: `true`

- `menu.transactions`
  - route: `/transactions`
  - feature: `transactions`
  - default_visible: `true`

- `menu.quotations`
  - route: `/quotations`
  - feature: `quotations`
  - default_visible: `true`

- `menu.delivery`
  - route: `/delivery`
  - feature: `delivery`
  - default_visible: `true`

- `menu.delivery_report`
  - route: `/delivery-report`
  - feature: `delivery_report`
  - default_visible: `true`

- `menu.retasi`
  - route: `/retasi`
  - feature: `retasi`
  - default_visible: `true`

- `menu.transaction_items_report`
  - route: `/transaction-items-report`
  - feature: `sales_reports`
  - default_visible: `true`

- `menu.sales_reports`
  - route: `/sales-reports`
  - feature: `sales_reports`
  - default_visible: `true`

- `menu.attendance`
  - route: `/attendance`
  - feature: `attendance`
  - default_visible: `true`

- `menu.expenses_advances`
  - route: `/expenses`
  - feature: `expenses_advances`
  - default_visible: `true`

## 3.2 Section Manajemen Data

- `menu.materials_stock`
  - route: `/materials`
  - feature: `materials_stock`
  - default_visible: `true`

- `menu.production`
  - route: `/production`
  - feature: `production`
  - default_visible: `true`

- `menu.customers`
  - route: `/customers`
  - feature: `customers`
  - default_visible: `true`

- `menu.customer_map`
  - route: `/customer-map`
  - feature: `customer_map`
  - default_visible: `true`

- `menu.employees`
  - route: `/employees`
  - feature: `employees`
  - default_visible: `true`

- `menu.suppliers`
  - route: `/suppliers`
  - feature: `suppliers`
  - default_visible: `true`

- `menu.purchase_orders`
  - route: `/purchase-orders`
  - feature: `purchase_orders`
  - default_visible: `true`

## 3.3 Section Keuangan

- `menu.accounts`
  - route: `/accounts`
  - feature: `accounts`
  - default_visible: `true`

- `menu.journal`
  - route: `/journal`
  - feature: `journal`
  - default_visible: `true`

- `menu.cash_flow`
  - route: `/cash-flow`
  - feature: `cash_flow`
  - default_visible: `true`

- `menu.receivables`
  - route: `/receivables`
  - feature: `receivables`
  - default_visible: `true`

- `menu.accounts_payable`
  - route: `/accounts-payable`
  - feature: `accounts_payable`
  - default_visible: `true`

- `menu.financial_reports`
  - route: `/financial-reports`
  - feature: `financial_reports`
  - default_visible: `true`

## 3.4 Section Aset, Zakat & Pajak

- `menu.assets`
  - route: `/assets`
  - feature: `assets`
  - default_visible: `true`

- `menu.maintenance`
  - route: `/maintenance`
  - feature: `maintenance`
  - default_visible: `true`

- `menu.zakat`
  - route: `/zakat`
  - feature: `zakat`
  - default_visible: `true`

- `menu.tax`
  - route: `/tax`
  - feature: `tax`
  - default_visible: `true`

## 3.5 Section Laporan

- `menu.stock_report`
  - route: `/stock-report`
  - feature: `materials_stock`
  - default_visible: `true`

- `menu.material_movements`
  - route: `/material-movements`
  - feature: `materials_stock`
  - default_visible: `true`

- `menu.attendance_report`
  - route: `/attendance/report`
  - feature: `attendance`
  - default_visible: `true`

- `menu.commission_report`
  - route: `/commission-report`
  - feature: `commissions`
  - default_visible: `true`

## 3.6 Section Pengaturan

- `menu.settings`
  - route: `/settings`
  - feature: `settings`
  - default_visible: `true`

- `menu.roles`
  - route: `/roles`
  - feature: `roles_permissions`
  - default_visible: `true`

- `menu.branches`
  - route: `/branches`
  - feature: `branch_management`
  - default_visible: `true`

- `menu.web_management`
  - route: `/web-management`
  - feature: `web_management`
  - default_visible: `true`
  - strategy: `explicit_override`
  - notes: owner only

- `menu.company_archive`
  - route: `/company-archive`
  - feature: `company_archive`
  - default_visible: `true`
  - strategy: `explicit_override`
  - notes: owner only

- `menu.audit_logs`
  - route: `/audit-logs`
  - feature: `audit_logs`
  - default_visible: `true`
  - strategy: `explicit_override`
  - notes: owner only

---

## 4. Registry route draft

## 4.1 Public route
- `route.login`
  - path: `/login`
  - feature: `auth_public`
  - default_visible: `true`
  - type: `route`
  - notes: jangan ikut feature branch biasa

## 4.2 Shared/core routes
- `route.dashboard` → `/`
- `route.sales_pos` → `/pos`
- `route.transactions.list` → `/transactions`
- `route.transactions.detail` → `/transactions/:id`
- `route.customers.list` → `/customers`
- `route.customers.detail` → `/customers/:id`
- `route.employees.list` → `/employees`
- `route.quotations.list` → `/quotations`
- `route.quotations.new` → `/quotations/new`
- `route.journal` → `/journal`

## 4.3 Logistics/distribution routes
- `route.driver_pos` → `/driver-pos`
- `route.delivery` → `/delivery`
- `route.delivery_report` → `/delivery-report`
- `route.retasi` → `/retasi`
- `route.customer_map` → `/customer-map`

## 4.4 Production/inventory/purchasing routes
- `route.products.list` → `/products`
- `route.products.detail` → `/products/:id`
- `route.materials.list` → `/materials`
- `route.materials.detail` → `/materials/:materialId`
- `route.production` → `/production`
- `route.warehouse` → `/warehouse`
- `route.purchase_orders` → `/purchase-orders`
- `route.suppliers` → `/suppliers`
- `route.stock_report` → `/stock-report`
- `route.material_movements` → `/material-movements`
- `route.material_usage_summary` → `/material-usage-summary`
- `route.service_material_report` → `/service-material-report`

## 4.5 Finance routes
- `route.accounts.list` → `/accounts`
- `route.accounts.detail` → `/accounts/:id`
- `route.account_settings` → `/account-settings`
- `route.receivables` → `/receivables`
- `route.accounts_payable` → `/accounts-payable`
- `route.expenses` → `/expenses`
- `route.advances` → `/advances`
- `route.cash_flow` → `/cash-flow`
- `route.financial_reports` → `/financial-reports`
- `route.tax` → `/tax`
- `route.zakat` → `/zakat`

## 4.6 HR/support routes
- `route.attendance` → `/attendance`
- `route.attendance_report` → `/attendance/report`
- `route.payroll` → `/payroll`
- `route.commission_report` → `/commission-report`
- `route.mobile_commission` → `/my-commission`
- `route.mobile_maintenance` → `/mobile-maintenance`

## 4.7 Admin/system routes
- `route.settings` → `/settings`
- `route.roles` → `/roles`
- `route.branches` → `/branches`
- `route.web_management` → `/web-management`
- `route.company_archive` → `/company-archive`
- `route.audit_logs` → `/audit-logs`

## 4.8 Mobile-specific routes
- `route.mobile_sold_items` → `/sold-items`
- `route.mobile_sales_report` → `/mobile-sales-report`
- `route.mobile_delivery_report` → `/delivery-report`
- `route.mobile_expenses` → `/expenses`

### Catatan penting
- route seperti `/delivery-report` dan `/expenses` dipakai juga di mobile. Jadi `component_key` route tetap satu, tapi implementasi UI wrapper-nya bisa beda.
- `route.dashboard` di mobile sekarang sebenarnya menuju `PosPage`, sedangkan desktop ke `DashboardPage`. Ini perlu dicatat sebagai edge case resolver.

---

## 5. Registry section draft

Section dipakai untuk mengontrol blok UI dalam page, bukan seluruh page.

## 5.1 Kandidat penting dari `TransactionDetailPage.tsx`

- `section.transaction.delivery_management`
  - feature: `delivery`
  - source: `src/pages/TransactionDetailPage.tsx`
  - evidence: import/use `DeliveryManagement`
  - default_visible: `true`
  - notes: salah satu section paling penting untuk gating percetakan

- `section.transaction.delivery_completion_dialog`
  - feature: `delivery`
  - source: `src/pages/TransactionDetailPage.tsx`
  - default_visible: `true`

- `section.transaction.payment_summary`
  - feature: `transactions`
  - source: `src/pages/TransactionDetailPage.tsx`
  - default_visible: `true`

- `section.transaction.invoice_export`
  - feature: `transactions`
  - source: `src/pages/TransactionDetailPage.tsx`
  - default_visible: `true`

## 5.2 Kandidat section dashboard

Belum diinventaris detail dari file `DashboardPage.tsx`, tetapi registry awal sebaiknya sudah menyiapkan namespace:

- `section.dashboard.sales_summary`
- `section.dashboard.production_summary`
- `section.dashboard.delivery_summary`
- `section.dashboard.receivables_summary`
- `section.dashboard.expense_summary`

### Catatan
Dokumen ini baru draft. Begitu `DashboardPage.tsx` diinspeksi, item ini harus diisi dengan source file dan default visibility yang pasti.

---

## 6. Registry action draft

Action adalah komponen UI yang paling sering bocor walau menu/route sudah ditutup.

## 6.1 Transaction actions

- `action.transaction.input_delivery`
  - feature: `delivery`
  - source: `src/pages/TransactionDetailPage.tsx`
  - evidence: tombol “Input Pengantaran”
  - default_visible: `true`
  - notes: harus hilang jika branch percetakan mematikan delivery

- `action.transaction.generate_invoice_pdf`
  - feature: `transactions`
  - source: `src/pages/TransactionDetailPage.tsx`
  - evidence: tombol “Simpan PDF”
  - default_visible: `true`

- `action.transaction.back_to_list`
  - feature: `transactions`
  - source: `src/pages/TransactionDetailPage.tsx`
  - default_visible: `true`

## 6.2 Transaction list actions

Dari hasil inspeksi sebelumnya, `TransactionListPage.tsx` punya tombol navigasi cepat ke domain lain. Ini kandidat gate penting:

- `action.transaction_list.open_delivery`
  - feature: `delivery`
  - default_visible: `true`

- `action.transaction_list.open_cash_flow`
  - feature: `cash_flow`
  - default_visible: `true`

- `action.transaction_list.open_receivables`
  - feature: `receivables`
  - default_visible: `true`

## 6.3 Report actions

- `action.report.transaction_items.generate`
  - feature: `sales_reports`
  - source: `src/components/TransactionItemsReport.tsx`
  - default_visible: `true`

- `action.report.transaction_items.print_pdf`
  - feature: `sales_reports`
  - source: `src/components/TransactionItemsReport.tsx`
  - default_visible: `true`

- `action.report.transaction_items.export_excel`
  - feature: `sales_reports`
  - source: `src/components/TransactionItemsReport.tsx`
  - default_visible: `true`

## 6.4 Settings/admin actions

- `action.permissions.save_user_permissions`
  - feature: `roles_permissions`
  - source: `src/components/UserPermissionTab.tsx`
  - default_visible: `true`

- `action.vps_settings.check_status`
  - feature: `web_management`
  - source: `src/components/VPSServerSettings.tsx`
  - default_visible: `true`

- `action.vps_settings.save`
  - feature: `web_management`
  - source: `src/components/VPSServerSettings.tsx`
  - default_visible: `true`

---

## 7. Registry field draft

Field gating dipakai ketika branch mematikan feature tertentu tetapi page induknya masih aktif.

## 7.1 Transaction-related fields

- `field.transaction.delivery_info`
  - feature: `delivery`
  - source: `TransactionDetailPage` / delivery forms
  - default_visible: `true`

- `field.transaction.delivery_status`
  - feature: `delivery`
  - default_visible: `true`

- `field.transaction.delivery_fee`
  - feature: `delivery`
  - default_visible: `true`
  - notes: sangat penting juga untuk journal mapping

- `field.transaction.driver_assignment`
  - feature: `driver_pos`
  - default_visible: `true`

## 7.2 Production-related fields

- `field.production.start_at`
  - feature: `production`
  - default_visible: `true`

- `field.production.finish_at`
  - feature: `production`
  - default_visible: `true`

- `field.production.material_consumption`
  - feature: `production`
  - default_visible: `true`

## 7.3 Quotation-related fields

- `field.quotation.reference_number`
  - feature: `quotations`
  - default_visible: `true`

- `field.quotation.valid_until`
  - feature: `quotations`
  - default_visible: `true`

### Catatan
Field registry di atas masih kandidat awal. Saat masuk implementasi, tiap page form perlu dicek detail satu per satu.

---

## 8. Component registry phase-1 yang paling penting

Kalau mau MVP cepat, jangan daftarkan semuanya dulu. Prioritaskan yang paling terasa bedanya untuk branch percetakan.

## 8.1 Wajib masuk phase-1

### Menu
- `menu.delivery`
- `menu.delivery_report`
- `menu.retasi`
- `menu.driver_pos`
- `menu.production`
- `menu.quotations`
- `menu.purchase_orders`

### Route
- `route.delivery`
- `route.delivery_report`
- `route.retasi`
- `route.driver_pos`
- `route.production`
- `route.quotations.list`
- `route.quotations.new`

### Section / Action
- `section.transaction.delivery_management`
- `section.transaction.delivery_completion_dialog`
- `action.transaction.input_delivery`
- `action.transaction_list.open_delivery`

### Field
- `field.transaction.delivery_fee`
- `field.transaction.delivery_status`
- `field.transaction.driver_assignment`

## 8.2 Kenapa ini dulu
Karena area ini yang paling jelas membedakan:
- branch distribusi
- branch percetakan

Jadi kalau registry ini berhasil, kita langsung bisa buktikan konsep config-driven tanpa menyentuh semua page sekaligus.

---

## 9. Bentuk data registry yang disarankan untuk seed

Contoh shape untuk `ui_component_registry`:

```json
{
  "component_key": "menu.delivery",
  "component_type": "menu",
  "label": "Pengantaran",
  "route_path": "/delivery",
  "feature_key": "delivery",
  "default_visible": true,
  "config": {
    "section": "Utama",
    "mobile_supported": true,
    "desktop_supported": true,
    "permission_dependency": "deliveries"
  }
}
```

Contoh route:

```json
{
  "component_key": "route.delivery",
  "component_type": "route",
  "label": "Delivery Page",
  "route_path": "/delivery",
  "feature_key": "delivery",
  "default_visible": true,
  "config": {
    "guard_type": "feature_and_permission",
    "fallback_route": "/"
  }
}
```

Contoh action:

```json
{
  "component_key": "action.transaction.input_delivery",
  "component_type": "action",
  "label": "Input Pengantaran",
  "feature_key": "delivery",
  "default_visible": true,
  "config": {
    "source_page": "TransactionDetailPage",
    "placement": "header_actions"
  }
}
```

---

## 10. Warning / edge cases dari repo saat ini

### 10.1 Route `/` tidak konsisten antara mobile dan desktop
- mobile `/` → `PosPage`
- desktop `/` → `DashboardPage`

Jadi untuk registry:
- jangan menganggap `route.dashboard` cukup sederhana
- mungkin perlu `route.home.mobile` dan `route.home.desktop`, atau config internal pada route `/`

### 10.2 Beberapa route tidak punya menu langsung
Contoh:
- `/products`
- `/products/:id`
- `/materials/:materialId`
- `/payroll`
- `/advances`
- `/account-settings`
- `/material-usage-summary`
- `/service-material-report`

Artinya:
- route registry harus lebih lengkap daripada menu registry
- jangan membangun gating hanya dari daftar menu

### 10.3 Beberapa action/section penting masih tersembunyi di dalam page
Contoh paling jelas:
- `DeliveryManagement` di `TransactionDetailPage.tsx`
- tombol `Input Pengantaran`

Artinya:
- walau menu/route delivery disembunyikan, UI masih bisa bocor kalau section/action tidak ikut dicatat

---

## 11. Next step setelah UI registry ini

Urutan paling tepat setelah dokumen ini:

1. buat `config-journal-event-inventory.md`
2. buat schema `ui_component_registry` dan `branch_ui_settings`
3. implementasikan registry menu dulu di `Sidebar.tsx`
4. lanjut route guard di `App.tsx`
5. lanjut gate action/section delivery di `TransactionDetailPage.tsx`

Kalau mau jalur MVP paling aman, implementasi pertama yang saya sarankan adalah:
- `menu.delivery`
- `route.delivery`
- `section.transaction.delivery_management`
- `action.transaction.input_delivery`

Karena itu cukup untuk membuktikan bahwa branch percetakan bisa hidup tanpa jejak UI delivery.