# CHANGELOG

Semua perubahan penting pada proyek AQUVIT ERP System didokumentasikan di file ini.

## Table of Contents

1. [🤖 PANDUAN UNTUK AI](#-panduan-untuk-ai-baca-ini-pertama) - **BACA INI DULU!**
2. [Local Development Setup](#local-development-setup)
3. [Server Architecture](#server-architecture-diagram)
4. [VPS Server Information](#vps-server-information)
5. [Version History](#v43-2026-01-04---rpc-atomic-operations-penting)
   - [v4.6] **Payroll & Journal Hotfixes** 🚑 CRITICAL
   - [v4.5] **Payroll Journal Balancing** ⚖️
   - [v4.4] **Payroll Dynamic Account Identification** 🚀 NEW
   - [v4.3] **RPC Atomic Operations** ⚠️ PENTING!
   - [v4.2] Accounting System Improvements
   - [v4.1] Permission System & Notification
   - [v4] APK Build & Bluetooth Printer
   - [v3] Dashboard Enhancement & Retasi
   - [Earlier versions...]

---

## [v4.6] 2026-02-07 - Payroll & Journal Hotfixes (Critical)

### Features & Improvements

1.  **Robust Payroll Journal Logic**
    - **Duplicate Key Fix:** Mengimplementasikan logika **Looping** pada `create_journal_atomic` untuk mencari nomor jurnal `JE-YYYYMMDD-XXXX` yang benar-benar unik. Menggantikan logika `MAX+1` yang rentan error saat data jurnal memiliki format campuran (4 digit & 7 digit).
    - **Constraint Violation Fix:** Memperbaiki error saat pembayaran gaji bernilai **Rp 0** (habis dipotong kasbon). Sistem kini cerdas melewati pencatatan kredit Kas/Bank jika `net_salary` = 0.
    - **Account Code Correction:** Mengoreksi akun default untuk potongan panjar dari '1120' (**Kas Dyah**) menjadi '1220' (**Piutang Karyawan**).

2.  **Frontend Data Visibility**
    - **Update View `payroll_summary`:** Menulis ulang view database untuk menyertakan kolom `payment_account_name` (dari tabel `accounts`) dan `paid_by_name` (dari tabel `profiles`).
    - Memperbaiki masalah data "Akun Bayar" dan "Dibayar Oleh" yang tidak muncul di tabel Catatan Gaji.

3.  **Database Cleanups**
    - Menghapus duplikasi fungsi RPC `process_payroll_complete` yang menyebabkan ambiguitas saat dipanggil oleh Frontend.
    - Memperbaiki tipe data JOIN pada view (TEXT vs UUID conflict).

### File yang Dimodifikasi
| File | Perubahan |
|------|-----------|
| `database/rpc_by_function/05_accounting_journal.sql` | Looping logic & Ambiguous column fix |
| `fix_payroll_function_final.sql` | Logic skip zero payment & Account code fix |
| `update_payroll_view.sql` | Recreate View payroll_summary |

---

## [v4.5] 2026-02-06 - Payroll Journal Balancing & Slip Print

### Features & Improvements

1. **Balanced Payroll Journal Logic**
   - Menjamin jurnal gaji selalu seimbang (balance) dengan mengkreditkan potongan gaji (lainnya) ke akun "Pendapatan Lain-lain" atau "Potongan". Jika tidak ditemukan, otomatis mencari fallback akun penampung yang sesuai.
   - Ref: `database/rpc_by_function/12_payroll_salary.sql`

2. **Payroll Record Deletion Fix (Atomic Void)**
   - Memperbaiki bug `column "payroll_id" does not exist` pada tabel komisi saat proses hapus gaji. Sekarang menggunakan `reference_id`.
   - Proses hapus di UI sekarang lebih "kebal" terhadap error jurnal lama agar data tetap bisa dibersihkan.

3. **Unified Payroll UI & Slip Printing**
   - Menghapus tab "Riwayat Pembayaran" dan menggabungkannya ke dalam "Catatan Gaji".
   - Menambahkan kolom: **Tgl Bayar**, **Akun**, dan **Dibayar Oleh** di tabel utama.
   - Menambahkan tombol **Cetak Slip Gaji** (Format A5 PDF) dengan detail penerimaan, potongan, dan terbilang.
   - Role **Owner** sekarang bisa menghapus record gaji yang sudah berstatus 'paid' jika terjadi kesalahan input.

4. **Mass Migration of Incorrect Advance Journals**
   - Memperbaiki ribuan data kasbon historis di database **Nabire** dan **Manokwari** yang sebelumnya salah masuk ke akun "Pajak Masukan" (1230), sekarang sudah benar masuk ke "Piutang Karyawan" (1220) di masing-masing cabang.

---

## [v4.4] 2026-02-05 - Payroll Dynamic Account Identification

### Features & Improvements

1. **Dynamic Salary Expense Account Identification**
   - **Masalah**: Frontend sebelumnya hardcoded mencari akun Gaji dengan kode '6110'. Jika akun tersebut tidak ada atau memiliki ID berbeda antar branch, proses payment gagal.
   - **Solusi**: Frontend (`EmployeePage.tsx`) sekarang melakukan pencarian dinamis:
     - Prioritas 1: Mencari akun dengan kode `'6110'`.
     - Prioritas 2: Mencari akun yang mengandung kata `"Beban"` dan `"Gaji"` (case-insensitive).
   - **Implementasi**: ID akun yang ditemukan dikirim ke backend melalui parameter baru `p_expense_account_id`.

2. **RPC `process_payroll_complete` Enhancement**
   - File: `database/rpc_by_function/12_payroll_salary.sql`
   - Menambahkan parameter `p_expense_account_id` (TEXT, default NULL).
   - Logika: Menggunakan ID yang diberikan jika ada, jika tidak tetap fallback ke lookup kode '6110' (backward compatibility).

3. **Multi-Database Deployment**
   - Fix dideploy serentak ke database **Nabire** (`aquvit_new`) dan **Manokwari** (`mkw_db`).
   - PostgREST restarted di kedua environment.

### File yang Dimodifikasi

| File | Perubahan |
|------|-----------|
| `src/pages/EmployeePage.tsx` | Implementasi lookup akun dinamis sebelum payment |
| `src/hooks/usePayroll.ts` | Update `processPayment` mutation untuk mendukung `expenseAccountId` |
| `database/rpc_by_function/12_payroll_salary.sql` | Update signature fungsi RPC dan logika lookup akun |

---

# 🤖 PANDUAN UNTUK AI (Baca Ini Pertama!)

Section ini berisi informasi penting yang WAJIB dipahami AI sebelum bekerja dengan codebase ini.

## Quick Start untuk AI

```bash
# 1. SSH ke VPS
ssh -i Aquvit.pem deployer@103.197.190.54

# 2. Koneksi database Nabire
PGPASSWORD='Aquvit2024' psql -U aquavit -h 127.0.0.1 -d aquvit_new

# 3. Koneksi database Manokwari
PGPASSWORD='Aquvit2024' psql -U aquavit -h 127.0.0.1 -d mkw_db

# 4. Restart PostgREST setelah ALTER TABLE
pm2 restart postgrest-aquvit postgrest-mkw
```

## Teknologi Stack

| Layer | Teknologi |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite 6 |
| **Styling** | TailwindCSS 3.4 + Shadcn UI (Radix) |
| **State** | TanStack React Query v5 + React Context |
| **Forms** | React Hook Form + Zod validation |
| **Backend** | PostgreSQL 14 + PostgREST (REST API) |
| **Auth** | Custom JWT auth via PostgREST + auth-server |
| **Mobile** | Capacitor 8 (Android APK) |
| **Maps** | Leaflet + React-Leaflet |
| **Charts** | Recharts |
| **PDF** | jsPDF + html2canvas |
| **Excel** | xlsx |

## Struktur Folder Utama

```
src/
├── components/          # 177 komponen React
│   ├── ui/             # 52 Shadcn UI components (Button, Dialog, dll)
│   ├── layout/         # Header, Sidebar, MobileLayout
│   └── [Feature].tsx   # Komponen bisnis (PosForm, Dashboard, dll)
│
├── pages/              # 56 halaman (route components)
│   ├── PosPage.tsx           # Point of Sale
│   ├── TransactionListPage.tsx
│   ├── CustomerPage.tsx
│   ├── ProductPage.tsx
│   ├── EmployeePage.tsx
│   ├── AccountingPage.tsx    # Jurnal umum
│   ├── ChartOfAccountsPage.tsx
│   ├── FinancialReportsPage.tsx
│   ├── PurchaseOrderPage.tsx
│   ├── ProductionPage.tsx
│   ├── DeliveryPage.tsx
│   ├── PayrollPage.tsx
│   └── ...
│
├── hooks/              # 58 custom React hooks
│   ├── useTransactions.ts    # 80KB - CRUD transaksi penjualan
│   ├── usePurchaseOrders.ts  # 43KB - PO & receiving
│   ├── useProduction.ts      # 42KB - Produksi & BOM
│   ├── useDeliveries.ts      # 69KB - Pengiriman
│   ├── usePayroll.ts         # 39KB - Gaji & komisi
│   ├── useAccounts.ts        # Chart of Accounts
│   ├── useProducts.ts        # Produk
│   ├── useCustomers.ts       # Pelanggan
│   ├── useMaterials.ts       # Bahan baku
│   └── ...
│
├── services/           # 15 business logic services
│   ├── journalService.ts         # 132KB - Auto-generate jurnal (PENTING!)
│   ├── stockService.ts           # 35KB - FIFO inventory
│   ├── pricingService.ts         # 23KB - Harga dinamis
│   ├── closingEntryService.ts    # 16KB - Jurnal penutup
│   ├── materialStockService.ts   # Material inventory
│   └── backupRestoreService.ts   # Backup database
│
├── utils/              # 24 utility functions
│   ├── financialStatementsUtils.ts  # 92KB - Laporan keuangan (PENTING!)
│   ├── chartOfAccountsUtils.ts
│   ├── commissionUtils.ts
│   ├── formatNumber.ts
│   └── geoUtils.ts
│
├── types/              # 28 TypeScript type definitions
│   ├── transaction.ts
│   ├── product.ts
│   ├── employee.ts
│   ├── account.ts
│   └── ...
│
├── contexts/           # 4 React contexts
│   ├── AuthContext.tsx      # Autentikasi & session
│   ├── BranchContext.tsx    # Multi-branch support
│   ├── TimezoneContext.tsx  # Timezone WIT
│   └── PerformanceContext.tsx
│
├── integrations/
│   └── supabase/
│       ├── client.ts         # Supabase/PostgREST client
│       └── postgrestAuth.ts  # Custom auth
│
└── App.tsx             # Main routing (lazy-loaded pages)
```

## Database Schema (55 Tabel)

### Tabel Utama

| Tabel | Deskripsi | Foreign Keys |
|-------|-----------|--------------|
| `profiles` | **Karyawan/Users** (BUKAN `employees`!) | - |
| `customers` | Pelanggan | - |
| `suppliers` | Supplier | - |
| `products` | Produk jadi | - |
| `materials` | Bahan baku | - |
| `transactions` | Transaksi penjualan | `customer_id`, `branch_id` |
| `transaction_items` | Item dalam transaksi | `transaction_id`, `product_id` |
| `deliveries` | Pengiriman | `transaction_id`, `driver_id` |
| `purchase_orders` | Purchase Order | `supplier_id`, `branch_id` |
| `purchase_order_items` | Item PO | `purchase_order_id` |
| `production_batches` | Batch produksi | `product_id`, `branch_id` |
| `production_materials` | BOM per produksi | `production_batch_id`, `material_id` |

### Tabel Akuntansi

| Tabel | Deskripsi |
|-------|-----------|
| `accounts` | Chart of Accounts (COA) - per branch! |
| `journal_entries` | Header jurnal |
| `journal_entry_lines` | Detail jurnal (debit/credit) |
| `account_balances` | Saldo akun (VIEW, bukan tabel) |

### Tabel HR & Payroll

| Tabel | Deskripsi |
|-------|-----------|
| `profiles` | Data karyawan |
| `employee_salaries` | Konfigurasi gaji |
| `payroll_records` | Record gaji bulanan |
| `employee_advances` | Panjar/kasbon karyawan |
| `commission_rules` | Aturan komisi per produk |
| `commission_entries` | Entry komisi per transaksi |
| `attendances` | Absensi harian |

### Tabel Inventory

| Tabel | Deskripsi |
|-------|-----------|
| `inventory_batches` | Batch inventory untuk FIFO |
| `stock_movements` | Riwayat pergerakan stok |
| `warehouses` | Gudang per cabang |
| `v_product_current_stock` | VIEW stok saat ini |

## ⚠️ PERINGATAN PENTING

### 1. Tabel Karyawan = `profiles`
```sql
-- BENAR:
SELECT * FROM profiles WHERE role = 'sales';
ALTER TABLE some_table ADD COLUMN employee_id UUID REFERENCES profiles(id);

-- SALAH (tabel tidak ada!):
SELECT * FROM employees;
REFERENCES employees(id);
```

### 2. COA adalah Per-Branch
Setiap cabang memiliki akun dengan ID berbeda tapi kode sama:
```sql
-- Akun "Kas" di Nabire dan Manokwari punya ID berbeda
-- Tapi kode sama: 1110

-- Untuk laporan keuangan, gunakan account_code, BUKAN account_id
```

### 3. Saldo Akun Dihitung dari Jurnal
Kolom `accounts.balance` TIDAK diupdate. Saldo selalu dihitung dari:
```sql
SELECT
  a.code,
  a.initial_balance + COALESCE(SUM(
    CASE WHEN a.type IN ('Aset', 'Beban')
      THEN jel.debit_amount - jel.credit_amount
      ELSE jel.credit_amount - jel.debit_amount
    END
  ), 0) as current_balance
FROM accounts a
LEFT JOIN journal_entry_lines jel ON jel.account_code = a.code
LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE je.status = 'posted' AND je.is_voided = false
GROUP BY a.id;
```

### 4. Role Hierarchy
Semua role aplikasi HARUS inherit dari `authenticated`:
```sql
GRANT authenticated TO owner, admin, cashier, supir, sales, supervisor, designer, operator;
```

### 5. Restart PostgREST Setelah Schema Change
```bash
pm2 restart postgrest-aquvit postgrest-mkw
# atau reload schema saja:
sudo kill -SIGUSR1 $(pgrep postgrest)
```

## Alur Bisnis Utama

### 1. Alur Penjualan
```
Customer → POS → Transaction → [Laku Kantor?]
                                    ↓
                    YES: Stok langsung berkurang
                    NO:  Tunggu Delivery → Stok berkurang
                                    ↓
                            Journal Entry auto-generated
                            (Dr. Kas/Piutang, Cr. Pendapatan)
                            (Dr. HPP, Cr. Persediaan)
```

### 2. Alur Pembelian (PO)
```
Supplier → PO Created → PO Approved → PO Received
                                          ↓
                                inventory_batch created
                                (untuk FIFO HPP tracking)
                                          ↓
                                Journal Entry:
                                Dr. Persediaan
                                Cr. Kas/Hutang Usaha
```

### 3. Alur Produksi
```
BOM defined → Production Batch Created
                    ↓
            Material consumed (FIFO)
                    ↓
            Product stock increased
                    ↓
            Journal Entry:
            Dr. Persediaan Barang Jadi
            Cr. Persediaan Bahan Baku
```

### 4. Alur Payroll
```
Employee Salary Config → Calculate Payroll
                              ↓
                    + Komisi (dari commission_entries)
                    - Potongan Panjar (FIFO dari employee_advances)
                              ↓
                        Payroll Record
                              ↓
                        Journal Entry:
                        Dr. Beban Gaji
                        Cr. Kas
                        Cr. Piutang Karyawan (jika ada potongan)
```

## Kode Akun Standar (COA)

| Prefix | Kategori | Contoh |
|--------|----------|--------|
| `1xxx` | Aset | 1110 Kas, 1210 Piutang Usaha, 1310 Persediaan |
| `2xxx` | Kewajiban | 2110 Hutang Usaha, 2210 Hutang Bank |
| `3xxx` | Modal | 3100 Modal Pemilik, 3200 Laba Ditahan |
| `4xxx` | Pendapatan | 4100 Pendapatan Usaha |
| `5xxx` | HPP | 5100 Harga Pokok Penjualan |
| `6xxx` | Beban Operasional | 6100 Beban Gaji, 6200 Beban Sewa |
| `7xxx` | Pendapatan Lain | 7100 Pendapatan Bunga |
| `8xxx` | Beban Lain | 8100 Beban Bunga |

## File Kunci yang Harus Dipelajari

| File | Size | Mengapa Penting |
|------|------|-----------------|
| `src/services/journalService.ts` | 132KB | Auto-generate semua jurnal akuntansi |
| `src/utils/financialStatementsUtils.ts` | 92KB | Kalkulasi laporan keuangan |
| `src/hooks/useTransactions.ts` | 80KB | Core transaksi penjualan |
| `src/hooks/useDeliveries.ts` | 69KB | Pengiriman & stok |
| `src/hooks/usePurchaseOrders.ts` | 43KB | PO & penerimaan barang |
| `src/hooks/useProduction.ts` | 42KB | Produksi & BOM |
| `src/contexts/AuthContext.tsx` | 13KB | Autentikasi & session |

## Environment Variables

```bash
# Development (localhost)
VITE_SUPABASE_URL=http://localhost:3001
VITE_SUPABASE_ANON_KEY=...

# Production Nabire
VITE_SUPABASE_URL=https://nbx.aquvit.id
VITE_APK_SERVER=https://nbx.aquvit.id

# Production Manokwari
VITE_SUPABASE_URL=https://mkw.aquvit.id
VITE_APK_SERVER=https://mkw.aquvit.id
```

## Build Commands

```bash
# Development
npm run dev

# Production build
npm run build

# Build untuk Nabire (APK)
npm run build:nabire

# Build untuk Manokwari (APK)
npm run build:manokwari

# Sync ke Android
npx cap sync android
```

## Coding Patterns yang Digunakan

### 1. React Query untuk Data Fetching
```typescript
// Semua data fetching menggunakan useQuery
const { data, isLoading, error } = useQuery({
  queryKey: ['transactions', branchId, filters],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('branch_id', branchId);
    if (error) throw error;
    return data;
  },
});

// Mutations menggunakan useMutation
const createMutation = useMutation({
  mutationFn: async (newData) => { ... },
  onSuccess: () => {
    // PENTING: Gunakan exact: false untuk invalidate semua variant
    queryClient.invalidateQueries({ queryKey: ['transactions'], exact: false });
  },
});
```

### 2. Auto-Generate Journal Entry
```typescript
// journalService.ts menangani semua jurnal otomatis
import { createJournalEntry } from '@/services/journalService';

// Saat transaksi dibuat:
await createJournalEntry({
  referenceType: 'transaction',
  referenceId: transaction.id,
  branchId: transaction.branch_id,
  date: transaction.date,
  description: `Penjualan ke ${customerName}`,
  lines: [
    { accountCode: '1110', debit: total, credit: 0 },      // Kas
    { accountCode: '4100', debit: 0, credit: total },      // Pendapatan
    { accountCode: '5100', debit: hpp, credit: 0 },        // HPP
    { accountCode: '1310', debit: 0, credit: hpp },        // Persediaan
  ],
});
```

### 3. FIFO Inventory Consumption
```typescript
// Consume inventory menggunakan RPC function
const { data: fifoResult } = await supabase.rpc('consume_inventory_fifo', {
  p_product_id: productId,
  p_branch_id: branchId,
  p_quantity: quantity,
  p_transaction_id: transactionId,
});
// Returns: { total_hpp: number, batches_consumed: jsonb }
```

### 4. Multi-Branch Context
```typescript
// Selalu gunakan branchId dari context
const { currentBranch } = useBranch();

// Filter data berdasarkan branch
.eq('branch_id', currentBranch.id)
```

### 5. Permission Check
```typescript
import { useGranularPermission } from '@/hooks/useGranularPermission';

const { hasPermission } = useGranularPermission();

// Cek permission sebelum render
if (!hasPermission('transactions_view')) {
  return <AccessDenied />;
}
```

## Troubleshooting Guide

### Error 403 Forbidden
```bash
# Penyebab: Role tidak inherit dari authenticated
# Solusi:
GRANT authenticated TO owner, admin, cashier, supir, sales, supervisor, designer, operator;
pm2 restart postgrest-aquvit postgrest-mkw
```

### Error 401 Unauthorized
```bash
# Penyebab: Token expired atau RLS policy tidak ada
# Cek RLS:
SELECT * FROM pg_policies WHERE tablename = 'nama_tabel';

# Tambah policy jika perlu:
CREATE POLICY "nama_policy" ON nama_tabel
FOR ALL TO authenticated USING (true);
```

### UI Tidak Update Setelah Mutasi
```typescript
// Penyebab: invalidateQueries dengan exact: true (default)
// Solusi: Gunakan exact: false
await queryClient.invalidateQueries({
  queryKey: ['queryName'],
  exact: false
});
await queryClient.refetchQueries({
  queryKey: ['queryName'],
  exact: false,
  type: 'active'
});
```

### PostgREST Error "Address in use"
```bash
# Kill orphan process
sudo lsof -i :3000
sudo kill -9 <PID>
pm2 restart postgrest-aquvit
```

### Schema Changes Tidak Terlihat
```bash
# Reload PostgREST schema cache
sudo kill -SIGUSR1 $(pgrep postgrest)
# atau restart
pm2 restart postgrest-aquvit postgrest-mkw
```

### Laporan Keuangan Menampilkan 0
```
Penyebab yang mungkin:
1. Jurnal belum di-posting (status != 'posted')
2. Jurnal sudah di-void (is_voided = true)
3. Filter branch_id tidak cocok
4. Periode tanggal salah

Cek query di financialStatementsUtils.ts
```

## Tips untuk AI

1. **Selalu baca file dulu** sebelum memodifikasi
2. **Cek existing patterns** di file serupa sebelum menulis kode baru
3. **Test di localhost dulu** sebelum deploy ke VPS
4. **Backup database** sebelum ALTER TABLE di production
5. **Restart PostgREST** setelah schema changes
6. **Gunakan exact: false** pada invalidateQueries
7. **Perhatikan timezone** - sistem menggunakan WIT (UTC+9)
8. **Journal entries harus balance** - total debit = total credit

## Local Development Setup

### Docker Containers

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `aquvit-postgres` | postgres:14 | 5433 | PostgreSQL Database |
| `postgrest-local` | postgrest/postgrest | 3001 | PostgREST API |

### Local Credentials

| Item | Value |
|------|-------|
| Host | `localhost` |
| Port | `5433` |
| Database | `aquvit_test` |
| User | `postgres` |
| Password | `postgres` |

### Local Services

| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL | 5433 | Database (Docker) |
| PostgREST | 3001 | REST API (Docker) |
| Auth Server | 3002 | Authentication (Node.js) |
| Frontend (Vite) | 5174 | React Development Server |

### Start Local Environment

```bash
# 1. Start PostgreSQL & PostgREST (Docker)
docker start aquvit-postgres
docker start postgrest-local

# 2. Start Auth Server
cd scripts/auth-server && node server.js

# 3. Start Frontend
npm run dev
```

### Test User (Local)

| Email | Password | Role |
|-------|----------|------|
| `owner@aquvit.id` | `test123` | owner |

## Server Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        VPS SERVER                                │
│                    103.197.190.54                                │
│                    Ubuntu 22.04.5 LTS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐     ┌─────────────────────────────────────┐    │
│  │   NGINX     │     │         PostgreSQL 14               │    │
│  │  Port 443   │     │         Port 5432                   │    │
│  │  (HTTPS)    │     │                                     │    │
│  └──────┬──────┘     │  ┌─────────────┐ ┌─────────────┐   │    │
│         │            │  │ aquvit_new  │ │   mkw_db    │   │    │
│         │            │  │  (Nabire)   │ │ (Manokwari) │   │    │
│         │            │  └─────────────┘ └─────────────┘   │    │
│         │            └─────────────────────────────────────┘    │
│         │                       ▲              ▲                 │
│         ▼                       │              │                 │
│  ┌──────────────────────────────┴──────────────┴───────────┐    │
│  │                         PM2                              │    │
│  │  ┌─────────────────┐  ┌─────────────────┐               │    │
│  │  │ NABIRE STACK    │  │ MANOKWARI STACK │               │    │
│  │  │ PostgREST :3000 │  │ PostgREST :3007 │               │    │
│  │  │ Auth      :3006 │  │ Auth      :3003 │               │    │
│  │  └─────────────────┘  └─────────────────┘               │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Nginx Routing

```
nbx.aquvit.id
├── /rest/*    → localhost:3000 (PostgREST Nabire)
├── /auth/*    → localhost:3006 (Auth Server Nabire)
└── /*         → /var/www/aquvit (Static files)

mkw.aquvit.id
├── /rest/*    → localhost:3007 (PostgREST Manokwari)
├── /auth/*    → localhost:3003 (Auth Server Manokwari)
└── /*         → /var/www/aquvit (Static files)
```

## Database Dump/Restore

### Dump dari VPS

```bash
ssh -i Aquvit.pem deployer@103.197.190.54
pg_dump -U aquavit -h localhost mkw_db > mkw_db_backup.sql
```

### Restore ke Local Docker

```bash
docker cp mkw_db_backup.sql aquvit-postgres:/tmp/
docker exec aquvit-postgres psql -U postgres -c "CREATE DATABASE aquvit_test;"
docker exec aquvit-postgres psql -U postgres -d aquvit_test -f /tmp/mkw_db_backup.sql
```

## PostgREST Roles

```sql
-- Create roles if not exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
```

---

## VPS Server Information

| Item | Value |
|------|-------|
| **Hostname** | AQUVIT |
| **IP Address** | `103.197.190.54` |
| **OS** | Ubuntu 22.04.5 LTS |
| **SSH User** | `deployer` |
| **SSH Key** | `Aquvit.pem` |
| **Database** | PostgreSQL 14 (`aquvit_db`) |
| **Web Root** | `/var/www/aquvit` |

### Domain & Services

| Domain | Lokasi | Port |
|--------|--------|------|
| `nbx.aquvit.id` | Nabire | 443 (HTTPS) |
| `mkw.aquvit.id` | Manokwari | 443 (HTTPS) |

> **Note:** Domain lama `app.aquvit.id` dan `erp.aquvit.id` sudah tidak aktif (2025-12-25).

### Services Running

| Service | Port | Config | Database |
|---------|------|--------|----------|
| PostgREST (Nabire) | 3000 | `/home/deployer/postgrest/postgrest.conf` | `aquvit_new` |
| PostgREST (Manokwari) | 3007 | `/home/deployer/postgrest-mkw/postgrest.conf` | `mkw_db` |
| Auth Server (Nabire) | 3006 | `/home/deployer/auth-server/server.js` | `aquvit_new` |
| Auth Server (Manokwari) | 3003 | `/home/deployer/auth-server-mkw/server.js` | `mkw_db` |
| Nginx | 80, 443 | Reverse proxy |  |
| PostgreSQL | 5432 | Database server |  |

### Database Configuration

| Lokasi | Database Name | PostgREST Port | Auth Port |
|--------|---------------|----------------|-----------|
| Nabire | `aquvit_new` | 3000 | 3006 |
| Manokwari | `mkw_db` | 3007 | 3003 |

### Database Credentials

```
User: aquavit
Password: Aquvit2024
Host: 127.0.0.1
Port: 5432
```

**Contoh koneksi psql:**
```bash
# Nabire
PGPASSWORD='Aquvit2024' psql -U aquavit -h 127.0.0.1 -d aquvit_new

# Manokwari
PGPASSWORD='Aquvit2024' psql -U aquavit -h 127.0.0.1 -d mkw_db

# Atau dengan sudo (untuk ALTER TABLE dll jika perlu superuser)
sudo -u postgres psql -d aquvit_new
sudo -u postgres psql -d mkw_db
```

### Database Schema Notes

**PENTING untuk AI:**

1. **Tabel Karyawan = `profiles`** (bukan `employees`)
   - Frontend type: `Employee` → Database table: `profiles`
   - Field `name` adalah generated column dari `full_name`
   - Roles: `owner`, `admin`, `cashier`, `driver`, `sales`, `helper`, `operator`, `designer`, `supervisor`

2. **Foreign Key ke karyawan selalu ke `profiles(id)`**
   ```sql
   -- Contoh benar:
   ALTER TABLE accounts ADD COLUMN employee_id UUID REFERENCES profiles(id);

   -- SALAH (tabel tidak ada):
   ALTER TABLE accounts ADD COLUMN employee_id UUID REFERENCES employees(id);
   ```

3. **Ownership tabel berbeda per database:**
   - Nabire: Mix `aquavit` dan `postgres`
   - Manokwari: Semua owned by `postgres`
   - Gunakan `sudo -u postgres` untuk ALTER TABLE di Manokwari

4. **Setelah ALTER TABLE, restart PostgREST:**
   ```bash
   pm2 restart postgrest-aquvit postgrest-mkw
   ```

5. **Total 55 tabel** termasuk:
   - `accounts` - Chart of Accounts
   - `profiles` - Karyawan/Users
   - `transactions` - Transaksi penjualan
   - `deliveries` - Pengiriman
   - `journal_entries` + `journal_entry_lines` - Jurnal akuntansi
   - `customers`, `suppliers`, `products`, `materials`
   - Dan lainnya...

### PM2 Process Names

```bash
pm2 list
# auth-server-new     (port 3006 - Nabire)
# auth-server-mkw     (port 3003 - Manokwari)
# postgrest-aquvit    (port 3000 - Nabire)
# postgrest-mkw       (port 3007 - Manokwari)
```

### SSH Connection

```bash
ssh -i Aquvit.pem deployer@103.197.190.54
```

### Useful Commands

```bash
# Check PostgREST status
sudo systemctl status postgrest

# Restart PostgREST
sudo systemctl restart postgrest

# Reload PostgREST schema (tanpa restart)
sudo kill -SIGUSR1 $(pgrep postgrest)

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log
```

---

## [v4.3] 2026-01-04 - RPC Atomic Operations (PENTING!)

### 🚨 CRITICAL UPDATE: Database RPC Functions

Semua operasi database yang memerlukan **atomicity** (transaksi + jurnal + stok) WAJIB menggunakan RPC functions.
Ini mencegah data inconsistency dan menjamin FIFO inventory tracking.

### Folder Struktur RPC

```
database/rpc/
├── 00_README.md              # Dokumentasi lengkap (BACA INI!)
├── 01_fifo_inventory.sql     # FIFO consume/restore untuk products
├── 02_fifo_material.sql      # FIFO consume/restore untuk materials
├── 03_journal.sql            # Create journal atomic dengan validasi
├── 04_production.sql         # Production + material consume + journal
├── 05_delivery.sql           # Delivery + stock consume + HPP journal
├── 06_payment.sql            # Receivable/Payable payment + journal
├── 07_void.sql               # Void operations dengan restore inventory
└── 08_purchase_order.sql     # PO receive dan delete atomic
```

### RPC Functions Reference

| Function | Purpose | Key Parameters |
|----------|---------|----------------|
| `consume_inventory_fifo` | Kurangi stok produk (FIFO) | `p_product_id`, `p_branch_id`, `p_quantity` |
| `restore_inventory_fifo` | Kembalikan stok produk | `p_product_id`, `p_branch_id`, `p_quantity` |
| `consume_material_fifo` | Kurangi stok material | `p_material_id`, `p_branch_id`, `p_quantity` |
| `restore_material_fifo` | Kembalikan stok material | `p_material_id`, `p_branch_id`, `p_quantity` |
| `add_material_batch` | Tambah batch material baru | `p_material_id`, `p_branch_id`, `p_quantity`, `p_unit_cost` |
| `create_journal_atomic` | Buat jurnal dengan validasi | `p_branch_id`, `p_entry_date`, `p_lines[]` |
| `void_journal_entry` | Void jurnal entry | `p_journal_id`, `p_branch_id`, `p_reason` |
| `process_production_atomic` | Produksi + consume material + journal | `p_product_id`, `p_branch_id`, `p_quantity` |
| `process_spoilage_atomic` | Catat spoilage/kerusakan | `p_product_id`, `p_branch_id`, `p_quantity` |
| `process_delivery_atomic` | Delivery + consume stok + HPP journal | `p_transaction_id`, `p_branch_id`, `p_driver_id` |
| `process_laku_kantor_atomic` | Laku Kantor (stok langsung berkurang) | `p_transaction_id`, `p_branch_id` |
| `receive_payment_atomic` | Terima bayar piutang + journal | `p_receivable_id`, `p_branch_id`, `p_amount` |
| `pay_supplier_atomic` | Bayar hutang + journal | `p_payable_id`, `p_branch_id`, `p_amount` |
| `void_transaction_atomic` | Void transaksi + restore stok | `p_transaction_id`, `p_branch_id` |
| `void_delivery_atomic` | Void delivery + restore stok | `p_delivery_id`, `p_branch_id` |
| `void_production_atomic` | Void produksi + restore material | `p_production_id`, `p_branch_id` |
| `receive_po_atomic` | Terima PO + tambah batch FIFO | `p_po_id`, `p_branch_id` |
| `delete_po_atomic` | Hapus PO + rollback stok | `p_po_id`, `p_branch_id` |

### ⚠️ WAJIB: Branch Isolation

**SEMUA RPC function WAJIB menerima `p_branch_id` sebagai parameter!**

```typescript
// BENAR - selalu sertakan branch_id
const { data } = await supabase.rpc('void_delivery_atomic', {
  p_delivery_id: deliveryId,
  p_branch_id: currentBranch?.id,  // WAJIB!
  p_reason: 'Pembatalan pengiriman',
  p_user_id: user?.id
});

// SALAH - branch_id tidak boleh null
const { data } = await supabase.rpc('void_delivery_atomic', {
  p_delivery_id: deliveryId,
  p_branch_id: null  // ERROR: "Branch ID is REQUIRED!"
});
```

### 🔍 Schema Discovery (PENTING untuk AI!)

Beberapa tipe data di database BERBEDA dari yang umum diharapkan:

| Table | Column | Actual Type | Note |
|-------|--------|-------------|------|
| `transactions` | `id` | **TEXT** | Bukan UUID! Format: `TRX-YYYYMMDD-XXXX` |
| `accounts` | `id` | **TEXT** | Bukan UUID! Format: UUID-like string |
| `accounts_payable` | `id` | **TEXT** | Bukan UUID! |
| `journal_entries` | `void_reason` | TEXT | Bukan `voided_reason`! |
| `deliveries` | - | - | TIDAK punya kolom `status` |
| `transactions` | - | - | TIDAK punya kolom `delivery_status` |
| `production_records` | - | - | Tabel bernama `production_records`, BUKAN `production_batches` |
| `delivery_items` | - | - | Items delivery, BUKAN `transaction_items` |

### Frontend Hook dengan RPC

Hooks yang sudah menggunakan RPC:

```typescript
// useDeliveries.ts - createDelivery
const { data } = await supabase.rpc('process_delivery_atomic', {
  p_transaction_id: transactionId,
  p_branch_id: branchId,
  p_driver_id: driverId,
  p_items: deliveryItems,  // JSONB array
  // ... other params
});

// useDeliveries.ts - deleteDelivery (void)
const { data } = await supabase.rpc('void_delivery_atomic', {
  p_delivery_id: deliveryId,
  p_branch_id: branchId,
  p_reason: 'Delivery dihapus',
  p_user_id: userId
});

// usePurchaseOrders.ts - receivePO
const { data } = await supabase.rpc('receive_po_atomic', {
  p_po_id: poId,
  p_branch_id: branchId,
  p_received_date: new Date().toISOString().split('T')[0]
});
```

### Deploy RPC ke Local Development

```bash
# 1. Pastikan Docker containers running
docker start aquvit-postgres
docker start postgrest-local

# 2. Deploy semua RPC files (urutan penting!)
docker exec -i aquvit-postgres psql -U postgres -d aquvit_test < database/rpc/01_fifo_inventory.sql
docker exec -i aquvit-postgres psql -U postgres -d aquvit_test < database/rpc/02_fifo_material.sql
docker exec -i aquvit-postgres psql -U postgres -d aquvit_test < database/rpc/03_journal.sql
docker exec -i aquvit-postgres psql -U postgres -d aquvit_test < database/rpc/04_production.sql
docker exec -i aquvit-postgres psql -U postgres -d aquvit_test < database/rpc/05_delivery.sql
docker exec -i aquvit-postgres psql -U postgres -d aquvit_test < database/rpc/06_payment.sql
docker exec -i aquvit-postgres psql -U postgres -d aquvit_test < database/rpc/07_void.sql
docker exec -i aquvit-postgres psql -U postgres -d aquvit_test < database/rpc/08_purchase_order.sql

# 3. Restart PostgREST untuk reload schema
docker restart postgrest-local
```

### Deploy RPC ke VPS Production

```bash
# 1. SSH ke VPS
ssh -i Aquvit.pem deployer@103.197.190.54

# 2. Koneksi ke database
PGPASSWORD='Aquvit2024' psql -U aquavit -h 127.0.0.1 -d aquvit_new

# 3. Run setiap file SQL
\i /path/to/01_fifo_inventory.sql
\i /path/to/02_fifo_material.sql
# ... dst

# 4. Restart PostgREST
pm2 restart postgrest-aquvit postgrest-mkw
```

### RPC Return Format

Semua RPC mengembalikan format konsisten:

```typescript
interface RPCResult {
  success: boolean;           // true jika berhasil
  error_message?: string;     // Pesan error (bahasa Indonesia)
  // ... data spesifik per function
}

// Contoh handling
const { data, error } = await supabase.rpc('void_delivery_atomic', params);

if (error) {
  // Network/PostgREST error
  toast.error('Gagal menghubungi server');
  return;
}

const result = Array.isArray(data) ? data[0] : data;
if (!result?.success) {
  // Business logic error
  toast.error(result?.error_message || 'Operasi gagal');
  return;
}

// Success
toast.success(`${result.items_restored} item dikembalikan ke stok`);
```

### Kode Akun yang Digunakan RPC

| Kode | Nama Akun | Digunakan di |
|------|-----------|--------------|
| 1110 | Kas | Payment (cash) |
| 1120 | Bank | Payment (transfer) |
| 1210 | Piutang Usaha | Receivable payment |
| 1310 | Persediaan Barang Dagang | HPP, Delivery |
| 1320 | Persediaan Bahan Baku | Production, Material |
| 2110 | Hutang Usaha | Payable payment |
| 5100 | HPP | Delivery (Harga Pokok) |
| 8100 | Beban Lain-lain | Spoilage |

### Files Modified

- `database/rpc/*.sql` - 8 RPC files baru
- `src/hooks/useDeliveries.ts` - Gunakan `void_delivery_atomic`
- `src/hooks/usePurchaseOrders.ts` - Gunakan `receive_po_atomic`

---

## [v4.2] 2026-01-02 - Accounting System Improvements

### New Features

55. **COA Seeding dengan Fallback Template Standar**
    - Branch baru otomatis mendapat COA dari template standar jika HQ tidak punya COA
    - Template standar mencakup 50+ akun standar Indonesia
    - File: `src/hooks/useBranches.ts`

56. **Period Locking - Cegah Posting ke Periode Tertutup**
    - Jurnal tidak dapat dibuat pada periode yang sudah ditutup (tutup buku tahunan)
    - Validasi di `createJournalEntry()` - block posting ke periode tertutup
    - File: `src/services/journalService.ts`

57. **Optimasi Query dengan Caching Hook**
    - Hook baru: `src/hooks/useAccountBalanceSummary.ts`
    - Cache 2 menit untuk saldo akun
    - Getter helpers: `getAccountBalance(idOrCode)`, `getAccountsByType(type)`

58. **Journal Number Sequence yang Lebih Robust**
    - Database migration: `database/create_journal_sequence.sql`
    - RPC `get_next_journal_number()` dengan advisory lock
    - Format: `JE-YYYYMMDD-XXXX`

59. **HPP Bonus - Akun Terpisah untuk Barang Gratis**
    - Tambah akun **5210 HPP Bonus** untuk mencatat cost barang gratis
    - Jurnal: `Dr. HPP Bonus Cr. Persediaan`
    - File: `src/utils/chartOfAccountsUtils.ts`, `src/services/journalService.ts`

60. **Fix Arus Kas - Exclude Transfer Internal**
    - Skip jurnal dimana counterpart juga akun Kas/Bank (internal transfer)
    - File: `src/utils/financialStatementsUtils.ts`

### Technical Notes

**COA Balance System:**
```
PRINSIP DOUBLE-ENTRY ACCOUNTING:
- Saldo akun dihitung 100% dari journal_entry_lines
- Kolom accounts.balance TIDAK digunakan (legacy)
- initial_balance hanya referensi untuk opening journal

RUMUS PERHITUNGAN SALDO:
- Aset/Beban: saldo = SUM(debit) - SUM(credit)
- Kewajiban/Modal/Pendapatan: saldo = SUM(credit) - SUM(debit)
```

---

## [v4.1] 2025-12-31 - Permission System & Notification Enhancement

### New Features

50. **Low Stock Notification System**
    - Service: `src/services/lowStockNotificationService.ts`
    - Hook: `src/hooks/useLowStockCheck.ts`
    - Cek otomatis stock rendah setiap 30 menit
    - Mendukung produk DAN bahan (materials)
    - Notifikasi dikirim ke Owner, Supervisor, Admin, Manager
    - Threshold: `min_stock_level` dari database

51. **Mobile Notification Bell**
    - Component: `src/components/MobileNotificationBell.tsx`
    - Ditambahkan ke header MobileLayout
    - Sheet-based notification view (mobile-friendly)
    - Real-time badge untuk unread count
    - Support mark as read, mark all as read

52. **Enhanced Permission System**
    - Semua menu mobile sekarang dikontrol oleh permission
    - Permission mapping:
      - POS Kasir = `transactions_create` atau `pos_access`
      - POS Supir = `delivery_create` atau `pos_driver_access`
      - Data Transaksi = `transactions_view`
      - Data Pelanggan = `customers_view`
      - Input Produksi = `production_view` atau `production_create`
      - Gudang = `warehouse_access`
      - Retasi = `retasi_view`
      - Produk Laku = `transaction_items_report`
      - Komisi = `commission_view` atau `commission_report`
      - Absensi = `attendance_access` atau `attendance_view`

53. **Page-Level Permission Check**
    - RetasiPage & MobileRetasiPage: cek `retasi_view`
    - TransactionListPage: cek `transactions_view`
    - Menampilkan "Akses Ditolak" jika tidak punya izin

54. **Commission Report Enhancement**
    - Menampilkan nama pelanggan (customer name) dari transaksi
    - Fallback ke ref ID jika customer name tidak tersedia
    - Updated: `src/hooks/useOptimizedCommissions.ts`
    - Updated: `src/pages/MobileCommissionPage.tsx`

### Bug Fixes

- Fix: Menu mobile tidak mengikuti permission yang diatur
- Fix: Retasi masih bisa diakses meskipun permission dimatikan
- Fix: Laporan komisi menampilkan delivery ID bukan nama pelanggan
- Fix: Laporan Arus Kas tidak balance (Kas Awal + Kenaikan Kas ≠ Kas Akhir)
  - Masalah: `endingCash` diambil langsung dari saldo akun COA, bukan dihitung dari rumus arus kas
  - Solusi: `endingCash` sekarang dihitung dengan rumus: `beginningCash + netCashFlow`
  - File: `src/utils/financialStatementsUtils.ts`

### Files Changed

- `src/services/lowStockNotificationService.ts` (NEW)
- `src/hooks/useLowStockCheck.ts` (NEW)
- `src/components/MobileNotificationBell.tsx` (NEW)
- `src/components/layout/MobileLayout.tsx` (MODIFIED)
- `src/components/layout/Layout.tsx` (MODIFIED)
- `src/hooks/useGranularPermission.ts` (MODIFIED)
- `src/hooks/useOptimizedCommissions.ts` (MODIFIED)
- `src/pages/RetasiPage.tsx` (MODIFIED)
- `src/pages/MobileRetasiPage.tsx` (MODIFIED)
- `src/pages/TransactionListPage.tsx` (MODIFIED)
- `src/pages/MobileCommissionPage.tsx` (MODIFIED)
- `src/types/commission.ts` (MODIFIED)

---

## [v4] 2025-12-28 - APK Build & Bluetooth Printer Support

### New Features

46. **APK Live URL Mode**
    - APK sekarang load dari live server URL (tidak bundled assets)
    - **Tidak perlu rebuild APK** untuk update web/frontend
    - Cukup deploy ke VPS, APK otomatis dapat update terbaru
    - Nabire: `https://nbx.aquvit.id`
    - Manokwari: `https://mkw.aquvit.id`
    - Batch files auto-switch URL: `android/build_nabire.bat`, `android/build_manokwari.bat`
    - **Catatan:** APK butuh koneksi internet, tidak bisa offline

47. **Bluetooth Thermal Printer Support**
    - Plugin: `@capacitor-community/bluetooth-le@7.3.0`
    - Service: `src/services/bluetoothPrintService.ts`
    - Hook: `src/hooks/useBluetoothPrinter.ts`
    - Fitur:
      - Scan printer Bluetooth
      - Connect/Disconnect printer
      - Test print
      - Print struk POS dengan format ESC/POS
      - Auto-reconnect ke printer tersimpan

48. **Contacts Plugin**
    - Plugin: `@capacitor-community/contacts@7.1.0`
    - Permission: READ_CONTACTS, WRITE_CONTACTS

49. **Fix Auth Server Routing**
    - Perbaikan nginx config untuk auth routing
    - Sebelum: `/auth/v1/token` return 404
    - Sesudah: Auth endpoint berfungsi normal
    - Update pada `mkw.aquvit.id` dan `nbx.aquvit.id`

### APK Build Instructions

```bash
# Build untuk Nabire (nbx.aquvit.id)
npm run build:nabire
npx cap sync android
# Buka Android Studio -> Build APK

# Build untuk Manokwari (mkw.aquvit.id)
npm run build:manokwari
npx cap sync android
# Buka Android Studio -> Build APK

# Atau gunakan batch file:
android\build_nabire.bat
android\build_manokwari.bat
```

### Capacitor Plugins Installed

| Plugin | Version | Fungsi |
|--------|---------|--------|
| `@capacitor/camera` | 8.0.0 | Kamera & Galeri |
| `@capacitor/geolocation` | 8.0.0 | GPS/Lokasi |
| `@capacitor-community/bluetooth-le` | 7.3.0 | Bluetooth Printer |
| `@capacitor-community/contacts` | 7.1.0 | Akses Kontak |
| `@capacitor/browser` | 8.0.0 | In-app Browser |
| `@capacitor/local-notifications` | 8.0.0 | Notifikasi Lokal |
| `@capacitor/push-notifications` | 8.0.0 | Push Notification |

### Android Permissions (AndroidManifest.xml)

```xml
<!-- Bluetooth -->
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

<!-- Contacts -->
<uses-permission android:name="android.permission.READ_CONTACTS" />
<uses-permission android:name="android.permission.WRITE_CONTACTS" />

<!-- Camera, Location, Storage - sudah ada sebelumnya -->
```

### Files Created/Modified

| File | Perubahan |
|------|-----------|
| `src/services/bluetoothPrintService.ts` | Service Bluetooth printer |
| `src/hooks/useBluetoothPrinter.ts` | React hook untuk printer |
| `src/integrations/supabase/client.ts` | Support `VITE_APK_SERVER` env |
| `.env.nabire` | Environment untuk build Nabire |
| `.env.manokwari` | Environment untuk build Manokwari |
| `android/build_nabire.bat` | Batch file build Nabire |
| `android/build_manokwari.bat` | Batch file build Manokwari |
| `android/BUILD_APK.md` | Panduan build APK |
| `android/app/src/main/AndroidManifest.xml` | Tambah permission Bluetooth & Contacts |
| `package.json` | Tambah scripts build:nabire, build:manokwari |

### Bluetooth Printer Usage

```tsx
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';

function MyComponent() {
  const {
    scanForPrinters,
    connectToPrinter,
    printReceipt,
    testPrint,
    isConnected,
    devices,
  } = useBluetoothPrinter();

  // Scan printer
  await scanForPrinters();

  // Connect
  await connectToPrinter(devices[0]);

  // Print struk
  await printReceipt({
    storeName: 'Aquvit Store',
    transactionNo: 'TRX-001',
    items: [...],
    total: 100000,
    // ...
  });
}
```

### Forecast / Roadmap

| Fitur | Status | Deskripsi |
|-------|--------|-----------|
| **Driver Location Tracking** | Planned | Lacak lokasi supir secara real-time |
| - Background Location Service | - | Kirim lokasi ke server meski app di background |
| - Database `driver_locations` | - | Simpan history lokasi supir |
| - Admin Monitoring UI | - | Peta untuk melihat posisi semua supir |
| - WebSocket/Polling | - | Update posisi real-time ke admin |

---

## [v3] 2025-12-27 - Dashboard Enhancement & Retasi Improvement

### New Features

42. **Dashboard - Informasi Pelanggan Aktif & Tidak Aktif**
    - **File**: `src/components/Dashboard.tsx`
    - Mengganti section "Transaksi Terbaru" dengan 2 section baru:
    - **Pelanggan Aktif**: Tabel dengan pagination, menampilkan:
      - Nama pelanggan
      - Jumlah transaksi (badge hijau)
      - Total belanja
      - Tanggal transaksi terakhir
      - Diurutkan berdasarkan jumlah transaksi (terbanyak dulu)
    - **Pelanggan Tidak Aktif**: Card grid dengan pagination, menampilkan:
      - Pelanggan yang 30+ hari tidak transaksi
      - Pelanggan yang belum pernah transaksi
      - Hari sejak transaksi terakhir
      - Total transaksi dan nominal
    - Maksimal 5 data per halaman dengan tombol navigasi slide

43. **Form Retur Retasi - Input Per Produk**
    - **Files**:
      - `src/components/ReturnRetasiDialog.tsx` - UI form baru
      - `src/types/retasi.ts` - Type dengan `item_returns`
      - `src/hooks/useRetasi.ts` - Save per-item data
      - `src/pages/RetasiPage.tsx` - Fetch items saat dialog buka
    - Sebelumnya: Input total barang kembali/error/laku secara agregat
    - Sesudah: Tabel per produk yang dibawa dengan kolom:
      | Produk | Dibawa | Kembali | Laku | Error | Selisih |
    - Validasi: Total input tidak boleh melebihi jumlah dibawa
    - Summary: Total dibawa, kembali, laku, error, dan selisih
    - Data tersimpan per produk ke tabel `retasi_items`

44. **Perbaikan Perhitungan ROE dan DER di Dashboard**
    - **File**: `src/components/Dashboard.tsx`
    - **Masalah**: ROE dan DER selalu 0 karena akun Modal tidak memiliki jurnal entries
    - **Perbaikan**: Jika akun Modal kosong, gunakan persamaan akuntansi:
      - `Modal = Total Aset - Total Kewajiban`
    - Ini menghitung retained earnings (laba ditahan) secara otomatis

45. **Perubahan Idle Timeout Login Session**
    - **File**: `src/contexts/AuthContext.tsx`
    - Sebelumnya: 5 menit timeout (terlalu cepat)
    - Sesudah: 1 jam timeout dengan warning di menit ke-55
    - Note: JWT token di auth-server tetap 7 hari (tidak diubah)

### VPS Information

```
IP: 103.197.190.54
SSH: ssh -i Aquvit.pem deployer@103.197.190.54

Services:
- PostgREST Nabire: port 3000
- PostgREST Manokwari: port 3001
- Auth Server: port 3002
- PostgreSQL: port 5432

Database: aquvit_new (nama baru dari aquvit_db)

Useful Commands:
# Restart PostgREST
sudo systemctl restart postgrest
pm2 restart postgrest

# Reload schema tanpa restart
sudo kill -SIGUSR1 $(pgrep postgrest)

# Check logs
sudo tail -f /var/log/nginx/error.log
pm2 logs auth-server

# Backup database
pg_dump -U aquvit_user -h localhost aquvit_new > backup.sql
```

### Files Modified

| File | Perubahan |
|------|-----------|
| `src/components/Dashboard.tsx` | Pelanggan aktif/tidak aktif, fix ROE/DER |
| `src/components/ReturnRetasiDialog.tsx` | Form retur per produk |
| `src/types/retasi.ts` | Type `item_returns` untuk detail per produk |
| `src/hooks/useRetasi.ts` | Save per-item data saat return |
| `src/pages/RetasiPage.tsx` | Fetch items saat buka dialog return |
| `src/contexts/AuthContext.tsx` | Idle timeout 5 menit → 1 jam |

---

## 2025-12-25 21:45 WIT (Update 11) - Fix Date Error

### Bug Fixes

41. **Fix Invalid Date Error di DeliveryCompletionDialog**
    - **File**: `src/components/DeliveryCompletionDialog.tsx`
    - **Error**: `RangeError: Invalid time value` saat deliveryDate null
    - **Fix**: Tambah null check sebelum format date

---

## 2025-12-25 21:30 WIT (Update 10) - Database Rename

### Changes

40. **Database Rename**
    - `aquavit_db` → `aquvit_db` (Nabire)
    - Update PostgREST config `/home/deployer/postgrest/postgrest.conf`
    - Restart PostgREST service

---

## 2025-12-25 21:15 WIT (Update 9) - Domain Rename

### Changes

39. **Domain Rename**
    - `app.aquvit.id` → `nbx.aquvit.id` (Nabire)
    - `erp.aquvit.id` → `mkw.aquvit.id` (Manokwari)
    - SSL certificate baru untuk kedua domain
    - Nginx config diperbarui
    - Update `client.ts`, `App.tsx`, `ServerSelector.tsx` dengan URL baru
    - Build dan deploy ke VPS

---

## 2025-12-25 23:00 WIT (Update 8) - Customer Map & Nearby Tracking

### New Features

36. **Peta Pelanggan Interaktif**
    - Peta OpenStreetMap dengan semua pelanggan yang punya koordinat
    - Marker berbeda warna: Biru (Rumahan), Hijau (Kios/Toko), Merah (Lokasi User)
    - Popup info pelanggan: foto toko, nama, alamat, jarak, tombol telepon & rute
    - Auto-fit bounds ke semua marker
    - Route: `/customer-map`

37. **Fitur Lacak Pelanggan Terdekat**
    - Daftar pelanggan terdekat dari lokasi user saat ini
    - Filter radius: 500m, 1km, 2km, 5km, 10km, Semua
    - Urutan berdasarkan jarak terdekat
    - Ranking 1-3 dengan badge warna
    - Tombol langsung: Telepon & Rute Google Maps
    - Real-time GPS tracking (watch position)

38. **Geo Utilities**
    - Haversine formula untuk hitung jarak akurat
    - Sort customers by distance
    - Filter by radius

### Dependencies Added

- `leaflet` - Library peta open source
- `react-leaflet@4.2.1` - React wrapper untuk Leaflet (compatible React 18)
- `@types/leaflet` - TypeScript definitions

### Files Created

| File | Deskripsi |
|------|-----------|
| `src/pages/CustomerMapPage.tsx` | Halaman utama peta pelanggan |
| `src/components/CustomerMap.tsx` | Komponen peta Leaflet |
| `src/components/NearbyCustomerList.tsx` | Daftar pelanggan terdekat |
| `src/utils/geoUtils.ts` | Utility untuk kalkulasi jarak |

### Files Modified

| File | Perubahan |
|------|-----------|
| `src/App.tsx` | Tambah route `/customer-map` (mobile & desktop) |
| `src/components/layout/Sidebar.tsx` | Tambah menu "Peta Pelanggan" |
| `src/globals.css` | Import Leaflet CSS + custom marker styles |

### Notes

- Fitur ini murni real-time tracking, tidak menyimpan data ke database
- Berguna untuk driver/pengantar optimasi rute pengantaran
- GPS accuracy bergantung pada perangkat user

---

## 2025-12-25 22:30 WIT (Update 7) - Bug Fixes

### Bug Fixes

32. **Fix Token Retrieval untuk SQL Backup API**
    - **File**: `src/pages/WebManagementPage.tsx`
    - **Masalah**: Backup API call gagal 401 karena token diambil dari key yang salah (`auth_token`)
    - **Perbaikan**: Token sekarang diambil dari `localStorage.getItem('postgrest_auth_session')` dan di-parse JSON untuk mengambil `access_token`

33. **Fix Auth URL untuk Local Development**
    - **File**: `src/pages/WebManagementPage.tsx`
    - **Masalah**: Di localhost, API call ke `/auth/v1/admin/backup` gagal 404 karena auth-server tidak ada
    - **Perbaikan**: Menggunakan `getTenantConfigDynamic().authUrl` yang return URL VPS (`https://app.aquvit.id/auth`) untuk dev

34. **Fix Permission Denied pada View `payroll_summary`**
    - **Database**: GRANT SELECT pada view `payroll_summary` ke role authenticated, owner, admin, cashier, supervisor
    - **Command**: `pm2 restart postgrest` untuk apply changes

35. **Cleanup Debug Console.log**
    - **File**: `src/components/PaymentConfirmationDialog.tsx`
    - **Hapus**: `console.log('📊 PaymentDialog Debug:', {...})` yang spam di console

---

## 2025-12-25 22:10 WIT (Update 6) - SQL Full Backup Feature

### New Features

31. **SQL Full Backup dari Web (Owner Only)**
    - Fitur backup database lengkap (pg_dump) langsung dari Web Management
    - Termasuk: Schema, RLS Policies (72), Functions, Triggers, dan semua Data
    - Backup disimpan di VPS: `/home/deployer/backups/`
    - Otomatis di-compress (gzip) untuk menghemat storage
    - Backup otomatis dihapus setelah 7 hari
    - List semua backup files di server
    - Download backup file ke local
    - Delete backup file dari server

### API Endpoints Added (auth-server)

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| `POST` | `/auth/v1/admin/backup` | Create SQL backup |
| `GET` | `/auth/v1/admin/backups` | List all backups |
| `GET` | `/auth/v1/admin/backup/download/:filename` | Download backup file |
| `DELETE` | `/auth/v1/admin/backup/:filename` | Delete backup file |

### Files Changed

- `src/pages/WebManagementPage.tsx` - Tambah section SQL Full Backup di tab Import/Export
- `scripts/auth-server/server.js` - Tambah 4 endpoint untuk backup management

### Notes

- Fitur ini memerlukan deploy ulang auth-server ke VPS
- Backup SQL lengkap hanya bisa dijalankan di production (VPS) karena butuh akses pg_dump

---

## 2025-12-25 21:46 WIT (Update 5) - Web Management Page

### New Features

27. **Web Management Page (Owner Only)**
    - Halaman baru untuk manajemen sistem yang hanya bisa diakses oleh Owner
    - Akses via: Sidebar > Pengaturan > Web Management
    - Route: `/web-management`

28. **Tab Healthy - System Health Check**
    - Cek status koneksi Database (response time)
    - Cek status Auth API
    - Tampilkan jumlah record di tabel utama (customers, products, transactions, accounts)
    - Tombol "Run Health Check" untuk refresh status
    - Visual indicator: Healthy (hijau), Error (merah), Unknown (abu)

29. **Tab Reset Database - Selective Data Reset**
    - Pilih kategori data yang mau dihapus secara selektif
    - Kategori tersedia: Sales, Customers, Inventory, Production, Purchasing, Journal, Finance, HR, Operations, Branches, Assets, Loans, Zakat
    - "Select All" untuk memilih semua kategori
    - Warning untuk dependency antar kategori
    - Konfirmasi dengan password sebelum eksekusi
    - Dialog konfirmasi dengan detail tabel yang akan dihapus

30. **Tab Import/Export - Backup & Restore**
    - **Export (Backup)**: Download seluruh data database ke file JSON
    - Progress bar dengan status per tabel
    - File otomatis bernama `aquvit-backup-YYYY-MM-DD-HHmmss.json`
    - **Import (Restore)**: Upload file backup JSON
    - Validasi format file backup
    - Info backup: tanggal dibuat, server asal, jumlah record
    - Opsi: Hapus data existing sebelum restore (destructive)
    - Opsi: Skip restore users (lebih aman)
    - Progress bar dan detail log restore

### Files Created

- `src/pages/WebManagementPage.tsx` - Halaman utama Web Management dengan 3 tab
- `src/services/backupRestoreService.ts` - Service untuk backup/restore data via PostgREST
- `src/components/BackupRestoreDialog.tsx` - Dialog component (tidak dipakai, integrated ke page)

### Files Changed

- `src/App.tsx` - Tambah route `/web-management`
- `src/components/layout/Sidebar.tsx` - Tambah menu "Web Management" di section Pengaturan (owner only)

---

## 2025-12-25 (Update 4) - Perbaikan UI Mobile POS

### New Features

23. **Pemilihan Sales di Mobile POS**
    - Ditambahkan card Sales dengan background hijau di halaman POS mobile
    - User bisa memilih sales yang bertanggung jawab untuk transaksi
    - Jika user login dengan role `sales`, otomatis terpilih sebagai sales

24. **Input Item yang Lebih Mudah**
    - **Tombol Tambah (hijau)**: Buka sheet pilih produk dengan grid 2 kolom
    - **Pencarian produk**: Langsung cari produk dengan auto-focus
    - **Indikator keranjang**: Produk yang sudah di-cart ditandai dengan badge hijau
    - **Kontrol qty langsung**: Tombol [-] dan [+] di daftar item, plus input angka yang bisa diketik langsung
    - **Auto-select input**: Saat tap input angka, semua angka ter-select otomatis untuk replace cepat

25. **Pembayaran yang Disederhanakan**
    - Tombol metode pembayaran (Tunai, Transfer, dll) langsung tampil tanpa dropdown
    - Tombol "Lunas" dan "Belum Bayar" untuk switch cepat
    - Input bayar sebagian hanya muncul jika tidak pilih Lunas
    - Badge status "✓ Pembayaran Lunas" saat sudah bayar penuh

26. **Dialog Sukses Setelah Transaksi**
    - Setelah transaksi berhasil, muncul dialog sukses (bukan langsung redirect)
    - Menampilkan total transaksi, nama pelanggan, dan ID transaksi
    - **Cetak Struk (RawBT)**: Tombol biru untuk print thermal via RawBT
    - **Lihat Detail Transaksi**: Navigasi ke halaman transaksi dengan highlight
    - **Transaksi Baru**: Reset form untuk transaksi baru
    - **Ke Daftar Transaksi**: Navigasi ke halaman transaksi

### Improvements

- Hapus console.log debug dari `client.ts` untuk production
- Auto-select pada semua input number untuk UX lebih baik
- Spinner arrows dihilangkan pada input number untuk tampilan lebih bersih

### Files Changed

- `src/components/MobilePosForm.tsx` - Redesign UI untuk mobile POS + Success dialog
- `src/components/PosForm.tsx` - Tambah auto-select sales untuk desktop
- `src/integrations/supabase/client.ts` - Cleanup debug logs

---

## 2025-12-25 (Update 3) - Perbaikan RLS Role Inheritance

### Bug Fixes

21. **Login Error 403 Forbidden untuk Semua Role**
    - **Masalah**: User dengan role `sales`, `owner`, `admin`, `cashier`, `supir`, dll tidak bisa login - semua request API return 403 Forbidden
    - **Penyebab**: Role-role aplikasi (`owner`, `admin`, `cashier`, `supir`, `sales`, `supervisor`, `designer`, `operator`) tidak inherit dari role `authenticated`
    - **Detail**: RLS policies menggunakan `TO authenticated` tapi role aplikasi bukan member dari `authenticated`, sehingga policies tidak berlaku
    - **Perbaikan**: Grant role `authenticated` ke semua role aplikasi di PostgreSQL:

    ```sql
    -- Grant authenticated ke semua role aplikasi
    GRANT authenticated TO owner;
    GRANT authenticated TO admin;
    GRANT authenticated TO cashier;
    GRANT authenticated TO supir;
    GRANT authenticated TO sales;
    GRANT authenticated TO supervisor;
    GRANT authenticated TO designer;
    GRANT authenticated TO operator;
    ```

    - **Verifikasi**:
    ```sql
    SELECT r.rolname, ARRAY(SELECT b.rolname FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles b ON m.roleid = b.oid WHERE m.member = r.oid) as member_of
    FROM pg_catalog.pg_roles r
    WHERE r.rolname IN ('owner', 'admin', 'cashier', 'supir', 'sales', 'supervisor', 'designer', 'operator');
    ```

22. **Cleanup Console Debug Logs**
    - **File**: `src/contexts/BranchContext.tsx`
    - **Perubahan**: Menghapus semua `console.log`, `console.warn`, dan `console.error` untuk production build
    - **Alasan**: Mengurangi noise di browser console dan meningkatkan performa

### Technical Notes

**Mengapa Role Harus Inherit dari `authenticated`?**

PostgREST menggunakan role-based access control (RBAC). Ketika user login dengan JWT yang memiliki role claim (misal: `sales`), PostgREST akan `SET ROLE sales` di PostgreSQL.

RLS policies di sistem ini menggunakan:
```sql
CREATE POLICY xxx ON table_name FOR ALL TO authenticated USING (true);
```

Jika role `sales` bukan member dari `authenticated`, maka policy tersebut tidak berlaku untuk role `sales`, sehingga query return 0 rows atau 403 Forbidden.

**Role Hierarchy Setelah Perbaikan:**
```
authenticated (parent role)
├── owner
├── admin
├── cashier
├── supir
├── sales
├── supervisor
├── designer
└── operator
```

---

## 2025-12-25 (Update 2) - Fix Fungsi FIFO Duplikat

### Bug Fixes

20. **Fungsi FIFO Duplikat Dihapus**
    - **Masalah**: Ada 2 fungsi `consume_inventory_fifo` di database dengan signature berbeda, menyebabkan error "function is not unique"
    - **Perbaikan**: Drop fungsi lama yang tidak punya parameter `p_material_id`

### Alur Stok (Tidak Berubah)

```
LAKU KANTOR (isOfficeSale = true):
  Transaksi Dibuat -> Stok berkurang
  Delete Transaction -> Stok dikembalikan

BUKAN LAKU KANTOR (isOfficeSale = false):
  Transaksi Dibuat -> (stok belum berubah)
  Delivery -> Stok berkurang
  Delete Delivery -> Stok dikembalikan
```

| Kondisi | Kapan Stok Berkurang | Kapan Stok Di-restore |
|---------|---------------------|----------------------|
| Laku Kantor | Saat transaksi dibuat | Saat delete transaction |
| Bukan Laku Kantor | Saat delivery | Saat delete delivery |

---

## 2025-12-25 - Implementasi FIFO Inventory untuk HPP

### Fitur Baru

16. **FIFO Inventory System untuk HPP (Harga Pokok Penjualan)**
    - **Tujuan**: HPP dihitung berdasarkan harga beli aktual dari PO menggunakan metode FIFO (First In, First Out)
    - **Database Changes** (Nabire - `aquvit_db`):
      - Menambahkan kolom `material_id` di tabel `inventory_batches` untuk tracking material
      - Membuat fungsi `consume_inventory_fifo()` yang mendukung product dan material
      - Membuat fungsi helper `get_product_fifo_cost()` dan `get_material_fifo_cost()`

    ```sql
    -- Struktur inventory_batches
    inventory_batches (
      id, product_id, material_id, branch_id, batch_date,
      purchase_order_id, supplier_id,
      initial_quantity, remaining_quantity, unit_cost,
      notes, created_at, updated_at
    )

    -- Fungsi FIFO consumption
    consume_inventory_fifo(
      p_product_id uuid,
      p_branch_id uuid,
      p_quantity numeric,
      p_transaction_id text,
      p_material_id uuid  -- NEW: untuk konsumsi material produksi
    ) RETURNS (total_hpp numeric, batches_consumed jsonb)
    ```

17. **Integrasi FIFO dengan Penerimaan PO**
    - File: `src/hooks/usePurchaseOrders.ts` (baris 610-683)
    - Saat PO di-receive, sistem otomatis membuat `inventory_batch` dengan:
      - `unit_cost` = harga beli dari PO item
      - `material_id` atau `product_id` sesuai jenis item
      - `purchase_order_id` untuk audit trail
    - Ini memungkinkan tracking harga beli yang berbeda per supplier/waktu

18. **Integrasi FIFO dengan Penjualan**
    - File: `src/hooks/useTransactions.ts` (baris 340-397)
    - Saat transaksi penjualan:
      1. Sistem memanggil `consume_inventory_fifo()` untuk consume batch tertua
      2. HPP dihitung dari total cost batch yang dikonsumsi
      3. Jika tidak ada batch, fallback ke `cost_price` produk
    - Jurnal HPP dibuat dengan nilai aktual dari FIFO

19. **Integrasi FIFO dengan Produksi**
    - File: `src/hooks/useProduction.ts` (baris 262-303)
    - Saat produksi:
      1. Untuk setiap material BOM, consume dari `inventory_batches` menggunakan FIFO
      2. Total material cost dihitung dari harga batch yang dikonsumsi
      3. Jurnal produksi menggunakan cost aktual dari material FIFO
    - Fallback ke `cost_price` material jika tidak ada batch

### Alur FIFO HPP

```
PO Created -> PO Approved -> PO Received
                              |
                    inventory_batch created
                    (material_id/product_id, unit_cost dari PO)
                              |
            +-----------------+------------------+
            |                                    |
    Penjualan Produk                       Produksi
            |                                    |
    consume_inventory_fifo()         consume_inventory_fifo()
    (untuk product_id)               (untuk material_id)
            |                                    |
    HPP = sum(batch.unit_cost * qty)   Material Cost = sum(batch.unit_cost * qty)
            |                                    |
    Jurnal: Dr. HPP (5xxx)           Jurnal: Dr. Persediaan Barang (1310)
            Cr. Persediaan (1310)            Cr. Persediaan Bahan (1320)
```

### File yang Dimodifikasi

| File | Perubahan |
|------|-----------|
| `src/hooks/usePurchaseOrders.ts` | Membuat inventory_batch saat receive PO (material & product) |
| `src/hooks/useTransactions.ts` | Consume FIFO batch saat penjualan untuk HPP |
| `src/hooks/useProduction.ts` | Consume FIFO batch untuk material produksi |
| `database/fifo_inventory.sql` | SQL untuk tabel dan fungsi FIFO |

### Catatan Penting

1. **Data Historis**: PO yang sudah di-receive sebelum fitur ini aktif tidak memiliki `inventory_batch`, sehingga akan fallback ke `cost_price`
2. **Migrasi**: Untuk PO lama, bisa manually insert `inventory_batch` jika diperlukan
3. **Multi-Branch**: FIFO tracking per-branch (batch hanya dikonsumsi dari branch yang sama)

---

## 2025-12-25 - Perbaikan Sistem Komisi & Payroll

### Bug Fixes

1. **Pemotongan Panjar Tidak Update Saldo Panjar Karyawan**
   - File: `src/hooks/usePayroll.ts`
   - Sebelumnya: Ketika payroll dibuat dengan pemotongan panjar, `employee_advances.remaining_amount` tidak diupdate
   - Sesudah: Menggunakan metode FIFO untuk mengurangi saldo panjar dari advance terlama
   - Logika: Loop melalui semua panjar aktif (remaining_amount > 0) terurut dari tanggal terlama, kurangi hingga total deduction terpenuhi

2. **Komisi Tidak Terhitung saat Hitung Gaji**
   - File: Database function `calculate_commission_for_period` & `calculate_payroll_with_advances`
   - Sebelumnya: RPC function mengharuskan `commission_rate > 0` di salary config untuk menghitung komisi
   - Sesudah: Komisi selalu dihitung dari tabel `commission_entries` untuk tipe gaji 'commission_only' dan 'mixed'

3. **RLS Policy Blocking Commission Tables**
   - File: `database/fix_commission_rls.sql`
   - Sebelumnya: Insert ke `commission_rules` diblok oleh RLS policy
   - Sesudah: Menambahkan policy permissive untuk SELECT, INSERT, UPDATE, DELETE pada `commission_rules` dan `commission_entries`

4. **Commission Entries Tidak Ter-generate dari Delivery**
   - File: `src/utils/commissionUtils.ts`
   - Masalah: Delivery yang dibuat sebelum commission rules di-setup tidak memiliki commission entries
   - Solusi: Menjalankan SQL untuk generate commission entries retroaktif berdasarkan delivery history

### Enhancements

5. **Status Komisi Update saat Payroll Dibuat**
   - File: `src/hooks/usePayroll.ts`
   - Fitur baru: Ketika payroll record dibuat, semua `commission_entries` untuk karyawan tersebut dalam periode yang sama otomatis diupdate statusnya ke 'paid'
   - Ini memastikan komisi tidak dihitung ulang di periode berikutnya

6. **Hapus Halaman Commission Manage**
   - File: `src/App.tsx`, `src/components/layout/Sidebar.tsx`
   - Dihapus: Route `/commission-manage` dan menu di sidebar
   - Alasan: Fitur setup komisi sudah dipindahkan ke tab di halaman Employee

### Catatan Teknis

**Alur Komisi:**
1. Admin setup commission rules per produk per role di halaman Employee
2. Saat delivery selesai, `generateDeliveryCommission()` membuat entries di `commission_entries`
3. Saat sales transaction, `generateSalesCommission()` membuat entries di `commission_entries`
4. RPC `calculate_commission_for_period` menghitung total dari `commission_entries` dengan status 'pending'
5. Saat payroll dibuat, status commission entries diupdate ke 'paid'

**Alur Pemotongan Panjar:**
1. Karyawan request panjar -> `employee_advances` dengan `remaining_amount` = jumlah panjar
2. Saat payroll, admin input jumlah pemotongan panjar
3. Sistem update `remaining_amount` menggunakan FIFO dari panjar terlama
4. Journal entry dicatat: Dr. Beban Gaji, Cr. Kas, Cr. Piutang Karyawan (jika ada potongan panjar)

---

## 2024-12-24 - Perbaikan Laporan Keuangan & Integrasi Jurnal

### Bug Fixes

1. **React Key Warning di JournalEntryTable**
   - File: `src/components/JournalEntryTable.tsx`
   - Perbaikan: Mengganti `<>` menjadi `<React.Fragment key={entry.id}>` dalam `.map()` untuk menghilangkan warning "Each child in a list should have a unique key prop"

2. **Dialog Accessibility Warning**
   - File: `src/components/ui/dialog.tsx`
   - Perbaikan:
     - Menambahkan import `@radix-ui/react-visually-hidden`
     - Menambahkan komponen `VisuallyHidden` untuk accessibility fallback
     - Menambahkan prop `aria-describedby` pada `DialogContent`
     - Menambahkan prop `hideCloseButton` untuk opsional menyembunyikan tombol close

### Perbaikan Laporan Keuangan

**Masalah:** Laporan keuangan (Balance Sheet, Income Statement, Cash Flow Statement) tidak menampilkan data yang benar karena menggunakan kolom `accounts.balance` yang tidak pernah diupdate.

**Solusi:** Semua laporan keuangan sekarang menghitung saldo akun secara dinamis dari `journal_entry_lines`.

3. **Balance Sheet - Perhitungan Saldo dari Jurnal**
   - File: `src/utils/financialStatementsUtils.ts`
   - Menambahkan fungsi `calculateAccountBalancesFromJournal()` yang menghitung saldo akun berdasarkan:
     - `initial_balance` dari akun
     - Semua `journal_entry_lines` dengan status 'posted' dan `is_voided = false`
     - Filter per-branch menggunakan `branchId`
     - Support tanggal cut-off dengan parameter `asOfDate`
   - Logika perhitungan saldo berdasarkan tipe akun:
     - **Aset & Beban**: Debit (+), Credit (-)
     - **Kewajiban, Modal, Pendapatan**: Credit (+), Debit (-)

4. **Income Statement - Konfirmasi Integrasi Jurnal**
   - File: `src/utils/financialStatementsUtils.ts`
   - Income Statement sudah menggunakan `journal_entry_lines` dengan benar
   - Query filter: `status = 'posted'` dan `is_voided = false`
   - Pendapatan dihitung dari akun dengan kode awalan '4'
   - HPP dihitung dari akun dengan kode awalan '5'
   - Beban Operasional dihitung dari akun dengan kode awalan '6'

5. **Cash Flow Statement - Perbaikan Saldo Kas Akhir**
   - File: `src/utils/financialStatementsUtils.ts`
   - Sebelumnya: `endingCash` diambil dari `accounts.balance` (statis)
   - Sesudah: `endingCash` dihitung dari `calculateAccountBalancesFromJournal()` dengan parameter `periodTo`
   - Ini memastikan saldo kas akhir periode akurat berdasarkan jurnal yang sudah di-posting

### Catatan Teknis

**Mengapa Saldo Tidak Diupdate di COA?**

Sistem ini **tidak** mengupdate kolom `balance` di tabel `accounts` ketika jurnal di-posting. Ini adalah keputusan desain yang disengaja:

1. **Konsistensi Data** - Saldo selalu dihitung dari sumber yang sama (journal entries)
2. **Fleksibilitas Periode** - Bisa menghitung saldo untuk tanggal apapun (historical reporting)
3. **Audit Trail** - Semua perubahan saldo bisa di-trace ke jurnal tertentu
4. **Menghindari Duplikasi** - Tidak perlu sinkronisasi antara dua sumber data

**File yang Menggunakan Perhitungan Dinamis:**

| File | Fungsi |
|------|--------|
| `src/hooks/useAccounts.ts` | Menampilkan saldo akun di UI |
| `src/utils/financialStatementsUtils.ts` | Laporan Keuangan (Balance Sheet, Income Statement, Cash Flow) |

**Logika Perhitungan:**

```typescript
// Untuk setiap journal_entry_line yang posted & tidak voided:
const isDebitNormal = ['Aset', 'Beban'].includes(accountType);
const balanceChange = isDebitNormal
  ? debitAmount - creditAmount
  : creditAmount - debitAmount;

// Saldo = initial_balance + sum(balanceChange dari semua jurnal)
```

---

## 2024-12-24 (Update 2) - Perbaikan Laporan Arus Kas

### Bug Fixes

6. **Kode Akun Panjar Karyawan Salah**
   - File: `src/utils/financialStatementsUtils.ts`
   - Sebelumnya: Filter mencari kode `13xx` untuk panjar karyawan
   - Sesudah: Filter mencari kode `122x` (sesuai COA: 1220 = Piutang Karyawan)
   - Ini memperbaiki:
     - `fromAdvanceRepayment` (pelunasan panjar dari karyawan)
     - `forEmployeeAdvances` (pemberian panjar ke karyawan)

7. **Filter Pembayaran ke Supplier Diperbaiki**
   - Sebelumnya: Mencari kode `13xx` yang juga mencakup Piutang Karyawan
   - Sesudah: Mencari kode `131x`, `132x` (Persediaan) atau `211x` (Hutang Usaha) saja
   - Filter juga mencakup nama akun: `persediaan`, `bahan`, `hutang usaha`

### UI Improvements

8. **Laporan Arus Kas Menampilkan Detail per Akun**
   - File: `src/pages/FinancialReportsPage.tsx`
   - Sebelumnya: Hanya menampilkan kategori summary (Pelanggan, Pembayaran piutang, dll)
   - Sesudah: Menampilkan detail per akun lawan (`byAccount`) dari jurnal
   - Ini memungkinkan melihat semua transaksi yang mempengaruhi kas secara detail

**Kode Akun Referensi:**

| Kode | Nama Akun | Kategori |
|------|-----------|----------|
| 1120 | Kas Tunai | Kas/Bank |
| 121x | Piutang Usaha | Piutang |
| 1220 | Piutang Karyawan (Panjar) | Piutang |
| 131x | Persediaan Barang Dagang | Persediaan |
| 132x | Persediaan Bahan Baku | Persediaan |
| 211x | Hutang Usaha | Kewajiban |
| 4xxx | Pendapatan | Pendapatan |
| 5xxx | HPP | HPP |
| 6xxx | Beban Operasional | Beban |

---

## 2024-12-24 (Update 3) - Perbaikan Laporan Laba Rugi

### Bug Fixes

10. **Income Statement Tidak Menampilkan Pendapatan**
    - File: `src/utils/financialStatementsUtils.ts`
    - **Masalah**: Query accounts menggunakan filter `branch_id` padahal COA adalah global
    - **Akibat**: `accountsData` kosong sehingga `accountTypes` tidak terisi, akun tidak bisa diklasifikasikan
    - **Perbaikan**: Menghapus filter `branch_id` dari query accounts

    ```typescript
    // SEBELUM (SALAH):
    let accountsQuery = supabase
      .from('accounts')
      .select('id, code, name, type, is_header')
      .order('code');

    if (branchId) {
      accountsQuery = accountsQuery.eq('branch_id', branchId); // COA tidak punya branch_id
    }

    // SESUDAH (BENAR):
    const { data: accountsData } = await supabase
      .from('accounts')
      .select('id, code, name, type, is_header')
      .order('code');
    // Note: Branch filtering sudah dilakukan di level journal_entries
    ```

---

## 2024-12-24 (Update 4) - Perbaikan Final Income Statement

### Bug Fixes

12. **Income Statement Pendapatan Tetap 0 Meskipun Ada Journal Lines**
    - File: `src/utils/financialStatementsUtils.ts`
    - **Masalah**: Akun dibuat per-branch dengan ID berbeda, tapi kode sama. `account_id` di journal_entry_lines tidak cocok dengan ID akun di tabel accounts global.
    - **Perbaikan**: Menggunakan `account_code` (bukan `account_id`) sebagai primary key untuk aggregasi journal lines
    - **Fallback**: Jika `accountTypes` lookup gagal, infer tipe akun dari prefix kode:
      - `1xxx` = Aset
      - `2xxx` = Kewajiban
      - `3xxx` = Modal
      - `4xxx` = Pendapatan
      - `5xxx`, `6xxx` = Beban (HPP & Operasional)
      - `7xxx` = Pendapatan Lain-lain
      - `8xxx` = Beban Lain-lain

### Penjelasan: COA Per-Branch

Sistem AQUVIT menggunakan **COA per-branch**, artinya setiap cabang memiliki akun terpisah dengan ID berbeda tapi kode yang sama:

| Branch | Account ID | Account Code | Account Name |
|--------|------------|--------------|--------------|
| Pusat | `acc-001` | `4100` | Pendapatan Usaha |
| Cabang A | `acc-101` | `4100` | Pendapatan Usaha |
| Cabang B | `acc-201` | `4100` | Pendapatan Usaha |

Karena itu, penghitungan laporan keuangan menggunakan **kode akun** sebagai identifier, bukan ID akun.

---

## 2024-12-24 (Update 5) - Perbaikan Payroll System

### Bug Fixes

13. **RLS Policies untuk Payroll Tables**
    - **Masalah**: Tombol "Setujui", "Bayar", dan "Hapus" di halaman payroll tidak berfungsi - error 401 Unauthorized
    - **Penyebab**: Tabel `payroll_records` dan `employee_salaries` tidak memiliki RLS policies yang tepat
    - **Perbaikan**: Menambahkan RLS policies di server database:

    ```sql
    -- EMPLOYEE_SALARIES
    CREATE POLICY employee_salaries_select ON employee_salaries FOR SELECT TO owner, admin, supervisor, cashier, authenticated USING (true);
    CREATE POLICY employee_salaries_insert ON employee_salaries FOR INSERT TO owner, admin, authenticated WITH CHECK (true);
    CREATE POLICY employee_salaries_update ON employee_salaries FOR UPDATE TO owner, admin, authenticated USING (true);
    CREATE POLICY employee_salaries_delete ON employee_salaries FOR DELETE TO owner, admin USING (true);

    -- PAYROLL_RECORDS
    CREATE POLICY payroll_records_select ON payroll_records FOR SELECT TO owner, admin, supervisor, cashier, authenticated USING (true);
    CREATE POLICY payroll_records_insert ON payroll_records FOR INSERT TO owner, admin, authenticated WITH CHECK (true);
    CREATE POLICY payroll_records_update ON payroll_records FOR UPDATE TO owner, admin, authenticated USING (true);
    CREATE POLICY payroll_records_delete ON payroll_records FOR DELETE TO owner, admin USING (true);
    ```

    - File SQL: `database/fix_payroll_rls.sql`

14. **UI Tidak Update Setelah Mutasi Payroll**
    - File: `src/hooks/usePayroll.ts`
    - **Masalah**: Setelah approve/delete/pay berhasil di server (HTTP 204), data di UI tidak berubah
    - **Penyebab**: `invalidateQueries` menggunakan `exact: true` (default) sehingga tidak match dengan query yang memiliki filters dan branch_id
    - **Perbaikan**: Menambahkan `exact: false` pada semua `invalidateQueries` dan `refetchQueries`:

    ```typescript
    // SEBELUM (tidak match query dengan filters):
    await queryClient.invalidateQueries({ queryKey: ['payrollRecords'] });

    // SESUDAH (match semua variant):
    await queryClient.invalidateQueries({ queryKey: ['payrollRecords'], exact: false });
    await queryClient.refetchQueries({ queryKey: ['payrollRecords'], exact: false, type: 'active' });
    ```

15. **PostgREST Service Restart**
    - **Masalah**: PostgREST service gagal start dengan error "Address in use"
    - **Penyebab**: Ada orphan process yang masih menggunakan port 3000
    - **Perbaikan**: Kill orphan process dan restart PostgREST, lalu kirim SIGUSR1 untuk reload schema cache

### File yang Dimodifikasi

| File | Perubahan |
|------|-----------|
| `src/hooks/usePayroll.ts` | Perbaikan cache invalidation dengan `exact: false` |
| `database/fix_all_rls_policies.sql` | Menambahkan RLS policies untuk payroll tables |
| `database/fix_payroll_rls.sql` | SQL standalone untuk fix RLS payroll |

---

## Known Issues

| Issue | Status | Deskripsi |
|-------|--------|-----------|
| POST 401 pada payroll_records | Resolved | Fixed dengan role inheritance ke `authenticated` |
| UI tidak update setelah delete | Resolved | Fixed dengan `exact: false` pada invalidateQueries |
| UI tidak update setelah approve | Resolved | Fixed dengan `exact: false` pada invalidateQueries |
| Login 403 Forbidden | Resolved | Fixed dengan `GRANT authenticated TO <role>` |
