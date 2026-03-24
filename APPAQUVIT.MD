# AQUVIT SYSTEM CURRENT STATE
**Last Updated:** Tuesday, March 24, 2026 11:42 (WIT)

## 1. 🌐 VPS Connection Information


# CHANGELOG

Semua perubahan penting pada proyek AQUVIT ERP System didokumentasikan di file ini.

## Table of Contents

1. [🤖 PANDUAN UNTUK AI](#-panduan-untuk-ai-baca-ini-pertama) - **BACA INI DULU!**
2. [Local Development Setup](#local-development-setup)
3. [Server Architecture](#server-architecture-diagram)
4. [VPS Server Information](#vps-server-information)
5. [Version History](#v55-2026-03-24---cash-flow-performance--receivable-filter)
   - [v5.5] **Cash Flow Performance & Receivable Filter** 🚀 NEW
   - [v5.4] **Transaction Voiding & Photo Naming Fixes** 🛡️ CRITICAL
   - [v5.3] **POS Mobile Fixes: Bonus, Sales & Photo Upload** 🛡️ CRITICAL
   - [v5.2] **Commission Split Logic & Sidebar UI** 🚀 NEW
   - [v5.1] **Commission Duplication Fix & UI Refinement** 🛡️ CRITICAL
   - [v5.0] **Delivery & PO Infrastructure Fixes** 🚚 CRITICAL
   - [v4.6] **Payroll & Journal Hotfixes** 🚑 CRITICAL
   - [v4.5] **Payroll Journal Balancing** ⚖️
   - [v4.4] **Payroll Dynamic Account Identification** 🚀 NEW
   - [v4.3] **RPC Atomic Operations** ⚠️ PENTING!
   - [v4.2] Accounting System Improvements
   - [v4.1] Permission System & Notification
   - [v4] APK Build & Bluetooth Printer
   - [v3] Dashboard Enhancement & Retasi
   - [Earlier versions...]

### SSH Access
To connect to the VPS server, use the temporary key file (`Aquvit_temp.pem`). Use `git bash` or `powershell`.

```bash
# SSH Connection Command
ssh -i Aquvit_temp.pem -o StrictHostKeyChecking=no deployer@103.197.190.54
```

### Database Access (From VPS Terminal)
Once logged into the VPS via SSH:

```bash
# 1. Connect to Nabire Database (aquvit_new)
PGPASSWORD='Aquvit2024' psql -U aquavit -h 127.0.0.1 -d aquvit_new

# 2. Connect to Manokwari Database (mkw_db)
# Note: Owned by postgres user, use sudo for DDL changes
PGPASSWORD='Aquvit2024' psql -U aquavit -h 127.0.0.1 -d mkw_db
# OR for Admin access:
sudo -u postgres psql -d mkw_db
```

### Server Services (PM2)
Check status of running services:
```bash
pm2 list
# Restart services after DB schema changes:
pm2 restart postgrest-aquvit postgrest-mkw
```

---

## 2. 🖥️ Server Health Status
**VPS IP**: `103.197.190.54`

| Metric | Status | Details |
|--------|--------|---------|
| **Disk Usage** | ✅ **Healthy** | 11% Used (6.1GB / 58GB) on `/` |
| **PostgreSQL** | 🟢 **Active** | `aquvit_new` (Nabire) & `mkw_db` (Manokwari) |
| **PostgREST** | 🟢 **Online** | Port 3000 (Nabire), Port 3007 (Manokwari) |
| **Auth Servers**| 🟢 **Online** | Port 3006 (Nabire), Port 3003 (Manokwari) |

---

## 3. 📂 Application Structure

### Tech Stack
*   **Frontend**: React 18, TypeScript, Vite, TailwindCSS, Shadcn UI.
*   **Backend**: PostgreSQL 14 + PostgREST (REST API over SQL).
*   **Mobile**: Capacitor (Android).

### Key Folder Structure
```
d:\App\Aquvit Fix - Copy\
├── src/
│   ├── components/         # UI Components (Feature-based & shadcn/ui)
│   ├── hooks/             # React Custom Hooks (Game Logic)
│   │   ├── useRetasi.ts            # ⚠️ ACTIVE: Canvas/Sales/Return Logic
│   │   ├── useTransactions.ts      # Core Sales Logic
│   │   └── useTransactionPayments.ts # Payment Logic
│   ├── pages/             # Route Pages (PosPage, Dashboard, etc.)
│   ├── services/          # Business Logic extracted from UI
│   │   └── journalService.ts       # Auto-journal entry generation
│   ├── contexts/          # Global State (Auth, Branch, Timezone)
│   └── integrations/      # Supabase/PostgREST Client configurations
│
├── database/              # Database Migrations & RPCs
│   ├── rpc/              # ⚠️ CORE LOGIC LIVES HERE (v4.3)
│   │   ├── 01_fifo_inventory.sql   # FIFO Logic
│   │   ├── 03_journal.sql          # Atomic Journal Creation
│   │   ├── 05_delivery.sql         # Delivery & Stock Reduction
│   │   └── pay_receivable_complete_rpc.sql # Recent Fix
│   └── migrations/       # SQL Migration files
│
├── .env.local            # Local Environment config
└── Aquvit_temp.pem       # SSH Key (Use this one!)
```

### Critical RPC Functions (Atomic Operations)
The system relies on **PostgreSQL RPCs** for data integrity. Frontend calls `supabase.rpc('function_name', params)`.

**Key Functions Present on Production:**
*   `create_retasi_atomic`: Handles Retasi creation.
*   `mark_retasi_returned_atomic`: Processes updates and returns.
*   `pay_receivable_complete_rpc`: Handles debt payments + journals.
*   `consume_inventory_fifo_v3`: Latest FIFO stock logic.

---

## 4. ⚠️ Current Focus & Next Steps
**Active Task**: Auditing Stock & Validating Retasi Logic.
**Recently Completed**: POS Mobile High-Priority Fixes (Bonus Calculation, Sales Auto-fill, Photo Upload, Transaction ID).

1.  **Frontend**: Modifying `src/hooks/useRetasi.ts` to ensure correct data is sent to RPC.
2.  **Database**: 
    *   `audit_stock_gap_v2.sql` is ready to run to find inventory mismatches.
    *   Validating `pay_receivable_complete_rpc` deployment.



---

---

---

# v5.5 (2026-03-24) - Cash Flow Performance & Receivable Filter

### 🚀 Frontend Performance Fix
*   **Cash Flow Chunking**: Memperbaiki error `net::ERR_FAILED` / `414 URI Too Long` saat memuat halaman Arus Kas (Cash Flow) yang memiliki ribuan data. Pencarian referensi data kini dipecah (*chunked*) menjadi kelompok per 200 ID per *request* secara estafet, menghindari limitasi ukuran maksimum URL pada *browser* dan Supabase.

### 📑 UI Filter Enhancement
*   **Receivable UI Toggle**: Menambahkan dropdown "Tipe Tampil" (Hanya Piutang / Semua Transaksi) di halaman Manajemen Piutang (`PaymentHistoryTable.tsx`). Opsi bawaan (*default*) diset untuk menghilangkan slip tunai reguler (`Initial Payment`) dari daftar agar fokus tepat pada histori pelunasan piutang saja, sepenuhnya lewat UI tanpa memodifikasi *raw payload* dari *database*.

---
# v5.4 (2026-03-24) - Transaction Voiding & Photo Naming Fixes

### 🛡️ Core Database Fixes
*   **Transaction Voiding Fix (`void_transaction_atomic`)**: Memperbaiki bug `TR-UNKNOWN` tersembunyi yang tertinggal di `product_stock_movements` saat mengembalikan/void transaksi barang.
*   **Multiple Functions Cleaning**: Menghapus seluruh kloningan ganda fungsi `void_transaction_atomic` agar bebas dari error `400 Bad Request` saat kasir ingin membatalkan transaksi. Reload schema API postgREST juga telah sukses dilakukan ke Server Nabire dan Manokwari.

### 📸 Photo Upload Formats
*   **Filename Format Integrity**: Membuat opsi `enableExactName` di `photoUploadService.ts` agar saat aplikasi mengupload foto, sistem tidak merusak huruf kapital, tidak membuang spasi, dan tidak menambah mili-detik ganda.
*   **Delivery & Visit Naming**: Format baku terbaru telah diaktifkan dengan pola: `[Nomor] - [NamaPelanggan] - [Datetime]` pada laporan bukti foto Pengantaran dan Kunjungan Sales.

---
# v5.3 (2026-03-09) - POS Mobile Fixes: Bonus, Sales & Photo Upload

### 🎁 POS Mobile Bonus Optimization
*   **Proportional Bonus (Kelipatan)**: Bonus dihitung secara kelipatan (misal: Beli 1000 dapat 10, maka Beli 2000 dapat 20).
*   **Real-time Recalculation**: Bonus otomatis muncul dan terupdate saat jumlah (qty) diinput manual (mengetik), bukan hanya lewat tombol plus/minus.
*   **Reset Bug Fix**: Memperbaiki bug di mana angka input qty kembali ke "1" saat proses background bonus berjalan (race condition fix).
*   **Routing Fix**: Menambah rute `/employees` pada mobile layout di `App.tsx` untuk mencegah error 404 (Not Found) saat akses halaman karyawan dari HP.
*   **Product Toggle**: Menambahkan fitur Aktif/Non-Aktif produk (Visibility Toggle). Produk yang non-aktif tidak akan muncul di POS manapun. Script SQL tersedia di `database/add_product_active_status.sql`.

### 👤 Salesperson & Identity Fixes
*   **Auto-select Sales**: Sistem otomatis mendeteksi jika user login terdaftar di tabel `sales_employees` (apa pun role utamanya) untuk mengisi field Sales di POS.
*   **Transaction ID with Branch Context**: Update penomoran transaksi (`AQVPOSSUP`) agar menyertakan ID Cabang untuk mencegah bentrokan nomor urut antar cabang.
*   **Submission Fix**: Penambahan field wajib (`branch_id`, `subtotal`, PPN logic) pada payload POS Mobile agar transaksi berhasil disimpan ke database.

### 🍱 Database & Commission Logic
*   **Constraint Fix**: Memperluas batasan `commission_rules_role_check` di database agar mengizinkan role baru seperti `delivery_2_helpers` (Bagi 3) dan `delivery_3_helpers` (Bagi 4). Script perbaikan tersedia di `database/fix_commission_rules_constraint.sql`.

### 📸 Photo Upload & Connectivity
*   **Network Error Fix**: Mengizinkan *Cleartext Traffic* dan *Mixed Content* di Android & Capacitor untuk koneksi ke server VPS berbasis IP (non-HTTPS).
*   **CSP Security Update**: Penambahan alamat IP VPS (`103.197.190.54`) ke dalam Content Security Policy (`index.html`) agar koneksi fetch tidak diblokir browser.
*   **Link Sanitization**: Otomatis menambahkan protokol `http://` pada konfigurasi VPS jika user lupa memasukkannya di Pengaturan.

# v5.2 (2026-03-09) - Commission Split Logic & Sidebar UI

### 💰 Multi-Helper Commission Split (Bagi 3 / Bagi 4)
*   **Bagi 3 & Bagi 4 Logic**: Implementasi otomatis pembagian komisi untuk pengantaran dengan 2 helper (Bagi 3) dan 3 helper (Bagi 4).
*   **Data Integrity fix**: Perbaikan deteksi field `driver_id` vs `driverId` dan `helper_id` vs `helperId` di `commissionUtils.ts` untuk memastikan aturan Bagi 3/4 terpanggil dengan benar baik dari input baru (*generate*) maupun kalkulasi ulang (*recalculate/regen*).
*   **Rounding Fix**: Penggunaan `Math.floor` pada pembagian komisi agar angka di laporan bersih tanpa desimal.

### 🍱 Sidebar Enhancements
*   **Sticky Full-Height**: Sidebar diset ke `h-screen` dan `sticky`, memastikan sidebar tetap terlihat penuh dan tidak terpotong saat scroll halaman panjang.
*   **Lock Menu Feature**: Penambahan fitur "Lock Expand" (ikon gembok) di bagian bawah sidebar (footer) untuk menjaga semua sub-menu tetap terbuka. State fitur ini disimpan di `localStorage`.

# v5.1 (2026-03-06) - Commission System Audit & UI Enhancement

### 🛡️ Commission Duplication Fix (MKW & NBX)
*   **Duplicate Cleanup**: Menghapus lebih dari **27.000** baris data komisi duplikat di database Manokwari dan Nabire yang disebabkan oleh *double triggering*.
*   **Database Constraints**: Penambahan **Unique Index** (`idx_commission_unique_delivery` & `idx_commission_unique_transaction`) untuk mencegah data komisi yang sama persis masuk lebih dari satu kali.
*   **Atomic Deletion**: Verifikasi fungsi `void_transaction_atomic` untuk memastikan komisi otomatis terhapus saat transaksi dibatalkan (Full Cascade).

### 📑 Frontend UI Enhancements & POS Mobile
*   **Table Pagination**: Implementasi pagination pada halaman Laporan Komisi (50 data per halaman) dengan navigasi nomor halaman.
*   **User Experience**: Penambahan fitur *auto-scroll to top* saat berpindah halaman dan indikator total entri yang lebih informatif.
*   **Auto-Fill POS Mobile**: Fitur otomatis mengisi `Supir`, `Helper 1`, `Helper 2`, dan `Helper 3` di modal pengantaran (DriverDeliveryDialog) berdasarkan data Retasi yang sedang aktif.
*   **Auto-Delete Photos**: Gambar pengantaran (`photo_url`) secara fisis dihapus langsung dari VPS jika *delivery* atau *transaction* terkait dihapus, demi menghemat storage.

# v5.0 (2026-03-06) - Delivery System Optimization & Helper Expansion

### 🚚 Delivery System Enhancements (MKW & NBX)
*   **Multi-Helper Support**: Menambahkan kolom `helper_id_2` dan `helper_id_3` pada tabel `deliveries` di database Manokwari dan Nabire.
*   **RPC Hotfix**: Deployment `process_delivery_atomic` versi terbaru yang mendukung input multi-helper.
*   **Performance Optimization**: Optimasi query `useDeliveryHistory` dengan menyederhanakan nested joins yang berat. Sebelumnya menyebabkan history tidak tampil (timeout/memory limit) saat data mencapai 6.000+ baris.
*   **Bug Fixes**:
    *   Fix `400 Bad Request` saat fetch pengantaran (missing columns).
    *   Fix `404 Not Found` pada RPC pengantaran di database MKW.
    *   Reload PostgREST Schema (`SIGUSR1`) di kedua server untuk sinkronisasi metadata database.

### 📦 Purchase Order & Accounting Fixes
*   **Partial PO Receipt**: Deployment RPC `receive_po_partial` untuk menangani penerimaan barang sebagian.
*   **Journal Refactoring**: Refaktor fungsi `approve_purchase_order_atomic` untuk menggunakan standar `create_journal_atomic`, memperbaiki kalkulasi PPN, dan mencegah duplikasi jurnal hutang.
*   **Data Integrity**: Penambahan validasi pada `create_accounts_payable_atomic` untuk mencegah pembuatan hutang manual pada PO yang sudah di-approve.

### 🔧 Infrastructure Updates
*   **PostgREST Configuration**: Verifikasi dan update konfigurasi port (3007 untuk MKW, 3000 untuk Nabire).
*   **RLS Synchronization**: Sinkronisasi Row Level Security pada tabel `deliveries` untuk memastikan data tampil di frontend pengguna terautentikasi.

---

## Audit Date: 2026-01-06

### Context
Setelah migrasi ke RPC semalam, dilakukan audit menyeluruh untuk memastikan semua fungsi bekerja dengan benar.

---

## 1. TABLE `TRANSACTIONS` (Penjualan)

### ✅ RPC Functions
| Operation | RPC Function | Journal | Status |
|-----------|--------------|---------|--------|
| **CREATE** | `create_transaction_atomic` | ✅ YES | ✅ Working |
| **UPDATE** | `update_transaction_atomic` | ✅ YES | ✅ Fixed (2026-01-06) |
| **DELETE** | `void_transaction_atomic` | ✅ Voided | ✅ Working |

### 📊 Journal Entries

#### Skenario A: LUNAS (Paid Full)
```
Dr. 1110 Kas                    Rp XXX (Penerimaan kas)
Cr. 4100 Pendapatan Penjualan   Rp XXX
Dr. 5100 HPP                    Rp XXX (Harga Pokok)
Cr. 1310 Persediaan             Rp XXX (Pengurangan stock)
```

#### Skenario B: KREDIT (Belum Bayar)
```
Dr. 1210 Piutang Usaha          Rp XXX
Cr. 4100 Pendapatan Penjualan   Rp XXX
Dr. 5100 HPP                    Rp XXX
Cr. 1310 Persediaan             Rp XXX
```

#### Skenario C: BAYAR SEBAGIAN (Partial)
```
Dr. 1110 Kas                    Rp XXX (Paid amount)
Dr. 1210 Piutang Usaha          Rp XXX (Remaining)
Cr. 4100 Pendapatan Penjualan   Rp XXX (Total)
Dr. 5100 HPP                    Rp XXX
Cr. 1310 Persediaan             Rp XXX
```

#### Skenario D: Item Bonus
```
Dr. 5210 HPP Bonus/Gratis       Rp XXX (Item bonus)
(Selain jurnal normal di atas)
```

### 🔧 Akun yang Terhubung
- **1110** - Kas (Debit, jika paid_amount > 0)
- **1210** - Piutang Usaha (Debit, jika paid_amount < total)
- **4100** - Pendapatan Penjualan (Credit, selalu)
- **5100** - HPP (Debit, item biasa)
- **5210** - HPP Bonus/Gratis (Debit, item bonus)
- **1310** - Persediaan Barang Dagang (Credit, selalu)

### 🐛 Issues Fixed
1. **Edit Transaction Error** (Fixed 2026-01-06)
   - Missing `v_fifo_result` variable declaration
   - Wrong SELECT syntax in journal creation
   - Status: ✅ Deployed to production

---

## 2. TABLE `DELIVERIES` (Pengantaran)

### ✅ RPC Functions
| Operation | RPC Function | Journal | Status |
|-----------|--------------|---------|--------|
| **CREATE** | `process_delivery_atomic` | ✅ YES | ✅ Working |
| **UPDATE** | `update_delivery_atomic` | ✅ YES | ⚠️ Wrong reference_type |
| **DELETE** | via `void_transaction_atomic` | ✅ Voided | ✅ Working |

### 📊 Journal Entries

#### Non-Office Sale (Stock consumed at delivery)
```
Dr. 2140 Modal Barang Dagang Tertahan   Rp XXX (Realisasi Pengiriman)
Cr. 1310 Persediaan Barang Dagang       Rp XXX (Barang Keluar Gudang)
```

**Penjelasan:**
- **2140** = Liability yang dibuat saat transaksi (accrual)
- Saat delivery, liability di-clear karena barang sudah keluar
- Stock dikurangi dengan FIFO real-time

#### Office Sale (Stock consumed at transaction)
```
TIDAK ADA JURNAL DELIVERY
(Stock sudah dikurangi saat create transaction)
```

### 🔧 Akun yang Terhubung
- **2140** - Modal Barang Dagang Tertahan (Debit, clear liability)
- **1310** - Persediaan Barang Dagang (Credit, stock out)

### ⚠️ Issues Found
1. **Wrong Reference Type in Update Delivery**
   - Location: `database/rpc/19_delivery_management.sql` line 168
   - Current: `reference_type = 'adjustment'`
   - Should be: `reference_type = 'delivery'`
   - Impact: Journals tidak ter-track dengan benar sebagai delivery
   - Status: ⚠️ **BELUM DIPERBAIKI**

### 🎯 Commission Generation
- ✅ Driver commission created (if driver assigned)
- ✅ Helper commission created (if helper assigned)
- Based on `commission_rules` table

---

## 3. TABLE `PURCHASE_ORDERS` (PO)

### ✅ RPC Functions
| Operation | RPC Function | Journal | Status |
|-----------|--------------|---------|--------|
| **CREATE** | `create_purchase_order_atomic` | ❌ NO | ✅ Working |
| **APPROVE** | `approve_purchase_order_atomic` | ✅ YES | ✅ Fixed (2026-01-06) |
| **RECEIVE** | `receive_po_atomic` | ❌ NO | ✅ Working |
| **DELETE** | `delete_po_atomic` | ✅ Voided | ✅ Working |

### 📊 Journal Entries

#### PO Approval (Create Liability)
```
Dr. 1320 Persediaan Bahan Baku      Rp XXX (Material)
Dr. 1310 Persediaan Barang Dagang   Rp XXX (Product)
Dr. 1230 PPN Masukan                Rp XXX (Tax)
Cr. 2110 Hutang Usaha               Rp XXX (Total)
```

### 🔧 Akun yang Terhubung
- **1320** - Persediaan Bahan Baku (Debit, for materials)
- **1310** - Persediaan Barang Dagang (Debit, for products)
- **1230** - PPN Masukan (Debit, if PPN included)
- **2110** - Hutang Usaha (Credit, total liability)

### 🐛 Issues Fixed
1. **Duplicate PO Payable Journals** (Fixed 2026-01-06)
   - Problem: Hutang tercatat 2x (dari approve + manual AP creation)
   - Solution: 
     - Added duplicate check in `approve_purchase_order_atomic`
     - Added PO validation in `create_accounts_payable_atomic`
     - Frontend validation in `useAccountsPayable.ts`
   - Status: ✅ Deployed to production

---

## 4. TABLE `ACCOUNTS_PAYABLE` (Hutang)

### ✅ RPC Functions
| Operation | RPC Function | Journal | Status |
|-----------|--------------|---------|--------|
| **CREATE** | `create_accounts_payable_atomic` | ✅ YES | ✅ Fixed (2026-01-06) |
| **PAY** | `pay_supplier_atomic` | ✅ YES | ✅ Working |
| **DELETE** | `delete_accounts_payable_atomic` | ✅ Voided | ✅ Working |

### 📊 Journal Entries

#### Create Manual AP
```
Dr. 5110 Pembelian              Rp XXX (Default)
Cr. 2110 Hutang Usaha           Rp XXX
```

#### Pay AP
```
Dr. 2110 Hutang Usaha           Rp XXX (Reduce liability)
Cr. 1110 Kas / 1120 Bank        Rp XXX (Payment)
```

### 🔧 Akun yang Terhubung
- **5110** - Pembelian (Debit, for manual AP)
- **2110** - Hutang Usaha (Credit for create, Debit for pay)
- **1110** - Kas (Credit, if payment method = cash)
- **1120** - Bank (Credit, if payment method = transfer)

### 🐛 Issues Fixed
1. **Manual AP Creation for PO** (Fixed 2026-01-06)
   - Problem: User bisa create manual AP untuk PO yang sudah punya AP
   - Solution: Added validation to prevent duplicate
   - Status: ✅ Deployed to production

---

## 5. TABLE `RETASI` (Pengembalian/Return)

### ✅ RPC Functions (21_retasi_management.sql)

| Operation | RPC Function | Journal | Stock Restore | Status |
|-----------|--------------|---------|---------------|--------|
| **CREATE** | `create_retasi_atomic` | ❌ NO | ❌ NO | ✅ Working |
| **MARK RETURNED** | `mark_retasi_returned_atomic` | ❌ NO | ❌ NO | ✅ Working |
| **UPDATE** | Direct table update | ❌ NO | ❌ NO | ✅ Working |
| **DELETE** | Direct table delete | ❌ NO | ❌ NO | ✅ Working |

### 📊 Purpose: TRACKING ONLY

**User Confirmation:** RETASI hanya untuk tracking, **TIDAK perlu jurnal**

**What RETASI Does:**
1. ✅ Mencatat keberangkatan driver dengan barang (truck loading)
2. ✅ Mencatat pengembalian (barang laku/tidak laku/rusak)
3. ✅ Tracking performa driver dan helper
4. ❌ Tidak ada impact ke accounting (by design)
5. ❌ Tidak ada stock restore otomatis (by design)

### 🎯 Frontend Implementation

**File**: `src/hooks/useRetasi.ts`

**Create Retasi** (Line 296-356):
```typescript
const { data: rpcResultRaw, error: rpcError } = await supabase
  .rpc('create_retasi_atomic', {
    p_branch_id: currentBranch.id,
    p_driver_name: mainData.driver_name,
    p_helper_name: mainData.helper_name || null,
    p_truck_number: mainData.truck_number || null,
    p_route: mainData.route || null,
    p_departure_date: mainData.departure_date,
    p_departure_time: mainData.departure_time || null,
    p_notes: mainData.notes || '',
    p_items: items,
    p_created_by: user?.id || null
  });
```

**Mark Returned** (Line 359-400):
```typescript
const { data: rpcResultRaw, error: rpcError } = await supabase
  .rpc('mark_retasi_returned_atomic', {
    p_branch_id: currentBranch.id,
    p_retasi_id: retasiId,
    p_return_notes: returnData.return_notes || '',
    p_item_returns: returnData.item_returns
  });
```

### ✅ Implementation Status

**Current Implementation:**
- ✅ CREATE retasi working
- ✅ MARK returned working  
- ✅ UPDATE working
- ✅ DELETE working
- ✅ Driver availability check working
- ✅ Statistics tracking working

**No Changes Needed** - Implementation is correct for tracking-only purpose.

---

## Summary of Accounts Used

### Assets (Aktiva)
- **1110** - Kas
- **1120** - Bank
- **1210** - Piutang Usaha
- **1230** - PPN Masukan
- **1310** - Persediaan Barang Dagang
- **1320** - Persediaan Bahan Baku

### Liabilities (Kewajiban)
- **2110** - Hutang Usaha
- **2140** - Modal Barang Dagang Tertahan

### Revenue (Pendapatan)
- **4100** - Pendapatan Penjualan

### Expenses (Beban)
- **5100** - HPP (Harga Pokok Penjualan)
- **5110** - Pembelian
- **5210** - HPP Bonus/Gratis

---

## Pending Issues

### ⚠️ High Priority
1. **Delivery Update Reference Type** ✅ **FIXED (2026-01-06)**
   - File: `database/rpc/19_delivery_management.sql`
   - Line: 168
   - Change: `reference_type = 'adjustment'` to `'delivery'`
   - Status: ✅ Deployed to production

### 📋 To Be Audited
- [ ] Production records (table `production_records`)
- [ ] Expenses (table `expenses`)
- [ ] Payroll (table `payroll`)
- [ ] Stock adjustments (table `stock_adjustments`)
- [ ] Commission payments (table `commission_entries`)

### ✅ Confirmed Working (No Changes Needed)
- ✅ **RETASI** - Tracking-only (no journal by design)

---

## Deployment History

### 2026-01-06
1. ✅ Fixed `update_transaction_atomic` (missing v_fifo_result)
2. ✅ Fixed `approve_purchase_order_atomic` (duplicate prevention)
3. ✅ Fixed `create_accounts_payable_atomic` (PO validation)
4. ✅ Deployed to Nabire (aquvit_new)
5. ✅ Deployed to Manokwari (mkw_db)
6. ✅ PostgREST restarted

---

## Notes
- All RPC functions use `branch_id` for data isolation
- FIFO inventory consumption implemented
- Double-entry bookkeeping enforced
- Commission auto-generation working
- User sudah void manual duplicate journals

---

Last Updated: 2026-03-09 13:30 WIT


