# Global App Config Vertical Slice Phase 1 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Membangun vertical slice pertama untuk satu config fitur app global yang berlaku ke seluruh branch: fitur bisa dimunculkan/disembunyikan lewat tab `Feature Settings`, section ikut aman, dan perilaku jurnal mulai bisa diatur dinamis oleh user.

**Architecture:** Kita tidak lagi memakai pola per-branch atau per-business-mode. Phase 1 fokus ke fondasi global: registry fitur, setting fitur app, registry komponen UI, setting UI app, registry event jurnal, dan setting jurnal app. Frontend membaca resolved app config tunggal, lalu menerapkan gating di sidebar, route, dan section yang masih bocor. Route fitur nonaktif tidak perlu menampilkan halaman alasan khusus; route cukup diarahkan aman ke halaman yang valid, sementara alasan dan status fitur dilihat user di tab `Feature Settings`. Jurnal belum dirombak total, tetapi jalur rule-nya sudah disiapkan agar user bisa mengatur event mana yang wajib, boleh skip, reroute, atau manual.

**Tech Stack:** PostgreSQL + Supabase/PostgREST, React + TypeScript + Vite, TanStack Query, existing `company_settings`, `Sidebar.tsx`, `App.tsx`, `TransactionDetailPage.tsx`.

---

## 1. Yang harus mulai kita ubah dulu

Urutan perubahan awal yang paling aman:

1. **Database config foundation global**
   - buat tabel registry dan settings minimum untuk level app
2. **Frontend resolved-app-config hook**
   - app harus bisa baca satu config global aktif
3. **Sidebar gating**
   - menu fitur nonaktif hilang
4. **Route handling**
   - route fitur nonaktif tidak dipakai user secara normal dan bila diakses manual diarahkan aman ke halaman valid
5. **Page section gating**
   - section bocor seperti `DeliveryManagement` ikut hilang
6. **Journal settings foundation**
   - event jurnal bisa diberi policy dan mapping dasar oleh user
7. **Settings UI**
   - user bisa mengubah fitur global dan perilaku jurnal dari halaman pengaturan, terutama tab `Feature Settings`

### Kenapa urutannya begitu?
Karena bug paling berbahaya sekarang bukan tampilan menu, tapi **kebocoran behavior**:
- menu bisa disembunyikan tapi route lama masih bisa dibuka manual
- route bisa diarahkan ulang tapi section di halaman lain tetap memanggil flow lama
- fitur bisa dimatikan tapi jurnal masih posting seperti fitur itu tetap aktif

Jadi slice awal harus menutup 4 lapisan dulu:
- feature toggle
- menu/route handling
- embedded section
- journal event policy

---

## 2. File yang paling perlu mulai diubah

### Database / docs
- Create: `database/migrations/<timestamp>_global_app_config_phase1.sql`
- Modify/seed reference from:
  - `database/table_schemas/company_settings.sql`
  - `database/table_schemas/accounts.sql`
- Reference docs:
  - `docs/plans/config-ui-registry.md`
  - `docs/plans/config-journal-event-inventory.md`
  - `docs/plans/config-schema-phase1-draft.md`

### Frontend foundation
- Create: `src/types/appConfig.ts`
- Create: `src/hooks/useAppConfig.ts`
- Create: `src/hooks/useFeatureGate.ts`
- Create: `src/hooks/useJournalConfig.ts`
- Create: `src/components/guards/FeatureRouteHandler.tsx`

### Frontend vertical slice targets
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/TransactionDetailPage.tsx`
- Modify: `src/pages/SettingsPage.tsx`

---

## 3. Scope phase 1 yang sengaja dibatasi

### Feature yang disentuh dulu
- `delivery`
- `retasi`
- `production`
- `purchase_orders`

### UI component yang disentuh dulu
- `menu.delivery`
- `menu.retasi`
- `route.delivery`
- `route.retasi`
- `section.transaction.delivery_management`

### Journal event yang disentuh dulu
- event penjualan inti yang sekarang selalu aktif
- event delivery-related yang harus bisa di-skip / di-disable
- event pelunasan piutang yang tetap wajib

### Yang **belum** disentuh di phase ini
- resolver semua workflow detail
- semua action/button/field lain
- redesign total semua page
- seluruh engine jurnal final
- semua menu lain

Ini penting supaya implementasi awal tetap kecil dan bisa diverifikasi cepat.

---

## 4. Bentuk resolved config yang perlu kita pakai di frontend

Frontend butuh satu bentuk hasil akhir sederhana seperti ini:

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

Contoh resolved value awal:

```ts
{
  features: {
    delivery: {
      enabled: false,
      label: 'Pengantaran',
      explanation: 'Fitur pengantaran dimatikan di seluruh app karena alur saat ini difokuskan ke order dan produksi.'
    },
    retasi: {
      enabled: false,
      label: 'Retasi',
      explanation: 'Retasi belum dipakai pada flow aktif aplikasi.'
    },
    production: {
      enabled: true,
      label: 'Produksi',
      explanation: 'Produksi tetap aktif sebagai fitur inti.'
    }
  },
  components: {
    'menu.delivery': {
      visible: false,
      explanation: 'Disembunyikan karena feature delivery nonaktif.'
    },
    'route.delivery': {
      visible: false,
      explanation: 'Route lama tidak dipakai dalam navigasi normal dan akan diarahkan aman bila dibuka manual.'
    },
    'section.transaction.delivery_management': {
      visible: false,
      explanation: 'Section di-hide agar detail transaksi tidak memanggil flow pengantaran.'
    }
  },
  journal: {
    delivery_fee_posting: {
      enabled: false,
      policy: 'skip',
      explanation: 'Posting biaya delivery dilewati karena fitur delivery nonaktif.'
    },
    receivable_payment_complete: {
      enabled: true,
      policy: 'required',
      explanation: 'Pelunasan piutang tetap wajib diposting.'
    }
  }
}
```

### Prinsip resolver frontend
1. load global feature settings
2. load global UI settings
3. load global journal settings
4. merge dengan registry default
5. expose helper:
   - `isFeatureEnabled(featureKey)`
   - `isComponentVisible(componentKey)`
   - `getJournalPolicy(eventKey)`

---

## 5. Task-by-task plan

### Task 1: Buat migration foundation minimum global

**Objective:** Menambahkan tabel minimum agar app punya feature setting, UI setting, dan journal setting global.

**Files:**
- Create: `database/migrations/<timestamp>_global_app_config_phase1.sql`
- Reference: `docs/plans/config-schema-phase1-draft.md`

**Step 1: Tulis migration minimum**

Isi minimum migration:
- `feature_catalog`
- `app_feature_settings`
- `ui_component_registry`
- `app_ui_settings`
- `journal_event_registry`
- `app_journal_settings`
- `app_account_role_mappings`

**Step 2: Seed registry minimum**

Masukkan seed minimal:
- features:
  - `delivery`
  - `retasi`
  - `production`
  - `purchase_orders`
- UI components:
  - `menu.delivery`
  - `menu.retasi`
  - `route.delivery`
  - `route.retasi`
  - `section.transaction.delivery_management`
- journal events:
  - `delivery_fee_posting`
  - `transaction_sale_cash`
  - `transaction_sale_receivable`
  - `receivable_payment_complete`

**Step 3: Seed setting global awal**

Minimal:
- `delivery = false`
- `retasi = false`
- hide section delivery management
- `delivery_fee_posting.policy = skip`

**Step 4: Verifikasi SQL review**

Run review command:
```bash
cd "/mnt/d/App Aquvit/matahari"
python3 - <<'PY'
from pathlib import Path
p = Path('database/migrations')
print('\n'.join(sorted(x.name for x in p.glob('*.sql'))[-5:]))
PY
```
Expected: migration baru terlihat di daftar.

---

### Task 2: Tambah type config global di frontend

**Objective:** Menyiapkan type yang jelas supaya config app tidak lagi tersebar liar.

**Files:**
- Create: `src/types/appConfig.ts`

**Step 1: Buat type baru**

Minimal memuat:
- `AppFeatureSetting`
- `AppUiSetting`
- `AppJournalSetting`
- `ResolvedAppConfig`

**Step 2: Tambahkan field explanation**

Setiap fitur / komponen / event jurnal harus bisa punya:
- `label`
- `explanation`
- `notes`

**Step 3: Verifikasi typecheck saat build**

Run:
```bash
cd "/mnt/d/App Aquvit/matahari"
npm run build
```
Expected: build tetap lolos atau hanya gagal pada bagian implementasi yang memang belum dikerjakan.

---

### Task 3: Buat hook `useAppConfig`

**Objective:** App bisa membaca satu resolved config global.

**Files:**
- Create: `src/hooks/useAppConfig.ts`
- Create: `src/hooks/useFeatureGate.ts`
- Create: `src/hooks/useJournalConfig.ts`

**Step 1:** load setting global dari Supabase

**Step 2:** merge setting dengan registry default

**Step 3:** expose helper:
- `isFeatureEnabled`
- `isComponentVisible`
- `getFeatureExplanation`
- `getJournalPolicy`

**Step 4:** verifikasi dengan `npm run build`

---

### Task 4: Rapikan sidebar dan route handling

**Objective:** Menu fitur nonaktif hilang, dan route lama diarahkan aman tanpa membingungkan user.

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`
- Create: `src/components/guards/FeatureRouteHandler.tsx`

**Step 1:** sembunyikan menu berdasarkan `useFeatureGate`

**Step 2:** arahkan route delivery/retasi ke halaman valid bila diakses manual

**Step 3:** jangan tampilkan halaman alasan khusus; alasan fitur hidup/mati dilihat user di tab `Feature Settings`

**Step 4:** verifikasi `npm run build`

---

### Task 5: Gate section bocor di detail transaksi

**Objective:** `DeliveryManagement` tidak lagi muncul saat delivery nonaktif.

**Files:**
- Modify: `src/pages/TransactionDetailPage.tsx`

**Step 1:** bungkus render `DeliveryManagement` dengan `isComponentVisible('section.transaction.delivery_management')`

**Step 2:** pastikan side-effect delivery-related tidak auto-run saat feature nonaktif

**Step 3:** verifikasi `npm run build`

---

### Task 6: Tambah settings UI untuk fitur dan jurnal

**Objective:** User bisa mengubah fitur global dan perilaku jurnal tanpa edit database manual.

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

**Step 1:** tambah tab `Feature Settings`
- list fitur
- toggle aktif/nonaktif
- kolom explanation / notes
- preset/setting awal bernama `Default`

**Step 2:** tambah tab `Journal Settings`
- list event jurnal
- toggle aktif/nonaktif
- policy selector: `required`, `optional`, `skip`, `reroute`, `manual`
- mapping akun dasar
- explanation / notes

**Step 3:** tampilkan warning bila user mematikan fitur yang memengaruhi jurnal

**Step 4:** verifikasi `npm run build`

---

## 6. Acceptance criteria phase 1

Phase 1 dianggap selesai kalau:

1. App punya satu config global yang terbaca di frontend.
2. `delivery` dan `retasi` bisa dimatikan dari setting global.
3. Saat `delivery` dimatikan:
   - menu delivery hilang
   - route delivery tidak muncul di navigasi normal dan diarahkan aman bila diakses manual
   - section delivery management di detail transaksi hilang
4. User bisa melihat penjelasan status fitur di tab `Feature Settings`.
5. Tab `Feature Settings` punya setting awal bernama `Default`.
6. Event jurnal terkait delivery bisa di-set ke `skip` atau `manual`.
7. Event jurnal inti seperti pelunasan piutang tetap bisa ditandai `required`.
8. `npm run build` lolos.

---

## 7. Keputusan desain yang harus dijaga

- Jangan kembali ke desain per-branch.
- Jangan pakai business profile seperti printing/distribution/hybrid.
- Jangan hanya sembunyikan menu; route dan section juga harus ikut aman.
- Jangan biarkan jurnal tetap hardcoded saat fitur dimatikan.
- Semua setting harus punya penjelasan yang bisa dibaca user agar tidak membingungkan.

---

## 8. Ringkasan tegas

Mulai sekarang, fondasi yang dibangun adalah:
- **global app feature config**
- **global UI gating**
- **global journal policy**
- **settings yang bisa diubah user**

Bukan:
- branch config
- mode bisnis per branch
- fork codebase berdasarkan kategori bisnis
