# Transaction Edit Separation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Memindahkan fitur edit transaksi dari dialog yang menempel di tabel transaksi menjadi modul/halaman edit terpisah yang aman, sambil mempertahankan status nonaktif sampai sinkronisasi stok, jurnal, pembayaran, dan delivery sudah jelas.

**Architecture:** Gunakan route khusus ` /transactions/:id/edit ` dengan page container sendiri. Form edit dipisah dari daftar transaksi dan detail transaksi, lalu dibungkus guard bisnis yang menolak edit untuk transaksi yang sudah menyentuh delivery, jurnal, atau pembayaran yang tidak aman diubah. Selama fase awal, route boleh ada tetapi tetap menampilkan status "sementara dinonaktifkan" sampai RPC dan aturan bisnis selesai dibereskan.

**Tech Stack:** React, React Router, TanStack Query, existing hooks (`useTransactions`, `useCustomers`, `useProducts`, `useAccounts`), Supabase RPC, TypeScript.

---

## Current Findings

- `src/components/TransactionTable.tsx`
  - Tombol edit masih tampil.
  - `handleEditClick()` hanya memunculkan toast: **"Fitur Edit Transaksi Dinonaktifkan"**.
  - `EditTransactionDialog` masih di-import dan state edit masih disiapkan.
  - Render dialog sengaja dimatikan dengan `false && transactionToEdit && (...)`.
- `src/components/EditTransactionDialog.tsx`
  - Komponen edit lama masih utuh dan langsung memanggil `updateTransaction.mutate(...)`.
  - Validasi bisnis lokal hanya menahan sebagian kasus delivery/status.
- `src/pages/TransactionDetailPage.tsx`
  - Tidak ada tombol edit aktif.
- `src/App.tsx`
  - Belum ada route ` /transactions/:id/edit `.

## Target End State

1. Daftar transaksi tidak lagi menyimpan dialog edit besar di dalam file tabel.
2. Edit transaksi punya route/page sendiri.
3. Ada guard bisnis terpusat untuk menentukan apakah transaksi boleh diedit.
4. UI edit bisa diaktifkan kembali bertahap tanpa mengganggu list/detail page.
5. Rule edit mengikuti keputusan bisnis Aquvit/Matahari:
   - delivery OFF => direct office sale,
   - transaksi yang sudah menyentuh alur sinkronisasi rawan tidak boleh diedit sembarang.

---

### Task 1: Rapikan status nonaktif saat ini

**Objective:** Hilangkan sisa wiring edit lama yang membingungkan, tanpa mengubah perilaku user saat ini.

**Files:**
- Modify: `src/components/TransactionTable.tsx`
- Optional remove later: `src/components/EditTransactionDialog.tsx`

**Step 1: Ganti state edit lama menjadi aksi terarah**

Ubah agar tabel tidak lagi memelihara state yang tidak dipakai:
- hapus `isEditDialogOpen`
- hapus `transactionToEdit`
- hapus render `false && transactionToEdit && (...)`

**Step 2: Tegaskan mode sementara nonaktif**

Pertahankan salah satu dari dua opsi berikut:
- Opsi aman 1: tombol edit disembunyikan total.
- Opsi aman 2: tombol edit tetap ada tetapi badge/tooltip jelas menyebut "sementara dinonaktifkan".

**Recommended:** sembunyikan total agar user tidak mengira bisa dipakai.

**Step 3: Verifikasi compile**

Run:
```bash
npm run build
```

Expected:
- build sukses
- tidak ada import/state edit yatim

**Step 4: Commit**

```bash
git add src/components/TransactionTable.tsx
git commit -m "refactor: remove dormant transaction edit dialog wiring"
```

---

### Task 2: Buat guard bisnis edit transaksi terpusat

**Objective:** Pisahkan aturan "boleh edit / tidak boleh edit" dari UI supaya nanti dipakai bersama oleh list, detail, dan halaman edit.

**Files:**
- Create: `src/utils/transactionEditGuard.ts`
- Test or verify manually through import usage in page/components

**Step 1: Buat helper guard**

Isi awal minimal:
```ts
import { Transaction } from '@/types/transaction'

export interface TransactionEditGuardResult {
  allowed: boolean
  reason?: string
}

export function canEditTransaction(transaction: Transaction): TransactionEditGuardResult {
  const deliveredOrInProgress =
    transaction.deliveryStatus === 'Completed' ||
    transaction.deliveryStatus === 'Partial' ||
    transaction.deliveryStatus === 'In Progress' ||
    transaction.deliveryStatus === 'delivered' ||
    transaction.status === 'Selesai' ||
    transaction.status === 'Diantar Sebagian'

  if (deliveredOrInProgress) {
    return {
      allowed: false,
      reason: 'Transaksi yang sudah diproses pengantaran tidak boleh diedit.'
    }
  }

  return { allowed: true }
}
```

**Step 2: Pindahkan pengecekan lokal dari dialog lama ke helper ini**

Refactor `EditTransactionDialog.tsx` agar memakai helper di atas, bukan logika inline.

**Step 3: Verifikasi**

Minimal search manual:
- semua keputusan edit menggunakan helper yang sama

Run:
```bash
npm run build
```

Expected:
- build sukses
- tidak ada duplikasi aturan edit utama

**Step 4: Commit**

```bash
git add src/utils/transactionEditGuard.ts src/components/EditTransactionDialog.tsx
git commit -m "refactor: centralize transaction edit guard"
```

---

### Task 3: Buat halaman edit transaksi terpisah

**Objective:** Sediakan container edit mandiri dengan route sendiri, belum perlu diaktifkan penuh ke user umum.

**Files:**
- Create: `src/pages/TransactionEditPage.tsx`
- Modify: `src/App.tsx`
- Optional create: `src/components/transactions/TransactionEditForm.tsx`

**Step 1: Tambah route baru**

Di `src/App.tsx` tambahkan:
```tsx
<Route path="/transactions/:id/edit" element={<TransactionEditPage />} />
```

**Step 2: Buat page container**

`TransactionEditPage.tsx` minimal harus:
- baca `id` dari route
- ambil transaksi dari `useTransactions()`
- tampilkan loading/not-found state
- panggil `canEditTransaction(transaction)`
- jika belum diaktifkan, tampilkan notice bahwa edit masih dinonaktifkan sementara

Contoh struktur awal:
```tsx
export default function TransactionEditPage() {
  // get id
  // load transaction
  // show loading / not found
  // evaluate guard
  // return page shell + warning/disabled message
}
```

**Step 3: Jangan copy semua dialog mentah ke page**

Pisahkan isi form dari wrapper dialog lama. Yang dipindah hanya area form, bukan `Dialog`, `DialogContent`, `DialogHeader`.

**Step 4: Verifikasi route**

Run:
```bash
npm run build
```

Expected:
- route baru ikut ter-compile
- page edit bisa dirender tanpa dialog dependency

**Step 5: Commit**

```bash
git add src/App.tsx src/pages/TransactionEditPage.tsx
git commit -m "feat: add standalone transaction edit page shell"
```

---

### Task 4: Ekstrak form edit dari dialog lama

**Objective:** Pisahkan body form edit menjadi komponen reusable agar tidak terikat ke dialog atau page tertentu.

**Files:**
- Create: `src/components/transactions/TransactionEditForm.tsx`
- Modify: `src/components/EditTransactionDialog.tsx`
- Modify: `src/pages/TransactionEditPage.tsx`

**Step 1: Pindahkan isi form**

Ekstrak:
- customer select
- tanggal order
- sales
- items
- diskon/PPN
- pembayaran
- office sale state

ke komponen:
```tsx
<TransactionEditForm
  transaction={transaction}
  mode="page"
  onSuccess={...}
  onCancel={...}
/>
```

**Step 2: Dialog lama jadi wrapper tipis atau dipensiunkan**

Jika masih dibutuhkan untuk transisi internal:
- `EditTransactionDialog` cukup membungkus `TransactionEditForm`

Kalau tidak dibutuhkan lagi:
- hapus dialog lama di task akhir

**Step 3: Verifikasi build**

Run:
```bash
npm run build
```

Expected:
- page edit dan dialog (jika masih dipakai) sama-sama compile
- logika submit tetap satu sumber

**Step 4: Commit**

```bash
git add src/components/transactions/TransactionEditForm.tsx src/components/EditTransactionDialog.tsx src/pages/TransactionEditPage.tsx
git commit -m "refactor: extract reusable transaction edit form"
```

---

### Task 5: Wiring aktivasi bertahap

**Objective:** Tentukan cara aman menyalakan kembali edit tanpa langsung membuka semua kasus.

**Files:**
- Modify: `src/components/TransactionTable.tsx`
- Modify: `src/pages/TransactionDetailPage.tsx`
- Optional modify: feature settings source if later gated

**Step 1: Ubah tombol edit ke navigasi route baru**

Saat fitur siap sebagian:
```tsx
navigate(`/transactions/${transaction.id}/edit`)
```

**Step 2: Aktifkan hanya untuk kasus aman**

Contoh kebijakan fase 1:
- belum ada delivery
- belum `Selesai`
- tidak ada kasus sinkronisasi office-sale yang rawan
- belum perlu mengubah item material bermasalah

**Step 3: Tambahkan guard UI**

Jika tidak allowed:
- disable tombol, atau
- sembunyikan tombol, atau
- tampilkan alasan yang jelas

**Recommended:** disable + tooltip alasan.

**Step 4: Verifikasi manual**

Cek minimal 3 skenario:
1. transaksi baru, belum ada delivery -> tombol edit aktif
2. transaksi yang sudah delivery -> tombol edit nonaktif
3. transaksi office sale/material rawan -> tetap ditahan jika rule belum aman

**Step 5: Commit**

```bash
git add src/components/TransactionTable.tsx src/pages/TransactionDetailPage.tsx
git commit -m "feat: wire transaction edit page behind business guard"
```

---

### Task 6: Sinkronkan dengan RPC/jurnal sebelum full enable

**Objective:** Jangan aktifkan edit penuh sebelum layer backend aman.

**Files:**
- Modify: `src/hooks/useTransactions.ts`
- Review: `database/rpc_by_function/02_transactions.sql`
- Review: `database/rpc_by_function/03_delivery.sql`

**Checklist sebelum full enable:**
- `update_transaction_atomic` benar-benar menangani perubahan `is_office_sale`
- jurnal material vs persediaan (`1320` vs `1310`) sudah diputuskan dan dibetulkan
- transaksi yang punya delivery/jurnal/payment adjustment tidak membuat data ganda atau orphan
- delivery journal `reference_type` sudah konsisten

**Verification commands:**
```bash
npm run build
```

Jika ada environment SQL test/manual migration flow, verifikasi juga update transaksi di data uji.

**Commit:**
```bash
git add src/hooks/useTransactions.ts database/rpc_by_function/02_transactions.sql database/rpc_by_function/03_delivery.sql
git commit -m "fix: harden transaction edit backend synchronization"
```

---

## Recommended Release Order

1. **Now:** rapikan sisa wiring edit lama + siapkan page shell terpisah.
2. **Next:** ekstrak form reusable.
3. **After that:** bereskan guard bisnis dan backend sync.
4. **Last:** baru aktifkan route edit ke user.

## Recommendation for Bos

Untuk kondisi project sekarang, langkah paling aman adalah:
- **jangan hidupkan edit dulu**,
- **pisahkan arsitekturnya dulu**,
- lalu **bereskan sinkronisasi RPC/jurnal/delivery**,
- baru setelah itu aktifkan per kasus aman.

Itu lebih rapi daripada tetap menaruh edit di `TransactionTable.tsx` atau dialog besar yang nyangkut di file transaksi utama.

## Verification Summary

Saat plan ini dieksekusi, minimal harus terbukti:
- tidak ada lagi dialog edit dormant di tabel transaksi,
- route ` /transactions/:id/edit ` tersedia,
- form edit bisa berdiri sendiri,
- aturan boleh-edit tersentralisasi,
- build `npm run build` sukses,
- fitur belum diaktifkan penuh sebelum backend aman.
