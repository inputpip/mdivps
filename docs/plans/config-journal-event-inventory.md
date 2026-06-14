# Config Journal Event Inventory for Aquvit / Matahari

> **Tujuan dokumen ini:** memetakan event jurnal yang sudah ada di codebase Aquvit/Matahari, membedakan mana yang masih hardcoded vs mana yang cocok dijadikan config-driven per branch, lalu menyiapkan pondasi untuk `journal_event_registry` dan `branch_journal_settings`.

**Sumber verifikasi utama:**
- `database/table_schemas/journal_entries.sql`
- `database/rpc_by_function/02_transactions.sql`
- `database/rpc_by_function/03_delivery.sql`
- `database/rpc_by_function/04_production.sql`
- `database/rpc_by_function/05_accounting_journal.sql`
- `database/rpc_by_function/06_employee_advance.sql`
- `database/rpc_by_function/07_expense.sql`
- `database/rpc_by_function/08_purchase_order.sql`
- `database/rpc_by_function/09_receivable_payable.sql`
- `database/rpc_by_function/10_retasi.sql`
- `database/rpc_by_function/11_asset.sql`
- `database/rpc_by_function/12_payroll_salary.sql`
- `database/rpc_by_function/13_commission.sql`
- `database/rpc_by_function/14_stock_adjustment.sql`
- `database/rpc_by_function/17_zakat.sql`
- `database/rpc_by_function/24_payment_history.sql`
- `database/rpc_by_function/27_tax.sql`

---

## 1. Kenapa inventory jurnal ini penting

Untuk mode fokus percetakan, kita tidak cukup hanya menyembunyikan menu delivery atau retasi.

Kalau branch percetakan mematikan fitur distribusi, maka harus jelas juga:
- event jurnal apa yang **tidak boleh lagi tercipta**,
- event mana yang **tetap wajib ada**,
- event mana yang **perlu fallback** ke jalur lain,
- dan event mana yang **lebih aman di-skip** daripada dipaksa posting dengan mapping yang salah.

Masalah utama codebase saat ini:
- banyak proses bisnis langsung membuat jurnal di RPC,
- akun dipilih hardcoded berdasarkan `code` atau asumsi tertentu,
- keputusan `buat jurnal / jangan buat jurnal / void jurnal` belum punya lapisan config branch,
- `reference_type` sekarang dipakai sebagai label teknis, tetapi **belum cukup** untuk menjadi registry event bisnis.

Jadi yang perlu kita bangun bukan sekadar daftar `reference_type`, tetapi daftar **`journal_event_key`** yang lebih presisi.

---

## 2. Fakta schema saat ini

Di `database/table_schemas/journal_entries.sql`, kolom `reference_type` saat ini dibatasi oleh constraint berikut:

- `transaction`
- `expense`
- `payroll`
- `transfer`
- `manual`
- `adjustment`
- `closing`
- `opening`
- `opening_balance`
- `receivable_payment`
- `advance`
- `advance_payment`
- `payable_payment`
- `purchase`
- `purchase_order`
- `receivable`
- `payable`
- `production`
- `production_error`
- `tax_payment`
- `zakat`
- `asset`
- `commission`
- `debt_installment`

### Catatan penting

1. Constraint ini adalah **label teknis jurnal**, bukan event bisnis lengkap.
2. Satu `reference_type` bisa mewakili banyak event bisnis berbeda.
   - contoh: `transaction` bisa berarti penjualan tunai, penjualan piutang, penjualan dengan PPN, penjualan office sale, dsb.
3. Ada indikasi sebagian fungsi lama/migrasi memakai label di luar daftar utama.
   - misalnya di file delivery ada jejak `migration_delivery`
4. Jadi desain config baru **jangan bergantung penuh pada `reference_type`**.

---

## 3. Prinsip desain inventory event jurnal

### 3.1 Pisahkan `reference_type` dari `journal_event_key`

Gunakan pola berikut:

- `reference_type` = label teknis header jurnal yang sudah ada di DB
- `journal_event_key` = identitas event bisnis untuk resolver config

Contoh:
- `reference_type = transaction`
- `journal_event_key` bisa menjadi:
  - `sales.invoice.cash`
  - `sales.invoice.credit`
  - `sales.hpp.office_sale`
  - `sales.hpp.delivery_sale`

### 3.2 Satu event harus bisa menentukan policy

Setiap `journal_event_key` nantinya minimal punya policy:
- `required` → wajib posting, kalau gagal harus error
- `optional` → boleh skip dengan warning
- `disabled` → jangan posting sama sekali
- `reroute` → posting tetap jalan, tapi akun / rule berbeda

### 3.3 Branch percetakan butuh whitelist sederhana

Untuk phase awal mode percetakan, lebih aman pakai pendekatan:
- tentukan dulu event inti yang **boleh hidup**,
- tandai event distribusi sebagai `disabled` atau `not_applicable`,
- baru setelah itu tambahkan exception per branch.

---

## 4. Struktur `journal_event_key` yang disarankan

Gunakan pola domain berikut:

### Penjualan
- `sales.invoice.cash`
- `sales.invoice.credit`
- `sales.receivable.payment`
- `sales.delivery.release`
- `sales.return.retasi`
- `sales.commission.payment`

### Produksi & persediaan
- `inventory.adjustment.product`
- `inventory.adjustment.material`
- `inventory.opening.balance`
- `production.finish_goods`
- `production.material_spoilage`

### Pembelian & hutang
- `purchasing.po.receipt_cash`
- `purchasing.po.receipt_payable`
- `purchasing.payable.create`
- `purchasing.payable.payment`
- `purchasing.material.cash_purchase`

### Operasional & SDM
- `expense.operational`
- `hr.advance.issue`
- `hr.advance.repayment`
- `hr.payroll.post`
- `finance.debt.installment`

### Keuangan & kepatuhan
- `finance.manual.cash_in`
- `finance.manual.cash_out`
- `finance.closing.entry`
- `finance.tax.payment`
- `finance.zakat.payment`
- `finance.asset.acquisition`
- `finance.asset.depreciation`

---

## 5. Inventory event jurnal yang terverifikasi dari codebase

## 5.1 Domain transaksi penjualan

### A. Penjualan transaksi utama
- sumber utama:
  - `database/rpc_by_function/02_transactions.sql`
  - `database/rpc_by_function/05_accounting_journal.sql` (`create_sales_journal_rpc`)
- `reference_type` aktif: `transaction`
- kandidat `journal_event_key`:
  - `sales.invoice.cash`
  - `sales.invoice.credit`
  - `sales.invoice.ppn`
  - `sales.hpp.office_sale`
  - `sales.hpp.delivery_sale`
- catatan:
  - ini event paling inti; **harus tetap hidup** di mode percetakan
  - tetapi komponennya perlu dipisah, karena tidak semua sales punya pola stok dan penagihan yang sama
  - jika branch percetakan tetap pakai piutang, event `sales.invoice.credit` harus hidup
  - jika branch tertentu hanya pakai cash/simple order, event credit bisa dimatikan

### B. Pembayaran piutang pelanggan
- sumber utama:
  - `database/rpc_by_function/09_receivable_payable.sql`
  - `database/rpc_by_function/05_accounting_journal.sql` (`create_receivable_payment_journal_rpc`)
  - `database/rpc_by_function/24_payment_history.sql`
- `reference_type` aktif: `receivable_payment`
- kandidat `journal_event_key`:
  - `sales.receivable.payment`
  - `sales.receivable.payment.void`
- catatan:
  - ini masih relevan untuk percetakan bila order boleh tempo
  - jangan digantung ke menu delivery; domainnya berbeda

### C. Delivery penjualan
- sumber utama:
  - `database/rpc_by_function/03_delivery.sql`
- `reference_type` aktif: `delivery`
- kandidat `journal_event_key`:
  - `sales.delivery.release`
  - `sales.delivery.void`
- catatan:
  - sangat kuat terkait mode distribusi
  - untuk branch percetakan yang tidak pakai pengantaran, event ini kandidat utama untuk `disabled`
  - bila suatu hari ada branch percetakan yang tetap kirim barang jadi, event ini bisa diaktifkan kembali via config

### D. Retasi
- sumber utama:
  - `database/rpc_by_function/10_retasi.sql`
- `reference_type` aktif: `retasi`
- kandidat `journal_event_key`:
  - `sales.return.retasi`
  - `sales.return.retasi.void`
- catatan:
  - sangat distribusi-spesifik
  - kandidat kuat untuk dimatikan di branch percetakan phase awal

### E. Komisi penjualan
- sumber utama:
  - `database/rpc_by_function/13_commission.sql`
- `reference_type` aktif di kode terverifikasi: `commission_payment`
- constraint schema saat ini hanya menyebut `commission`
- kandidat `journal_event_key`:
  - `sales.commission.payment`
  - `sales.commission.payment.void`
- catatan penting:
  - ada gap antara label schema vs implementasi aktual; ini perlu dibersihkan saat implementasi
  - untuk branch percetakan, event ini bisa `disabled` jika tidak ada model komisi

---

## 5.2 Domain produksi & persediaan

### A. Produksi barang jadi
- sumber utama:
  - `database/rpc_by_function/04_production.sql`
- `reference_type` aktif: `production`
- kandidat `journal_event_key`:
  - `production.finish_goods`
- pola jurnal yang terlihat:
  - Dr `1310` Persediaan Barang Dagang
  - Cr `1320` Persediaan Bahan Baku
- catatan:
  - ini event kunci untuk mode fokus percetakan
  - harus termasuk whitelist utama branch percetakan
  - nanti jangan hardcoded ke akun 1310/1320 saja; pindahkan ke mapping config

### B. Bahan rusak / spoilage produksi
- sumber utama:
  - `database/rpc_by_function/04_production.sql` (`process_spoilage_atomic`)
- `reference_type` aktif di jurnal: `adjustment`
- kandidat `journal_event_key`:
  - `production.material_spoilage`
- pola jurnal yang terlihat:
  - Dr `8100` Beban Lain-lain
  - Cr `1320` Persediaan Bahan Baku
- catatan:
  - secara bisnis ini lebih spesifik daripada `adjustment`
  - cocok jadi contoh kenapa `journal_event_key` harus dipisah dari `reference_type`
  - sangat relevan untuk percetakan

### C. Penyesuaian stok produk
- sumber utama:
  - `database/rpc_by_function/14_stock_adjustment.sql`
- `reference_type` aktif: `adjustment`
- kandidat `journal_event_key`:
  - `inventory.adjustment.product`
- catatan:
  - tetap dibutuhkan di banyak branch
  - tetapi akun lawannya mungkin beda per branch

### D. Penyesuaian stok material
- sumber utama:
  - `database/rpc_by_function/14_stock_adjustment.sql`
- `reference_type` aktif: `adjustment`
- kandidat `journal_event_key`:
  - `inventory.adjustment.material`
- catatan:
  - sangat relevan untuk percetakan karena bahan baku lebih dominan

### E. Saldo awal persediaan
- sumber utama:
  - `database/rpc_by_function/05_accounting_journal.sql` (`create_inventory_opening_balance_journal_rpc`)
- `reference_type` aktif: `opening_balance`
- kandidat `journal_event_key`:
  - `inventory.opening.balance`
- catatan:
  - perlu tetap ada untuk bootstrap branch baru / DB baru

---

## 5.3 Domain pembelian, hutang, material

### A. Purchase order / penerimaan barang
- sumber utama:
  - `database/rpc_by_function/08_purchase_order.sql`
- `reference_type` aktif: `purchase_order`
- kandidat `journal_event_key`:
  - `purchasing.po.receipt_cash`
  - `purchasing.po.receipt_payable`
  - `purchasing.po.payment`
  - `purchasing.po.void`
- catatan:
  - sangat mungkin tetap relevan untuk percetakan karena bahan baku dibeli dari supplier
  - jangan dimatikan hanya karena ini bukan modul distribusi

### B. Pembentukan hutang usaha
- sumber utama:
  - `database/rpc_by_function/05_accounting_journal.sql` (`create_accounts_payable_atomic`)
- `reference_type` aktif: `payable`
- kandidat `journal_event_key`:
  - `purchasing.payable.create`
- catatan:
  - masih relevan jika pembelian bahan baku bisa kredit/tempo

### C. Pembayaran hutang material / supplier
- sumber utama:
  - `database/rpc_by_function/05_accounting_journal.sql` (`create_material_payment_journal_rpc` dan fungsi terkait)
- `reference_type` kemungkinan aktif: `payable_payment` atau label sejenis tergantung jalur fungsi
- kandidat `journal_event_key`:
  - `purchasing.payable.payment`
  - `purchasing.material.cash_purchase`
- catatan:
  - perlu diverifikasi lebih detail saat implementasi schema registry
  - untuk planning saat ini cukup diinventaris sebagai domain wajib pembelian

---

## 5.4 Domain expense, payroll, advance, asset, compliance

### A. Expense operasional
- sumber utama:
  - `database/rpc_by_function/07_expense.sql`
- `reference_type` aktif: `expense`
- kandidat `journal_event_key`:
  - `expense.operational`
  - `expense.operational.void`
- catatan:
  - tetap relevan untuk semua branch

### B. Uang muka karyawan
- sumber utama:
  - `database/rpc_by_function/06_employee_advance.sql`
- `reference_type` aktif: `advance`
- kandidat `journal_event_key`:
  - `hr.advance.issue`
  - `hr.advance.repayment`
  - `hr.advance.void`
- catatan:
  - tidak spesifik distribusi, jadi bisa tetap hidup jika bisnis butuh

### C. Payroll / gaji
- sumber utama:
  - `database/rpc_by_function/12_payroll_salary.sql`
- `reference_type` aktif: `payroll`
- kandidat `journal_event_key`:
  - `hr.payroll.post`
  - `hr.payroll.void`
- catatan:
  - tetap relevan untuk percetakan bila tenaga produksi dicatat payroll

### D. Asset tetap
- sumber utama:
  - `database/rpc_by_function/11_asset.sql`
- `reference_type` aktif: `asset`
- kandidat `journal_event_key`:
  - `finance.asset.acquisition`
  - `finance.asset.depreciation`
  - `finance.asset.update`
  - `finance.asset.void`
- catatan:
  - relevan lintas branch

### E. Pajak
- sumber utama:
  - `database/rpc_by_function/27_tax.sql`
- `reference_type` aktif: `tax_payment`
- kandidat `journal_event_key`:
  - `finance.tax.payment`
- catatan:
  - bisa branch-specific bila tidak semua branch mengelola PPN dengan cara sama

### F. Zakat
- sumber utama:
  - `database/rpc_by_function/17_zakat.sql`
- `reference_type` aktif: `zakat`
- kandidat `journal_event_key`:
  - `finance.zakat.payment`
  - `finance.zakat.void`
- catatan:
  - ini sangat cocok dijadikan feature + journal policy per branch

### G. Manual cash in / cash out
- sumber utama:
  - `database/rpc_by_function/05_accounting_journal.sql`
- `reference_type` aktif kemungkinan: `manual`
- kandidat `journal_event_key`:
  - `finance.manual.cash_in`
  - `finance.manual.cash_out`
- catatan:
  - perlu tetap ada, tapi akun offset harus bisa dikonfigurasi

### H. Closing & opening
- sumber utama:
  - `database/rpc_by_function/05_accounting_journal.sql`
- `reference_type` aktif: `closing_entry`, `opening_balance`
- kandidat `journal_event_key`:
  - `finance.closing.entry`
  - `finance.opening.balance`
- catatan:
  - event backoffice, bukan mode bisnis utama, tapi tetap perlu registry

---

## 6. Klasifikasi awal untuk branch fokus percetakan

### 6.1 Event yang kemungkinan **wajib hidup**
- `sales.invoice.cash`
- `sales.invoice.credit` *(jika ada tempo)*
- `sales.receivable.payment` *(jika pakai piutang)*
- `production.finish_goods`
- `production.material_spoilage`
- `inventory.adjustment.product`
- `inventory.adjustment.material`
- `inventory.opening.balance`
- `purchasing.po.receipt_cash`
- `purchasing.po.receipt_payable`
- `purchasing.payable.create`
- `purchasing.payable.payment`
- `expense.operational`
- `hr.payroll.post` *(jika payroll dipakai)*
- `finance.manual.cash_in`
- `finance.manual.cash_out`

### 6.2 Event yang kemungkinan **opsional**
- `sales.commission.payment`
- `hr.advance.issue`
- `hr.advance.repayment`
- `finance.tax.payment`
- `finance.zakat.payment`
- `finance.asset.acquisition`
- `finance.asset.depreciation`

### 6.3 Event yang kemungkinan **dimatikan phase awal**
- `sales.delivery.release`
- `sales.delivery.void`
- `sales.return.retasi`
- `sales.return.retasi.void`

### Catatan penting

Ini **bukan keputusan final bisnis**. Ini hanya klasifikasi awal berdasarkan arah mode percetakan yang sudah kita sepakati:
- fokus ke status order,
- fokus ke report produksi,
- tidak menganggap delivery sebagai prioritas utama.

---

## 7. Struktur tabel yang disarankan

## 7.1 `journal_event_registry`

Tujuan:
- master daftar event jurnal bisnis resmi

Usulan kolom:
- `id uuid pk`
- `event_key text unique`
- `event_name text`
- `domain text`
- `reference_type text null`
- `feature_key text null`
- `description text`
- `default_policy text`
  - `required`
  - `optional`
  - `disabled`
  - `reroute`
- `supports_branch_override boolean`
- `source_file text`
- `notes text`
- `created_at timestamptz`
- `updated_at timestamptz`

Contoh data:
- `production.finish_goods`
- `reference_type = production`
- `feature_key = production`
- `default_policy = required`

## 7.2 `journal_event_account_templates`

Tujuan:
- mendefinisikan template line jurnal untuk tiap event

Usulan kolom:
- `id uuid pk`
- `event_key text fk journal_event_registry.event_key`
- `line_order int`
- `entry_side text` → `debit` / `credit`
- `account_role_key text`
- `amount_formula text`
- `is_required boolean`
- `notes text`

Contoh `account_role_key`:
- `inventory_finished_goods`
- `inventory_raw_material`
- `expense_spoilage`
- `revenue_sales`
- `receivable_trade`
- `cash_main`

## 7.3 `branch_journal_settings`

Tujuan:
- override policy event per branch

Usulan kolom:
- `id uuid pk`
- `branch_id uuid fk branches.id`
- `event_key text fk journal_event_registry.event_key`
- `policy text`
  - `inherit_default`
  - `required`
  - `optional`
  - `disabled`
  - `reroute`
- `config jsonb`
- `updated_by uuid`
- `updated_at timestamptz`

Contoh `config`:
```json
{
  "skip_reason": "Branch percetakan tidak memakai pengantaran",
  "fallback_event_key": null,
  "override_accounts": {
    "inventory_raw_material": "1320-MKW-PRINT"
  }
}
```

## 7.4 `branch_account_role_mappings`

Tujuan:
- memetakan role akun ke akun riil per branch

Usulan kolom:
- `id uuid pk`
- `branch_id uuid fk branches.id`
- `account_role_key text`
- `account_id uuid/text`
- `is_required boolean`
- `updated_at timestamptz`

Kenapa perlu tabel ini?
Karena phase berikutnya kita harus berhenti memilih akun langsung dari hardcoded `code = '1310'`, `1320`, `4100`, `8100`, dan seterusnya.

---

## 8. Resolver yang disarankan

Saat suatu proses mau membuat jurnal, alurnya idealnya menjadi:

1. proses bisnis menentukan `event_key`
2. resolver membaca `journal_event_registry`
3. resolver membaca `branch_journal_settings`
4. resolver membaca `branch_account_role_mappings`
5. resolver memutuskan:
   - lanjut posting
   - skip
   - reroute
   - error karena mapping wajib belum lengkap
6. baru generate line jurnal final
7. baru panggil `create_journal_atomic`

Dengan begitu, `create_journal_atomic` tetap dipakai sebagai mesin posting umum,
sedangkan keputusan bisnisnya pindah ke lapisan resolver config.

---

## 9. Urutan implementasi yang paling aman

### Phase 1 — registry & inventory
1. buat seed awal `journal_event_registry`
2. isi event inti yang sudah terverifikasi
3. isi `branch_journal_settings` untuk branch percetakan pilot

### Phase 2 — account role mapping
1. buat `branch_account_role_mappings`
2. map role akun dasar:
   - kas
   - piutang
   - pendapatan penjualan
   - persediaan barang jadi
   - persediaan bahan baku
   - beban spoilage
   - hutang usaha

### Phase 3 — implementasi event paling penting
Mulai dari event yang paling dekat dengan mode percetakan:
1. `production.finish_goods`
2. `production.material_spoilage`
3. `sales.invoice.cash`
4. `sales.invoice.credit`
5. `purchasing.po.receipt_cash` / `purchasing.po.receipt_payable`

### Phase 4 — disable distribusi dengan aman
1. matikan `sales.delivery.release`
2. matikan `sales.return.retasi`
3. pastikan route/UI/workflow yang terkait juga ikut nonaktif

---

## 10. Risiko yang sudah terlihat dari codebase sekarang

### A. Gap schema vs implementasi
Contoh yang sudah terlihat:
- schema constraint mengenal `commission`
- implementasi aktual terlihat memakai `commission_payment`

Artinya, sebelum rollout config-driven journal, kita perlu audit label yang benar-benar dipakai.

### B. Hardcoded account code
Contoh yang terlihat di RPC:
- `1310`
- `1320`
- `4100`
- `8100`
- `2140`

Ini bagus untuk bootstrap cepat, tetapi buruk untuk multi-branch config-driven.

### C. Event bisnis masih menempel ke fungsi besar
Banyak RPC sekaligus:
- validasi bisnis
- update stok
- update status
- create journal
- void journal

Itu berarti implementasi config harus bertahap, bukan big bang rewrite.

---

## 11. Keputusan praktis untuk langkah berikutnya

Dokumen ini mengarah ke keputusan berikut:

1. **Kita tidak akan menjadikan `reference_type` sebagai satu-satunya pengendali config jurnal.**
2. **Kita akan tambah lapisan `journal_event_key`.**
3. **Untuk mode percetakan, event produksi + pembelian bahan + penjualan inti jadi prioritas.**
4. **Event delivery dan retasi jadi kandidat nonaktif default pada branch percetakan.**
5. **Akun jurnal harus dimap lewat role/config per branch, bukan hardcoded account code.**

---

## 12. Deliverable berikutnya yang paling tepat

Setelah dokumen ini, langkah terbaik adalah membuat draft schema SQL awal untuk:

- `feature_catalog`
- `branch_feature_settings`
- `ui_component_registry`
- `branch_ui_settings`
- `journal_event_registry`
- `branch_journal_settings`
- `branch_account_role_mappings`

Lalu implementasi vertikal pertama cukup ambil satu jalur nyata:

- branch percetakan pilot
- disable `delivery`
- disable `retasi`
- keep `production.finish_goods`
- keep `sales.invoice.cash`
- keep `purchasing.po.receipt_*`

Itu sudah cukup jadi bukti arsitektur config-driven benar-benar bekerja end-to-end.
