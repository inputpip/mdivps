# Config Schema Phase 1 Draft for Aquvit / Matahari

> **Tujuan dokumen ini:** menyiapkan draft schema SQL awal untuk global app feature config yang fokus pada feature gating UI dan journal event resolver, tanpa langsung mengubah seluruh RPC lama.

**Sumber verifikasi utama:**
- `database/table_schemas/company_settings.sql`
- `database/table_schemas/accounts.sql`
- `docs/plans/2026-06-13-config-driven-multi-branch-design.md`
- `docs/plans/config-ui-registry.md`
- `docs/plans/config-journal-event-inventory.md`

---

## 1. Prinsip phase 1

Phase 1 sengaja dibuat kecil dan aman.

Targetnya **bukan** langsung rewrite semua flow bisnis.
Targetnya adalah menambah tabel registry dan settings agar app sudah punya:

- master daftar fitur global
- master daftar komponen UI yang bisa digate
- master daftar event jurnal yang bisa dikontrol
- setting global yang bisa dijelaskan ke user
- mapping role akun global untuk resolver jurnal

Dengan cara ini, kita bisa mematikan/menyalakan fitur di seluruh app tanpa membingungkan user dengan perbedaan per branch.

---

## 2. Draft tabel yang dibuat

Phase 1 draft ini mencakup:

1. `feature_catalog`
2. `app_feature_settings`
3. `ui_component_registry`
4. `app_ui_settings`
5. `journal_event_registry`
6. `app_journal_settings`
7. `app_account_role_mappings`

---

## 3. Draft SQL

```sql
create extension if not exists pgcrypto;

-- =====================================================
-- 1) FEATURE CATALOG
-- =====================================================
create table if not exists public.feature_catalog (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null unique,
  feature_name text not null,
  category text not null,
  description text,
  default_enabled boolean not null default true,
  default_explanation text,
  affects_ui boolean not null default true,
  affects_workflow boolean not null default false,
  affects_journal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_catalog_category_check check (
    category in (
      'sales',
      'delivery',
      'production',
      'inventory',
      'purchasing',
      'finance',
      'hr',
      'reporting',
      'settings',
      'other'
    )
  )
);

create index if not exists idx_feature_catalog_category
  on public.feature_catalog(category);

-- =====================================================
-- 2) APP FEATURE SETTINGS
-- =====================================================
create table if not exists public.app_feature_settings (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null references public.feature_catalog(feature_key) on delete cascade,
  is_enabled boolean not null,
  explanation text,
  notes text,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid null references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint app_feature_settings_unique unique (feature_key)
);

create index if not exists idx_app_feature_settings_feature
  on public.app_feature_settings(feature_key);

create index if not exists idx_app_feature_settings_config_gin
  on public.app_feature_settings using gin(config);

-- =====================================================
-- 3) UI COMPONENT REGISTRY
-- =====================================================
create table if not exists public.ui_component_registry (
  id uuid primary key default gen_random_uuid(),
  component_key text not null unique,
  component_type text not null,
  label text not null,
  route_path text null,
  parent_component_key text null,
  feature_key text null references public.feature_catalog(feature_key) on delete set null,
  default_visible boolean not null default true,
  default_explanation text,
  visibility_strategy text not null default 'feature_driven',
  source_file text,
  source_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ui_component_registry_type_check check (
    component_type in ('menu', 'route', 'widget', 'action', 'section', 'field')
  ),
  constraint ui_component_registry_visibility_strategy_check check (
    visibility_strategy in ('feature_driven', 'explicit_override', 'always_visible')
  )
);

create index if not exists idx_ui_component_registry_type
  on public.ui_component_registry(component_type);

create index if not exists idx_ui_component_registry_feature
  on public.ui_component_registry(feature_key);

-- =====================================================
-- 4) APP UI SETTINGS
-- =====================================================
create table if not exists public.app_ui_settings (
  id uuid primary key default gen_random_uuid(),
  component_key text not null references public.ui_component_registry(component_key) on delete cascade,
  is_visible boolean not null,
  explanation text,
  notes text,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid null references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint app_ui_settings_unique unique (component_key)
);

create index if not exists idx_app_ui_settings_component
  on public.app_ui_settings(component_key);

create index if not exists idx_app_ui_settings_config_gin
  on public.app_ui_settings using gin(config);

-- =====================================================
-- 5) JOURNAL EVENT REGISTRY
-- =====================================================
create table if not exists public.journal_event_registry (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_name text not null,
  domain text not null,
  reference_type text null,
  feature_key text null references public.feature_catalog(feature_key) on delete set null,
  default_policy text not null default 'required',
  default_explanation text,
  description text,
  source_file text,
  source_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_event_registry_domain_check check (
    domain in (
      'sales',
      'delivery',
      'production',
      'inventory',
      'purchasing',
      'finance',
      'hr',
      'asset',
      'tax',
      'other'
    )
  ),
  constraint journal_event_registry_policy_check check (
    default_policy in ('required', 'optional', 'skip', 'reroute', 'manual')
  )
);

create index if not exists idx_journal_event_registry_domain
  on public.journal_event_registry(domain);

create index if not exists idx_journal_event_registry_reference_type
  on public.journal_event_registry(reference_type);

-- =====================================================
-- 6) APP JOURNAL SETTINGS
-- =====================================================
create table if not exists public.app_journal_settings (
  id uuid primary key default gen_random_uuid(),
  event_key text not null references public.journal_event_registry(event_key) on delete cascade,
  is_enabled boolean not null default true,
  policy text not null default 'required',
  explanation text,
  fallback_account_role text null,
  config jsonb not null default '{}'::jsonb,
  notes text,
  updated_by uuid null references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint app_journal_settings_policy_check check (
    policy in ('required', 'optional', 'skip', 'reroute', 'manual')
  ),
  constraint app_journal_settings_unique unique (event_key)
);

create index if not exists idx_app_journal_settings_event
  on public.app_journal_settings(event_key);

create index if not exists idx_app_journal_settings_policy
  on public.app_journal_settings(policy);

create index if not exists idx_app_journal_settings_config_gin
  on public.app_journal_settings using gin(config);

-- =====================================================
-- 7) APP ACCOUNT ROLE MAPPINGS
-- =====================================================
create table if not exists public.app_account_role_mappings (
  id uuid primary key default gen_random_uuid(),
  account_role_key text not null unique,
  account_id uuid not null references public.accounts(id) on delete restrict,
  notes text,
  updated_by uuid null references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_account_role_mappings_account
  on public.app_account_role_mappings(account_id);
```

---

## 4. Kenapa schema ini dipilih

### `feature_catalog`
Supaya daftar fitur resmi tidak liar dan bisa dipakai lintas frontend/backend.

### `app_feature_settings`
Supaya user bisa menyalakan/mematikan fitur global dan memberi penjelasan perubahan.

### `ui_component_registry`
Supaya menu, route, section, widget, action, dan field yang bisa digate punya daftar resmi.

### `app_ui_settings`
Supaya visibilitas UI bisa diubah global tanpa edit kode dan tanpa memaksa semua komponen otomatis ikut feature toggle secara buta.

### `journal_event_registry`
Supaya event jurnal yang boleh diatur user punya daftar resmi dan bisa dijelaskan.

### `app_journal_settings`
Supaya policy event jurnal bisa dinamis:
- `required`
- `optional`
- `skip`
- `reroute`
- `manual`

### `app_account_role_mappings`
Supaya resolver jurnal tidak bergantung ke hardcode account id.

---

## 5. Seed minimum yang disarankan

### Fitur minimum
- `delivery`
- `retasi`
- `production`
- `purchase_orders`

### UI minimum
- `menu.delivery`
- `menu.retasi`
- `route.delivery`
- `route.retasi`
- `section.transaction.delivery_management`

### Event jurnal minimum
- `transaction_sale_cash`
- `transaction_sale_receivable`
- `receivable_payment_complete`
- `delivery_fee_posting`

### Setting global awal contoh
- `delivery = false`
- `retasi = false`
- `menu.delivery = false`
- `route.delivery = false`
- `section.transaction.delivery_management = false`
- `delivery_fee_posting.policy = skip`
- setting awal disajikan ke user sebagai preset `Default`

---

## 6. Catatan desain penting

1. Phase 1 ini **global**, bukan per-branch.
2. Penjelasan (`explanation`) harus tersedia di feature, UI, dan journal settings.
3. Jurnal yang dinamis **bukan** berarti bebas tanpa guard; tetap harus lewat registry dan policy yang tervalidasi.
4. Kalau nanti ada kebutuhan lebih kompleks, tambah di `config jsonb`, jangan langsung bongkar struktur inti.
5. Jangan kembali ke istilah profile printing/distribution/hybrid di schema ini.

---

## 7. Ringkasan tegas

Schema phase 1 ini disusun untuk fondasi:
- **global app feature config**
- **global UI visibility config**
- **global journal policy config**
- **settings tab yang bisa dijelaskan dan diatur user**
- **preset awal `Default` untuk konfigurasi app**

Jadi user tidak lagi bingung apakah perubahan berlaku per branch atau per mode bisnis. Di desain ini, perubahan berlaku **untuk seluruh app**.
