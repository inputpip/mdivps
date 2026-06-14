# Global App Feature Config Design for Aquvit / Matahari

> **Untuk Hermes:** gunakan dokumen ini sebagai dasar implementasi bertahap. Jangan mulai dari penghapusan massal fitur. Mulai dari inventory, config schema, gating, lalu workflow dan jurnal dinamis.

**Goal:** Membangun satu codebase dengan satu config fitur app global yang berlaku ke seluruh branch, sehingga fitur bisa dimunculkan/disembunyikan dengan penjelasan yang jelas dan perilaku jurnal bisa disesuaikan secara dinamis oleh user tanpa fork besar source code.

**Architecture:** Sistem dipisah menjadi 4 lapis global: fitur, visibilitas UI/route, workflow bisnis, dan mapping/policy jurnal. Aplikasi membaca satu konfigurasi app aktif saat startup untuk menentukan menu, page, field, status flow, validasi, dan kebijakan jurnal yang berlaku untuk semua branch. Dengan pola ini, tidak ada lagi logika berbeda per branch dan tidak ada kebutuhan business profile seperti printing/distribution/hybrid.

**Tech Stack:** PostgreSQL + PostgREST, React + TypeScript + Vite, TanStack Query, existing AuthContext/permission system, existing `company_settings`, SQL functions for journal rule resolution.

---

## 1. Ringkasan keputusan desain

Arah yang dipilih sekarang adalah:
- tetap **1 codebase**
- tetap **1 sumber proses inti**
- **1 config fitur app global** berlaku ke seluruh branch
- page, menu, workflow, dan jurnal harus membaca config global ini
- user harus bisa melihat **penjelasan** status fitur dari tab `Feature Settings`
- user harus bisa mengatur **policy jurnal** dari tab `Journal Settings` tanpa edit kode

Dengan kata lain, targetnya adalah:

> **config-driven global app behavior**

bukan:
- config-driven multi-branch behavior
- business profile printing/distribution/hybrid
- fork source code untuk tiap variasi proses

---

## 2. Fakta codebase saat ini yang relevan

### Yang sudah ada dan bisa dimanfaatkan
1. `company_settings` sudah ada, tapi masih terlalu sederhana (`key`, `value`)
   - File: `database/table_schemas/company_settings.sql`
2. role & permission system sudah ada
   - File: `src/hooks/usePermissions.ts`
   - File: `database/table_schemas/roles.sql`
   - File: `database/table_schemas/role_permissions.sql`
3. sidebar dan route bisa digate dari frontend
   - File: `src/components/layout/Sidebar.tsx`
   - File: `src/App.tsx`
4. banyak flow masih hardcoded ke page/service lama
5. jurnal akuntansi belum punya lapisan rule global yang bisa diatur user

### Problem saat ini
1. feature on/off belum punya source of truth global yang rapi.
2. sidebar dan route masih hardcoded.
3. alur bisnis seperti delivery/retasi/produksi/financial posting masih langsung tertanam di page/service, belum lewat resolver config.
4. jurnal akuntansi belum punya lapisan policy + mapping yang bisa berubah saat fitur dimatikan.
5. user belum punya halaman setting yang jelas untuk memahami dampak perubahan fitur.

---

## 3. Prinsip desain yang harus dijaga

1. **Satu source of truth utama adalah database config global.**
2. **Feature config tidak menggantikan role permission.**
   - Role = siapa yang boleh akses.
   - Global feature config = fitur apa yang hidup di seluruh app.
3. **Fitur nonaktif tidak cukup hanya disembunyikan dari menu.**
   - route lama tidak dipakai dalam navigasi normal dan harus diarahkan aman bila dibuka manual
   - workflow harus menyesuaikan
   - fallback jurnal harus jelas
4. **Setiap fitur dan rule penting harus punya penjelasan yang bisa dibaca user di halaman Settings.**
5. **Default harus aman.**
   - jika setting belum ada, gunakan default registry yang stabil
   - jangan sampai transaksi gagal hanya karena mapping belum diisi
6. **Perubahan harus incremental.**
   - jangan rewrite semua page dulu
   - mulai dari config + resolver + gating + journal policy
7. **Jurnal harus bisa diatur user, tapi tetap tervalidasi.**
   - tidak semua setting bebas liar
   - event, policy, dan mapping harus lewat registry resmi

---

## 4. Model konseptual yang diusulkan

Aplikasi dibagi menjadi 4 lapisan keputusan global:

### Lapis A — Global Feature Flags
Checklist fitur hidup/mati untuk seluruh app.

Contoh:
- delivery
- retasi
- production
- quotations
- commissions
- attendance
- payables
- receivables
- tax
- purchase_orders

### Lapis B — Global UI / Route Visibility
Menentukan page/menu/card/action yang ditampilkan.

Contoh:
- `menu.delivery = false`
- `route./driver-pos = false`
- `dashboard.widget.production_queue = true`

### Lapis C — Global Workflow Rules
Menentukan alur status, validasi, dan perilaku proses.

Contoh:
- jika `delivery = false`, transaksi selesai tanpa delivery note
- jika `production = true`, order wajib melewati tahapan produksi tertentu
- jika `quotations = true`, order bisa mewajibkan jalur quotation

### Lapis D — Global Journal Mapping Rules
Menentukan posting akun/jurnal berdasarkan event dan kondisi fitur.

Contoh:
- event `delivery_fee_posting`
- jika delivery aktif → posting normal
- jika delivery nonaktif → `skip`, `manual`, atau `reroute` sesuai policy setting user

---

## 5. Struktur database yang disarankan

### 5.1. `feature_catalog`
Master daftar fitur resmi sistem.

Kolom penting:
- `feature_key`
- `feature_name`
- `category`
- `description`
- `default_enabled`
- `default_explanation`
- `affects_ui`
- `affects_workflow`
- `affects_journal`

### 5.2. `app_feature_settings`
Status aktif/nonaktif fitur global beserta penjelasan dan catatan user.

Kolom penting:
- `feature_key`
- `is_enabled`
- `explanation`
- `notes`
- `config jsonb`
- `updated_by`
- `updated_at`

### 5.3. `ui_component_registry`
Daftar page/menu/widget/action/field yang bisa digate.

Kolom penting:
- `component_key`
- `component_type`
- `label`
- `route_path`
- `feature_key`
- `default_visible`
- `default_explanation`

### 5.4. `app_ui_settings`
Override visibility global per komponen UI.

Kolom penting:
- `component_key`
- `is_visible`
- `explanation`
- `notes`
- `config jsonb`
- `updated_by`
- `updated_at`

### 5.5. `journal_event_registry`
Master event jurnal yang boleh diatur.

Kolom penting:
- `event_key`
- `event_name`
- `domain`
- `reference_type`
- `feature_key`
- `default_policy`
- `default_explanation`

### 5.6. `app_journal_settings`
Policy event jurnal global yang bisa diubah user.

Kolom penting:
- `event_key`
- `is_enabled`
- `policy` (`required` / `optional` / `skip` / `reroute` / `manual`)
- `explanation`
- `fallback_account_role`
- `config jsonb`
- `updated_by`
- `updated_at`

### 5.7. `app_account_role_mappings`
Mapping role akun global untuk dipakai resolver jurnal.

Kolom penting:
- `account_role_key`
- `account_id`
- `notes`
- `updated_by`
- `updated_at`

---

## 6. Resolver yang harus ada

Aplikasi butuh satu resolved config service/hook yang menghasilkan bentuk seperti ini:

```ts
export interface ResolvedAppConfig {
  features: Record<string, {
    enabled: boolean;
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

Resolver ini dipakai untuk:
- sidebar
- route guard
- page section visibility
- workflow decision
- journal decision

---

## 7. Halaman setting yang harus disiapkan

### A. Feature Settings
User bisa:
- menyalakan / mematikan fitur
- membaca penjelasan dampak fitur
- menulis catatan alasan perubahan
- memakai setting awal bernama `Default`

### B. Visibilitas UI
User bisa:
- menyembunyikan / memunculkan komponen tertentu
- melihat keterkaitan komponen dengan fitur
- membaca warning bila komponen disembunyikan tapi fiturnya masih aktif

### C. Journal Settings
User bisa:
- memilih policy per event jurnal
- menyalakan / mematikan event tertentu jika diizinkan
- memilih mapping akun / fallback role akun
- melihat preview dampak posting

---

## 8. Urutan implementasi yang benar

1. inventory fitur, komponen UI, dan event jurnal
2. migration foundation untuk config global
3. `useAppConfig` / `useFeatureGate` / `useJournalConfig`
4. gating sidebar dan route
5. gating section bocor di halaman lama
6. settings UI untuk fitur global
7. settings UI untuk aturan jurnal
8. baru setelah itu sentuh workflow dan RPC/SQL lebih dalam

---

## 9. Anti-kebingungan yang wajib dijaga

Mulai sekarang, istilah yang dipakai harus konsisten:

### Pakai istilah ini
- global app feature config
- global UI gating
- global journal policy
- user-settable journal rules

### Hindari istilah ini
- branch-specific behavior
- mode printing
- mode distribusi
- business profile hybrid

Kalau file atau pembahasan lama masih menyebut branch/mode, anggap itu **arah lama yang sudah diganti**.

---

## 10. Kesimpulan tegas

Ke depan Aquvit/Matahari dibangun sebagai:
- **1 codebase**
- **1 config fitur app global**
- **1 sistem jurnal dinamis yang bisa diatur user**
- **1 perilaku dasar yang sama untuk seluruh branch**

Perbedaan antar branch tidak lagi menjadi pusat desain.
Pusat desain sekarang adalah **fitur app global dan aturan jurnal global yang bisa dijelaskan dan diatur dengan jelas**.
