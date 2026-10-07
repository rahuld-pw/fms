-- =============================================================================
-- Facility Management: locations, issues (tracked + anonymous), SLA &
-- escalation, assets (QR, lifecycle, transfers, depreciation, verification),
-- vendors (onboarding, documents, agreements, ratings, portal), preventive
-- maintenance, work orders, AMC contracts and the statutory compliance calendar.
-- =============================================================================

-- System updates (made by triggers on behalf of the platform) bypass the
-- field-level guards that apply to end users. The flag is transaction-local.
create or replace function app.begin_system_update() returns void language sql as $$
  select set_config('app.system_update', coalesce(nullif(current_setting('app.system_update', true), ''), '0')::int + 1 || '', true);
$$;
create or replace function app.end_system_update() returns void language sql as $$
  select set_config('app.system_update', greatest(coalesce(nullif(current_setting('app.system_update', true), ''), '0')::int - 1, 0) || '', true);
$$;
create or replace function app.in_system_update() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('app.system_update', true), ''), '0')::int > 0
$$;

create or replace function app.random_token(p_bytes int default 9) returns text
language sql volatile as $$
  select translate(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/=', '-_')
$$;

create or replace function app.sha256(p_text text) returns text
language sql immutable as $$
  select encode(extensions.digest(p_text, 'sha256'), 'hex')
$$;

-- -----------------------------------------------------------------------------
-- Locations: campus > building > floor > room (or area)
-- -----------------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  parent_id uuid references public.locations(id) on delete restrict,
  type text not null check (type in ('building', 'floor', 'room', 'area')),
  name text not null,
  code text,
  description text,
  capacity int,
  qr_token text not null unique default app.random_token(),
  path_names text[] not null default '{}',        -- denormalised breadcrumb
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.locations (org_id, campus_id, parent_id) where deleted_at is null;
create index on public.locations using gin (name extensions.gin_trgm_ops);

create or replace function app.locations_before_write() returns trigger
language plpgsql as $$
declare
  p public.locations;
begin
  if new.parent_id is not null then
    select * into p from public.locations where id = new.parent_id;
    if p.org_id <> new.org_id or p.campus_id <> new.campus_id then
      raise exception 'parent location must be in the same campus' using errcode = '23514';
    end if;
    if (p.type, new.type) not in (('building', 'floor'), ('building', 'area'), ('floor', 'room'),
                                  ('floor', 'area'), ('area', 'room'), ('area', 'area'), ('building', 'room')) then
      raise exception 'a % cannot be placed inside a %', new.type, p.type using errcode = '23514';
    end if;
    new.path_names := p.path_names || p.name;
  else
    if new.type not in ('building', 'area') then
      raise exception 'top-level locations must be buildings or areas' using errcode = '23514';
    end if;
    new.path_names := '{}';
  end if;
  return new;
end $$;
create trigger locations_before_write before insert or update of parent_id, name on public.locations
  for each row execute function app.locations_before_write();

-- -----------------------------------------------------------------------------
-- Service categories (shared by vendors / issue categories)
-- -----------------------------------------------------------------------------
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index on public.service_categories (org_id, lower(name));

-- -----------------------------------------------------------------------------
-- Vendors
-- -----------------------------------------------------------------------------
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  vendor_code text,
  name text not null,
  legal_name text,
  status text not null default 'draft' check (status in (
    'invited', 'draft', 'submitted', 'under_verification', 'pending_approval', 'approved', 'rejected',
    'blacklisted', 'inactive')),
  vendor_type text not null default 'service' check (vendor_type in ('service', 'supplier', 'both')),
  contact_name text,
  email text,
  phone text,
  website text,
  address text,
  city text,
  state text,
  pincode text,
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  msme_number text,
  bank_account_name text,
  bank_account_number text,
  bank_ifsc text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name text,
  payment_terms_days int default 30,
  service_category_ids uuid[] not null default '{}',
  rating_avg numeric(3, 2),
  rating_count int not null default 0,
  blacklisted_at timestamptz,
  blacklist_reason text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  approval_request_id uuid references public.approval_requests(id),
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index on public.vendors (org_id, vendor_code) where vendor_code is not null;
create index on public.vendors (org_id, status) where deleted_at is null;
create index on public.vendors using gin (name extensions.gin_trgm_ops);
create index on public.vendors using gin (service_category_ids);

create table public.vendor_portal_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  email text not null,
  purpose text not null check (purpose in ('onboarding', 'portal')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.vendor_portal_tokens (vendor_id);

create table public.vendor_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  doc_type text not null check (doc_type in ('gst_certificate', 'pan_card', 'cancelled_cheque', 'msme_certificate',
    'incorporation', 'insurance', 'license', 'agreement', 'other')),
  title text,
  doc_number text,
  attachment_id uuid references public.attachments(id) on delete set null,
  issued_on date,
  expires_on date,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.vendor_documents (vendor_id);
create index on public.vendor_documents (org_id, expires_on) where expires_on is not null;

create table public.vendor_agreements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  title text not null,
  agreement_type text not null default 'service' check (agreement_type in ('service', 'supply', 'nda', 'rate_contract', 'other')),
  start_date date not null,
  end_date date,
  value numeric(14, 2),
  auto_renew boolean not null default false,
  renewal_reminder_days int not null default 30,
  status text not null default 'active' check (status in ('draft', 'active', 'expired', 'terminated', 'renewed')),
  attachment_id uuid references public.attachments(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index on public.vendor_agreements (org_id, end_date) where status = 'active';

create table public.vendor_ratings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  source_type text not null default 'manual' check (source_type in ('manual', 'purchase_order', 'work_order', 'issue')),
  source_id uuid,
  rating smallint not null check (rating between 1 and 5),
  quality smallint check (quality between 1 and 5),
  timeliness smallint check (timeliness between 1 and 5),
  communication smallint check (communication between 1 and 5),
  comment text,
  rated_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index on public.vendor_ratings (vendor_id, source_type, source_id, rated_by) where source_id is not null;

create or replace function app.vendor_rating_rollup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_vendor uuid := coalesce(new.vendor_id, old.vendor_id);
begin
  update public.vendors v set
    rating_avg = (select round(avg(rating)::numeric, 2) from public.vendor_ratings where vendor_id = v_vendor),
    rating_count = (select count(*) from public.vendor_ratings where vendor_id = v_vendor)
  where v.id = v_vendor;
  return null;
end $$;
create trigger vendor_rating_rollup after insert or update or delete on public.vendor_ratings
  for each row execute function app.vendor_rating_rollup();

-- -----------------------------------------------------------------------------
-- Issue categories & SLA policies
-- -----------------------------------------------------------------------------
create table public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  priority text not null check (priority in ('low', 'medium', 'high', 'critical')),
  response_minutes int not null check (response_minutes > 0),
  resolution_minutes int not null check (resolution_minutes > 0),
  unique (org_id, priority)
);

create table public.issue_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  parent_id uuid references public.issue_categories(id) on delete set null,
  name text not null,
  description text,
  icon text,
  default_priority text not null default 'medium' check (default_priority in ('low', 'medium', 'high', 'critical')),
  response_minutes int,                 -- overrides SLA policy when set
  resolution_minutes int,
  default_assignee_id uuid references public.profiles(id) on delete set null,
  default_vendor_id uuid references public.vendors(id) on delete set null,
  service_category_id uuid references public.service_categories(id) on delete set null,
  auto_create text not null default 'none' check (auto_create in ('none', 'task', 'work_order')),
  public_visible boolean not null default true,  -- offered on the anonymous QR form
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on public.issue_categories (org_id, lower(name));

-- -----------------------------------------------------------------------------
-- Asset categories, assets
-- -----------------------------------------------------------------------------
create table public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  parent_id uuid references public.asset_categories(id) on delete set null,
  name text not null,
  code text not null check (code ~ '^[A-Z0-9]{1,8}$'),
  depreciation_method text not null default 'slm' check (depreciation_method in ('none', 'slm', 'wdv')),
  useful_life_months int check (useful_life_months > 0),
  wdv_rate_percent numeric(5, 2) check (wdv_rate_percent between 0 and 100),
  salvage_percent numeric(5, 2) not null default 5 check (salvage_percent between 0 and 100),
  verification_frequency_months int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);

create table public.amc_contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  title text not null,
  contract_number text,
  contract_type text not null default 'comprehensive' check (contract_type in ('comprehensive', 'non_comprehensive', 'labour_only')),
  coverage text,
  start_date date not null,
  end_date date not null,
  value numeric(14, 2),
  visits_included int not null default 0,
  visit_frequency text check (visit_frequency in ('monthly', 'quarterly', 'half_yearly', 'yearly', 'on_call')),
  renewal_reminder_days int not null default 45,
  status text not null default 'active' check (status in ('draft', 'active', 'expired', 'renewed', 'terminated')),
  renewed_from_id uuid references public.amc_contracts(id),
  po_id uuid,
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (end_date >= start_date)
);
create index on public.amc_contracts (org_id, end_date) where deleted_at is null;

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  location_id uuid references public.locations(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  category_id uuid references public.asset_categories(id) on delete set null,
  asset_tag text not null,
  qr_token text not null unique default app.random_token(),
  name text not null,
  description text,
  make text,
  model text,
  serial_number text,
  status text not null default 'in_stock' check (status in ('in_stock', 'in_use', 'under_repair', 'disposed', 'lost')),
  condition text check (condition in ('new', 'good', 'fair', 'poor', 'damaged')),
  custodian_id uuid references public.profiles(id) on delete set null,
  purchase_date date,
  purchase_cost numeric(14, 2) check (purchase_cost >= 0),
  vendor_id uuid references public.vendors(id) on delete set null,
  po_id uuid,
  grn_id uuid,
  invoice_number text,
  warranty_until date,
  amc_contract_id uuid references public.amc_contracts(id) on delete set null,
  depreciation_method text check (depreciation_method in ('none', 'slm', 'wdv')),
  useful_life_months int,
  salvage_value numeric(14, 2),
  usage_meter numeric(14, 2) not null default 0,     -- e.g. running hours, km, prints
  usage_unit text,
  last_verified_at timestamptz,
  disposed_at date,
  disposal_method text check (disposal_method in ('sold', 'scrapped', 'donated', 'written_off', 'returned')),
  disposal_value numeric(14, 2),
  disposal_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, asset_tag)
);
create index on public.assets (org_id, campus_id, status) where deleted_at is null;
create index on public.assets (org_id, category_id) where deleted_at is null;
create index on public.assets (location_id);
create index on public.assets (custodian_id);
create index on public.assets (org_id, warranty_until) where warranty_until is not null and deleted_at is null;
create index on public.assets using gin (name extensions.gin_trgm_ops);

create table public.amc_contract_assets (
  amc_contract_id uuid not null references public.amc_contracts(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  primary key (amc_contract_id, asset_id)
);

create or replace function app.assets_before_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  c public.asset_categories;
  v_seq text;
begin
  if new.asset_tag is null or new.asset_tag = '' then
    select * into c from public.asset_categories where id = new.category_id;
    v_seq := app.next_number(new.org_id, 'asset', new.campus_id, coalesce(new.purchase_date, current_date));
    new.asset_tag := case when c.code is not null then c.code || '-' else '' end || v_seq;
  end if;
  if new.depreciation_method is null and new.category_id is not null then
    select * into c from public.asset_categories where id = new.category_id;
    new.depreciation_method := c.depreciation_method;
    new.useful_life_months := coalesce(new.useful_life_months, c.useful_life_months);
    if new.salvage_value is null and new.purchase_cost is not null then
      new.salvage_value := round(new.purchase_cost * c.salvage_percent / 100, 2);
    end if;
  end if;
  return new;
end $$;
create trigger assets_before_insert before insert on public.assets
  for each row execute function app.assets_before_insert();

-- Book value as of a date. SLM: linear over useful life down to salvage.
-- WDV: annual rate from the category, applied monthly-compounded.
create or replace function public.asset_book_value(p_asset_id uuid, p_as_of date default current_date)
returns numeric
language plpgsql stable security invoker as $$
declare
  a public.assets;
  c public.asset_categories;
  v_months numeric;
  v_value numeric;
begin
  select * into a from public.assets where id = p_asset_id;
  if not found or a.purchase_cost is null or a.purchase_date is null then return null; end if;
  if a.status = 'disposed' and a.disposed_at is not null and a.disposed_at <= p_as_of then return 0; end if;
  v_months := greatest(0, (extract(year from age(p_as_of, a.purchase_date)) * 12
                          + extract(month from age(p_as_of, a.purchase_date)))::numeric);
  if coalesce(a.depreciation_method, 'none') = 'none' then
    return a.purchase_cost;
  elsif a.depreciation_method = 'slm' then
    if coalesce(a.useful_life_months, 0) = 0 then return a.purchase_cost; end if;
    v_value := a.purchase_cost - (a.purchase_cost - coalesce(a.salvage_value, 0)) * least(v_months / a.useful_life_months, 1);
  else
    select * into c from public.asset_categories where id = a.category_id;
    v_value := a.purchase_cost * power(1 - coalesce(c.wdv_rate_percent, 15) / 100.0, v_months / 12.0);
    v_value := greatest(v_value, coalesce(a.salvage_value, 0));
  end if;
  return round(v_value, 2);
end $$;

create table public.asset_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  from_campus_id uuid not null references public.campuses(id),
  to_campus_id uuid not null references public.campuses(id),
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  from_custodian_id uuid references public.profiles(id),
  to_custodian_id uuid references public.profiles(id),
  from_department_id uuid references public.departments(id),
  to_department_id uuid references public.departments(id),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'rejected', 'cancelled')),
  requested_by uuid references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.asset_transfers (asset_id, created_at desc);

-- Completing a transfer moves the asset.
create or replace function app.asset_transfer_apply() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.status = 'completed' and old.status = 'pending' then
    update public.assets set
      campus_id = new.to_campus_id,
      location_id = new.to_location_id,
      custodian_id = coalesce(new.to_custodian_id, custodian_id),
      department_id = coalesce(new.to_department_id, department_id),
      status = case when new.to_custodian_id is not null and status = 'in_stock' then 'in_use' else status end
    where id = new.asset_id;
    new.decided_at := now();
    new.decided_by := coalesce(new.decided_by, app.actor_id());
  elsif new.status in ('rejected', 'cancelled') and old.status = 'pending' then
    new.decided_at := now();
    new.decided_by := coalesce(new.decided_by, app.actor_id());
  elsif new.status <> old.status then
    raise exception 'transfer is already %', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger asset_transfer_apply before update of status on public.asset_transfers
  for each row execute function app.asset_transfer_apply();

create table public.asset_verification_audits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  location_id uuid references public.locations(id),
  category_id uuid references public.asset_categories(id),
  name text not null,
  scheduled_for date not null default current_date,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.asset_verification_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  audit_id uuid not null references public.asset_verification_audits(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  result text not null default 'pending' check (result in ('pending', 'found', 'missing', 'damaged', 'relocated')),
  found_location_id uuid references public.locations(id),
  condition text,
  notes text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  unique (audit_id, asset_id)
);

-- Populate an audit with the assets in its scope.
create or replace function public.asset_audit_populate(p_audit_id uuid) returns int
language plpgsql security invoker as $$
declare
  a public.asset_verification_audits;
  n int;
begin
  select * into a from public.asset_verification_audits where id = p_audit_id;
  if not found then raise exception 'audit not found' using errcode = 'P0002'; end if;
  insert into public.asset_verification_items (org_id, audit_id, asset_id)
  select a.org_id, a.id, s.id from public.assets s
  where s.org_id = a.org_id and s.campus_id = a.campus_id and s.deleted_at is null and s.status <> 'disposed'
    and (a.location_id is null or s.location_id = a.location_id)
    and (a.category_id is null or s.category_id = a.category_id)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function app.asset_verification_item_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.result in ('found', 'damaged', 'relocated') then
    update public.assets set last_verified_at = coalesce(new.verified_at, now()),
      location_id = case when new.result = 'relocated' and new.found_location_id is not null then new.found_location_id else location_id end,
      condition = case when new.result = 'damaged' then 'damaged' else condition end
    where id = new.asset_id;
  elsif new.result = 'missing' then
    perform app.log_activity(new.org_id, 'asset', new.asset_id, 'verification_missing', null,
      jsonb_build_object('audit_id', new.audit_id));
  end if;
  return null;
end $$;
create trigger asset_verification_item_after after update of result on public.asset_verification_items
  for each row when (new.result <> 'pending') execute function app.asset_verification_item_after();

-- -----------------------------------------------------------------------------
-- Checklists, PM schedules, work orders
-- -----------------------------------------------------------------------------
create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  description text,
  -- [{"key":"oil","label":"Check oil level","type":"check|number|text|photo","required":true}]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pm_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  title text not null,
  description text,
  trigger_type text not null default 'time' check (trigger_type in ('time', 'usage')),
  frequency text check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom_days')),
  interval_days int check (interval_days > 0),
  next_due_date date,
  lead_days int not null default 3 check (lead_days >= 0),
  usage_interval numeric(14, 2) check (usage_interval > 0),
  last_usage_reading numeric(14, 2) not null default 0,
  checklist_template_id uuid references public.checklist_templates(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  amc_contract_id uuid references public.amc_contracts(id) on delete set null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  requires_vendor_booking boolean not null default false,
  estimated_minutes int,
  active boolean not null default true,
  last_generated_at timestamptz,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (asset_id is not null or location_id is not null),
  check ((trigger_type = 'time' and frequency is not null and next_due_date is not null)
      or (trigger_type = 'usage' and asset_id is not null and usage_interval is not null)),
  check (frequency is distinct from 'custom_days' or interval_days is not null)
);
create index on public.pm_schedules (org_id, next_due_date) where active and deleted_at is null;

create table public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  title text not null,
  compliance_type text not null check (compliance_type in ('fire_safety', 'lift', 'water_tank', 'electrical',
    'pest_control', 'dg_set', 'building_safety', 'pollution', 'food_safety', 'transport', 'other')),
  authority text,
  certificate_number text,
  frequency_months int not null default 12 check (frequency_months > 0),
  last_done_on date,
  next_due_on date not null,
  reminder_days int not null default 30,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  auto_create_work_order boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.compliance_items (org_id, next_due_on) where deleted_at is null;

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  number text not null,
  title text not null,
  description text,
  type text not null default 'corrective' check (type in ('corrective', 'preventive', 'inspection', 'compliance', 'installation')),
  status text not null default 'open' check (status in ('open', 'scheduled', 'in_progress', 'on_hold', 'completed', 'verified', 'cancelled')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  asset_id uuid references public.assets(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  issue_id uuid,
  pm_schedule_id uuid references public.pm_schedules(id) on delete set null,
  pm_due_date date,
  compliance_item_id uuid references public.compliance_items(id) on delete set null,
  amc_contract_id uuid references public.amc_contracts(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  vendor_booking_status text not null default 'not_required' check (vendor_booking_status in (
    'not_required', 'requested', 'confirmed', 'declined', 'rescheduled', 'completed')),
  vendor_booking_note text,
  scheduled_for timestamptz,
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  checklist_template_id uuid references public.checklist_templates(id) on delete set null,
  checklist jsonb not null default '[]'::jsonb,  -- items with results
  labour_cost numeric(14, 2),
  material_cost numeric(14, 2),
  po_id uuid,
  completion_notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, number)
);
create index on public.work_orders (org_id, campus_id, status) where deleted_at is null;
create index on public.work_orders (assignee_id) where status not in ('completed', 'verified', 'cancelled');
create index on public.work_orders (vendor_id);
create unique index work_orders_pm_once on public.work_orders (pm_schedule_id, pm_due_date)
  where pm_schedule_id is not null and pm_due_date is not null;
create index on public.work_orders (asset_id);

create or replace function app.work_orders_before() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if tg_op = 'INSERT' then
    if new.number is null or new.number = '' then
      new.number := app.next_number(new.org_id, 'work_order', new.campus_id);
    end if;
    if new.checklist_template_id is not null and new.checklist = '[]'::jsonb then
      select items into new.checklist from public.checklist_templates where id = new.checklist_template_id;
    end if;
    if new.vendor_id is not null and new.vendor_booking_status = 'not_required' and new.type = 'preventive' then
      new.vendor_booking_status := 'requested';
    end if;
  else
    if new.status = 'in_progress' and old.status <> 'in_progress' and new.started_at is null then
      new.started_at := now();
    end if;
    if new.status = 'completed' and old.status <> 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
      -- required checklist items must have a result
      if exists (select 1 from jsonb_array_elements(new.checklist) i
                 where coalesce((i ->> 'required')::boolean, false) and (i -> 'result') is null) then
        raise exception 'complete all required checklist items first' using errcode = '23514';
      end if;
    end if;
    if new.status = 'verified' and old.status <> 'verified' then
      new.verified_at := now();
      new.verified_by := coalesce(new.verified_by, app.actor_id());
    end if;
  end if;
  return new;
end $$;
create trigger work_orders_before before insert or update on public.work_orders
  for each row execute function app.work_orders_before();

create or replace function app.work_orders_after() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform app.notify(new.org_id, new.assignee_id, 'work_order.assigned', 'Work order assigned: ' || new.number,
      new.title, 'work_order', new.id, '/facility/work-orders/' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' then
    -- compliance: roll the due date forward
    if new.compliance_item_id is not null then
      update public.compliance_items c set last_done_on = current_date,
        next_due_on = (current_date + make_interval(months => c.frequency_months))::date
      where id = new.compliance_item_id;
    end if;
    -- issue linked: mark resolved
    if new.issue_id is not null then
      perform app.begin_system_update();
      update public.issues set status = 'resolved', resolution_notes = coalesce(resolution_notes, new.completion_notes)
      where id = new.issue_id and status in ('open', 'acknowledged', 'assigned', 'in_progress', 'on_hold', 'reopened');
      perform app.end_system_update();
    end if;
    if new.asset_id is not null then
      update public.assets set status = 'in_use' where id = new.asset_id and status = 'under_repair';
    end if;
  end if;
  return null;
end $$;
create trigger work_orders_after after insert or update on public.work_orders
  for each row execute function app.work_orders_after();

-- AMC visits used
create or replace view public.amc_contract_usage
with (security_invoker = true) as
select c.id as amc_contract_id, c.org_id, c.visits_included,
  count(w.id) filter (where w.status in ('completed', 'verified')) as visits_used,
  greatest(c.visits_included - count(w.id) filter (where w.status in ('completed', 'verified')), 0) as visits_remaining
from public.amc_contracts c
left join public.work_orders w on w.amc_contract_id = c.id and w.deleted_at is null
group by c.id;

-- -----------------------------------------------------------------------------
-- Issues
-- -----------------------------------------------------------------------------
create table public.issues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  department_id uuid references public.departments(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  category_id uuid references public.issue_categories(id) on delete set null,
  number text not null,
  title text not null check (length(title) between 3 and 200),
  description text check (length(description) <= 5000),
  priority text not null check (priority in ('low', 'medium', 'high', 'critical')),  -- defaults from category
  status text not null default 'open' check (status in ('open', 'acknowledged', 'assigned', 'in_progress', 'on_hold',
    'resolved', 'closed', 'reopened', 'cancelled')),
  source text not null default 'web' check (source in ('web', 'mobile', 'qr', 'anonymous', 'api', 'email')),
  is_anonymous boolean not null default false,
  reporter_id uuid references public.profiles(id) on delete set null,  -- null for anonymous issues
  tracking_token_hash text unique,       -- anonymous status lookups (sha256 of token)
  assignee_id uuid references public.profiles(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  escalation_level smallint not null default 0,
  last_escalated_at timestamptz,
  reopened_count int not null default 0,
  resolution_notes text,
  rating smallint check (rating between 1 and 5),
  feedback text,
  feedback_at timestamptz,
  task_id uuid,
  work_order_id uuid references public.work_orders(id) on delete set null,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, number),
  check (not is_anonymous or reporter_id is null)
);
create index on public.issues (org_id, campus_id, status, created_at desc) where deleted_at is null;
create index on public.issues (org_id, status, resolution_due_at) where deleted_at is null and status not in ('resolved', 'closed', 'cancelled');
create index on public.issues (assignee_id) where status not in ('resolved', 'closed', 'cancelled');
create index on public.issues (reporter_id);
create index on public.issues (location_id);
create index on public.issues (asset_id);
create index on public.issues using gin (title extensions.gin_trgm_ops);

alter table public.work_orders
  add constraint work_orders_issue_fk foreign key (issue_id) references public.issues(id) on delete set null;

create or replace function app.issues_before_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  c public.issue_categories;
  sp public.sla_policies;
  l public.locations;
begin
  if new.location_id is not null then
    select * into l from public.locations where id = new.location_id;
    if l.org_id <> new.org_id then raise exception 'invalid location' using errcode = '23514'; end if;
    new.campus_id := coalesce(new.campus_id, l.campus_id);
  end if;
  new.number := app.next_number(new.org_id, 'issue', new.campus_id);
  if new.category_id is not null then
    select * into c from public.issue_categories where id = new.category_id and org_id = new.org_id;
    if not found then raise exception 'invalid category' using errcode = '23514'; end if;
    new.assignee_id := coalesce(new.assignee_id, c.default_assignee_id);
    new.vendor_id := coalesce(new.vendor_id, c.default_vendor_id);
  end if;
  new.priority := coalesce(new.priority, c.default_priority, 'medium');
  select * into sp from public.sla_policies where org_id = new.org_id and priority = new.priority;
  new.response_due_at := new.created_at + make_interval(mins => coalesce(c.response_minutes, sp.response_minutes, 240));
  new.resolution_due_at := new.created_at + make_interval(mins => coalesce(c.resolution_minutes, sp.resolution_minutes, 2880));
  if new.assignee_id is not null or new.vendor_id is not null then
    new.status := 'assigned';
  end if;
  if new.is_anonymous then
    new.reporter_id := null;
    new.created_by := null;
  end if;
  return new;
end $$;
create trigger issues_before_insert before insert on public.issues
  for each row execute function app.issues_before_insert();

-- Status workflow + field-level guard for non-managers.
create or replace function app.issues_before_update() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_actor uuid := app.actor_id();
  v_manager boolean;
  v_allowed text[];
  v_transitions jsonb := '{
    "open": ["acknowledged", "assigned", "in_progress", "on_hold", "resolved", "cancelled"],
    "acknowledged": ["assigned", "in_progress", "on_hold", "resolved", "cancelled"],
    "assigned": ["acknowledged", "in_progress", "on_hold", "resolved", "cancelled", "open"],
    "in_progress": ["on_hold", "resolved", "assigned", "cancelled"],
    "on_hold": ["in_progress", "assigned", "resolved", "cancelled"],
    "resolved": ["closed", "reopened"],
    "closed": ["reopened"],
    "reopened": ["acknowledged", "assigned", "in_progress", "on_hold", "resolved", "cancelled"],
    "cancelled": ["reopened"]
  }'::jsonb;
begin
  if new.status <> old.status and not (v_transitions -> old.status) ? new.status then
    raise exception 'cannot move issue from % to %', old.status, new.status using errcode = '23514';
  end if;

  -- Field-level guard only applies to end users (service role/API is checked in
  -- the service layer) and is bypassed for updates made by system triggers.
  if v_actor is not null and not app.in_system_update() then
    v_manager := app.has_permission(v_actor, 'issue:update', new.org_id, old.campus_id, old.department_id);
    if not v_manager then
      if v_actor = old.assignee_id then
        if new.status <> old.status and new.status not in ('acknowledged', 'in_progress', 'on_hold', 'resolved') then
          raise exception 'assignees can only acknowledge, progress, hold or resolve issues' using errcode = '42501';
        end if;
        v_allowed := array['status', 'resolution_notes', 'updated_at', 'updated_by', 'first_response_at',
                           'resolved_at', 'closed_at'];
      elsif v_actor = old.reporter_id then
        if new.status <> old.status and not (
             (old.status in ('resolved', 'closed') and new.status = 'reopened')
          or (old.status = 'resolved' and new.status = 'closed')
          or (old.status = 'open' and new.status = 'cancelled')) then
          raise exception 'reporters can only close, reopen or cancel their issues' using errcode = '42501';
        end if;
        v_allowed := array['status', 'rating', 'feedback', 'feedback_at', 'updated_at', 'updated_by',
                           'title', 'description', 'closed_at', 'reopened_count'];
        if old.status <> 'open' and (new.title <> old.title or new.description is distinct from old.description) then
          raise exception 'issue can only be edited while open' using errcode = '42501';
        end if;
      else
        raise exception 'not allowed to update this issue' using errcode = '42501';
      end if;
      if exists (select 1 from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
                 where n.value is distinct from o.value and not key = any (v_allowed)) then
        raise exception 'not allowed to change these fields' using errcode = '42501';
      end if;
    end if;
  end if;

  -- automatic timestamps / counters
  if new.status <> old.status then
    if old.status in ('open', 'reopened', 'assigned') and new.first_response_at is null
       and new.status in ('acknowledged', 'in_progress', 'on_hold', 'resolved') then
      new.first_response_at := now();
    end if;
    if new.status = 'resolved' then new.resolved_at := now(); end if;
    if new.status = 'closed' then new.closed_at := now(); end if;
    if new.status = 'reopened' then
      new.reopened_count := old.reopened_count + 1;
      new.resolved_at := null;
      new.closed_at := null;
      new.escalation_level := 0;
      new.resolution_due_at := greatest(old.resolution_due_at, now() + (old.resolution_due_at - old.created_at) / 2);
    end if;
  end if;
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null
     and new.status in ('open', 'reopened') then
    new.status := 'assigned';
  end if;
  if new.rating is distinct from old.rating then new.feedback_at := now(); end if;
  return new;
end $$;
create trigger issues_before_update before update on public.issues
  for each row execute function app.issues_before_update();

create or replace function app.issues_after_write() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  c public.issue_categories;
  v_wo uuid;
  v_project uuid;
  v_task uuid;
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform app.notify(new.org_id, new.assignee_id, 'issue.assigned', 'Issue assigned: ' || new.number,
      new.title, 'issue', new.id, '/facility/issues/' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.status <> old.status and new.reporter_id is not null then
    perform app.notify(new.org_id, new.reporter_id, 'issue.status_changed',
      new.number || ' is now ' || replace(new.status, '_', ' '), new.title, 'issue', new.id, '/facility/issues/' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.rating is not null and old.rating is null and new.vendor_id is not null then
    insert into public.vendor_ratings (org_id, vendor_id, source_type, source_id, rating, comment, rated_by)
    values (new.org_id, new.vendor_id, 'issue', new.id, new.rating, new.feedback, new.reporter_id)
    on conflict do nothing;
  end if;

  if tg_op = 'INSERT' and new.category_id is not null then
    select * into c from public.issue_categories where id = new.category_id;
    if c.auto_create = 'work_order' then
      insert into public.work_orders (org_id, campus_id, title, description, type, priority, asset_id, location_id,
        issue_id, assignee_id, vendor_id, due_at, number)
      values (new.org_id, new.campus_id, new.title, new.description, 'corrective', new.priority, new.asset_id,
        new.location_id, new.id, new.assignee_id, new.vendor_id, new.resolution_due_at, '')
      returning id into v_wo;
      perform app.begin_system_update();
      update public.issues set work_order_id = v_wo where id = new.id;
      perform app.end_system_update();
    elsif c.auto_create = 'task' then
      select (settings ->> 'issue_task_project_id')::uuid into v_project
      from public.org_modules where org_id = new.org_id and module = 'tasks' and enabled;
      execute 'insert into public.tasks (org_id, project_id, title, description, priority, due_date, created_by)
               values ($1, $2, $3, $4, $5, $6::date, $7) returning id'
        into v_task
        using new.org_id, v_project, new.number || ': ' || new.title, new.description,
              case new.priority when 'critical' then 'urgent' else new.priority end,
              new.resolution_due_at, new.reporter_id;
      if new.assignee_id is not null then
        execute 'insert into public.task_assignees (task_id, user_id, org_id) values ($1, $2, $3)'
          using v_task, new.assignee_id, new.org_id;
      end if;
      execute 'insert into public.task_links (org_id, task_id, entity_type, entity_id) values ($1, $2, ''issue'', $3)'
        using new.org_id, v_task, new.id;
      perform app.begin_system_update();
      update public.issues set task_id = v_task where id = new.id;
      perform app.end_system_update();
    end if;
  end if;
  return null;
end $$;
create trigger issues_after_write after insert or update of assignee_id, status, rating on public.issues
  for each row execute function app.issues_after_write();

-- Anonymous / public issue submission (called by the API after captcha + rate limit).
create or replace function public.submit_public_issue(
  p_qr_token text, p_title text, p_description text, p_category_id uuid default null,
  p_priority text default null, p_campus_id uuid default null, p_org_slug text default null
) returns table (issue_id uuid, issue_number text, tracking_token text)
language plpgsql security definer set search_path = public, app as $$
declare
  l public.locations;
  a public.assets;
  v_org uuid;
  v_campus uuid;
  v_token text := app.random_token(18);
  v_id uuid;
  v_number text;
begin
  if not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_qr_token is not null then
    select * into l from public.locations where qr_token = p_qr_token and deleted_at is null;
    if not found then
      select * into a from public.assets where qr_token = p_qr_token and deleted_at is null;
      if not found then raise exception 'unknown QR code' using errcode = 'P0002'; end if;
      v_org := a.org_id; v_campus := a.campus_id;
    else
      v_org := l.org_id; v_campus := l.campus_id;
    end if;
  else
    select id into v_org from public.organisations where slug = p_org_slug and deleted_at is null;
    v_campus := p_campus_id;
    if v_org is null or not exists (select 1 from public.campuses where id = v_campus and org_id = v_org) then
      raise exception 'unknown organisation or campus' using errcode = 'P0002';
    end if;
  end if;
  if not app.module_enabled(v_org, 'facility') then
    raise exception 'facility module disabled' using errcode = '42501';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.issue_categories where id = p_category_id and org_id = v_org and active and public_visible) then
    raise exception 'invalid category' using errcode = '22023';
  end if;

  insert into public.issues (org_id, campus_id, location_id, asset_id, category_id, title, description, priority,
    source, is_anonymous, tracking_token_hash, number)
  values (v_org, v_campus, coalesce(l.id, a.location_id), a.id, p_category_id, p_title, p_description,
    p_priority, case when p_qr_token is not null then 'qr' else 'anonymous' end, true,
    app.sha256(v_token), '')
  returning id, number into v_id, v_number;
  return query select v_id, v_number, v_token;
end $$;

create or replace function public.public_issue_status(p_tracking_token text)
returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  i public.issues;
begin
  if not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into i from public.issues where tracking_token_hash = app.sha256(p_tracking_token) and deleted_at is null;
  if not found then return null; end if;
  return jsonb_build_object(
    'number', i.number, 'title', i.title, 'status', i.status, 'priority', i.priority,
    'created_at', i.created_at, 'resolved_at', i.resolved_at, 'closed_at', i.closed_at,
    'resolution_notes', i.resolution_notes, 'rating', i.rating,
    'location', (select array_to_string(path_names || name, ' / ') from public.locations where id = i.location_id),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('body', c.body, 'at', c.created_at,
                          'by', coalesce(c.author_label, 'Facilities team')) order by c.created_at)
                         from public.comments c
                         where c.entity_type = 'issue' and c.entity_id = i.id and not c.is_internal and c.deleted_at is null), '[]'::jsonb));
end $$;

create or replace function public.public_issue_feedback(
  p_tracking_token text, p_action text, p_rating smallint default null, p_feedback text default null
) returns text
language plpgsql security definer set search_path = public, app as $$
declare
  i public.issues;
begin
  if not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into i from public.issues where tracking_token_hash = app.sha256(p_tracking_token) and deleted_at is null for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_action = 'rate' then
    if i.status not in ('resolved', 'closed') then raise exception 'issue is not resolved yet' using errcode = 'P0001'; end if;
    update public.issues set rating = p_rating, feedback = p_feedback,
      status = case when status = 'resolved' then 'closed' else status end where id = i.id;
  elsif p_action = 'reopen' then
    if i.status not in ('resolved', 'closed') then raise exception 'issue is not resolved' using errcode = 'P0001'; end if;
    if i.resolved_at < now() - interval '14 days' then raise exception 'reopen window has passed' using errcode = 'P0001'; end if;
    update public.issues set status = 'reopened' where id = i.id;
    if p_feedback is not null then
      insert into public.comments (org_id, entity_type, entity_id, body, author_label)
      values (i.org_id, 'issue', i.id, p_feedback, 'Reporter');
    end if;
  else
    raise exception 'invalid action' using errcode = '22023';
  end if;
  return (select status from public.issues where id = i.id);
end $$;

-- Resolve a QR token to what it points at (public; returns non-sensitive info only).
create or replace function public.resolve_qr(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('kind', 'location', 'id', l.id, 'org_id', l.org_id, 'campus_id', l.campus_id,
       'org_name', o.name, 'org_slug', o.slug, 'name', l.name,
       'path', array_to_string(l.path_names || l.name, ' / '), 'campus', c.name,
       'facility_enabled', app.module_enabled(l.org_id, 'facility'))
     from public.locations l join public.organisations o on o.id = l.org_id join public.campuses c on c.id = l.campus_id
     where l.qr_token = p_token and l.deleted_at is null),
    (select jsonb_build_object('kind', 'asset', 'id', a.id, 'org_id', a.org_id, 'campus_id', a.campus_id,
       'org_name', o.name, 'org_slug', o.slug, 'name', a.name, 'asset_tag', a.asset_tag, 'campus', c.name,
       'path', (select array_to_string(l.path_names || l.name, ' / ') from public.locations l where l.id = a.location_id),
       'facility_enabled', app.module_enabled(a.org_id, 'facility'))
     from public.assets a join public.organisations o on o.id = a.org_id join public.campuses c on c.id = a.campus_id
     where a.qr_token = p_token and a.deleted_at is null))
$$;

revoke execute on function public.submit_public_issue(text, text, text, uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.public_issue_status(text) from public, anon, authenticated;
revoke execute on function public.public_issue_feedback(text, text, smallint, text) from public, anon, authenticated;

-- SLA escalation (pg_cron every 5 minutes).
--   level 1: response SLA breached         -> notify assignee + campus issue managers
--   level 2: resolution SLA breached       -> notify campus issue managers
--   level 3: resolution breached by > 24h  -> notify org-level issue managers
create or replace function app.escalate_issues() returns int
language plpgsql security definer set search_path = public, app as $$
declare
  i record;
  v_level int;
  v_user uuid;
  n int := 0;
begin
  for i in
    select * from public.issues
    where deleted_at is null and status not in ('resolved', 'closed', 'cancelled', 'on_hold')
      and ((first_response_at is null and response_due_at < now() and escalation_level < 1)
        or (resolution_due_at < now() and escalation_level < 2)
        or (resolution_due_at < now() - interval '24 hours' and escalation_level < 3))
    for update skip locked
  loop
    v_level := case
      when i.resolution_due_at < now() - interval '24 hours' then 3
      when i.resolution_due_at < now() then 2
      else 1 end;
    update public.issues set escalation_level = v_level, last_escalated_at = now() where id = i.id;
    for v_user in
      select distinct a.user_id from public.user_role_assignments a
      join public.roles r on r.id = a.role_id
      join public.org_members m on m.org_id = a.org_id and m.user_id = a.user_id and m.status = 'active'
      where a.org_id = i.org_id
        and (r.is_superuser or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = 'issue:escalation'))
        and (case when v_level >= 3 then a.scope_type = 'org'
                  else a.scope_type = 'org' or (a.scope_type = 'campus' and a.campus_id = i.campus_id) end)
      union select i.assignee_id where i.assignee_id is not null and v_level = 1
    loop
      perform app.notify(i.org_id, v_user, 'issue.escalated',
        format('Escalation L%s: %s', v_level, i.number), i.title, 'issue', i.id, '/facility/issues/' || i.id);
    end loop;
    perform app.emit_event(i.org_id, 'issue.escalated', 'issue', i.id,
      jsonb_build_object('level', v_level, 'number', i.number));
    perform app.log_activity(i.org_id, 'issue', i.id, 'escalated', null, jsonb_build_object('level', v_level));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Generate preventive maintenance work orders (pg_cron daily).
create or replace function app.generate_pm_work_orders(p_today date default current_date) returns int
language plpgsql security definer set search_path = public, app as $$
declare
  s public.pm_schedules;
  a public.assets;
  n int := 0;
  v_count int;
  v_next date;
begin
  -- time based
  for s in
    select * from public.pm_schedules
    where active and deleted_at is null and trigger_type = 'time' and next_due_date - lead_days <= p_today
    for update skip locked
  loop
    if not app.module_enabled(s.org_id, 'facility') then continue; end if;
    insert into public.work_orders (org_id, campus_id, title, description, type, priority, asset_id, location_id,
      pm_schedule_id, pm_due_date, amc_contract_id, assignee_id, vendor_id, checklist_template_id, due_at, scheduled_for,
      vendor_booking_status, number)
    values (s.org_id, s.campus_id, s.title, s.description, 'preventive', s.priority, s.asset_id, s.location_id,
      s.id, s.next_due_date, s.amc_contract_id, s.assignee_id, s.vendor_id, s.checklist_template_id,
      s.next_due_date + time '18:00', s.next_due_date + time '09:00',
      case when s.requires_vendor_booking and s.vendor_id is not null then 'requested' else 'not_required' end, '')
    on conflict do nothing;
    if found then n := n + 1; end if;
    v_next := case s.frequency
      when 'daily' then s.next_due_date + 1
      when 'weekly' then s.next_due_date + 7
      when 'monthly' then (s.next_due_date + interval '1 month')::date
      when 'quarterly' then (s.next_due_date + interval '3 months')::date
      when 'half_yearly' then (s.next_due_date + interval '6 months')::date
      when 'yearly' then (s.next_due_date + interval '1 year')::date
      when 'custom_days' then s.next_due_date + s.interval_days end;
    update public.pm_schedules set next_due_date = v_next, last_generated_at = now() where id = s.id;
  end loop;

  -- usage based
  for s in
    select p.* from public.pm_schedules p join public.assets x on x.id = p.asset_id
    where p.active and p.deleted_at is null and p.trigger_type = 'usage'
      and x.usage_meter - p.last_usage_reading >= p.usage_interval
    for update of p skip locked
  loop
    select * into a from public.assets where id = s.asset_id;
    insert into public.work_orders (org_id, campus_id, title, description, type, priority, asset_id, location_id,
      pm_schedule_id, amc_contract_id, assignee_id, vendor_id, checklist_template_id, due_at, number)
    values (s.org_id, s.campus_id, s.title || ' (at ' || a.usage_meter || coalesce(' ' || a.usage_unit, '') || ')',
      s.description, 'preventive', s.priority, s.asset_id, coalesce(s.location_id, a.location_id), s.id,
      s.amc_contract_id, s.assignee_id, s.vendor_id, s.checklist_template_id, now() + make_interval(days => greatest(s.lead_days, 1)), '');
    update public.pm_schedules set last_usage_reading = a.usage_meter, last_generated_at = now() where id = s.id;
    n := n + 1;
  end loop;

  -- compliance items due within reminder window get a work order once
  insert into public.work_orders (org_id, campus_id, title, type, priority, location_id, asset_id, compliance_item_id,
    vendor_id, assignee_id, due_at, number)
  select c.org_id, c.campus_id, 'Compliance: ' || c.title, 'compliance', 'high', c.location_id, c.asset_id, c.id,
    c.vendor_id, c.responsible_user_id, c.next_due_on + time '18:00', ''
  from public.compliance_items c
  where c.deleted_at is null and c.auto_create_work_order and c.next_due_on - c.reminder_days <= p_today
    and app.module_enabled(c.org_id, 'facility')
    and not exists (select 1 from public.work_orders w where w.compliance_item_id = c.id
                    and w.status not in ('completed', 'verified', 'cancelled'));
  get diagnostics v_count = row_count;
  return n + v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Vendor onboarding: invite > vendor self-fills > documents > verification >
-- approval via the approval engine.
-- -----------------------------------------------------------------------------
create or replace function public.vendor_submit_for_approval(p_vendor_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v public.vendors;
  v_required text[];
  v_missing text[];
  v_request uuid;
begin
  select * into v from public.vendors where id = p_vendor_id for update;
  if not found then raise exception 'vendor not found' using errcode = 'P0002'; end if;
  if not app.has_permission_anywhere(app.actor_id(), 'vendor:update', v.org_id) then
    raise exception 'missing permission vendor:update' using errcode = '42501';
  end if;
  if v.status not in ('draft', 'submitted', 'under_verification', 'rejected', 'invited') then
    raise exception 'vendor is %', v.status using errcode = 'P0001';
  end if;
  select coalesce(nullif(array(select jsonb_array_elements_text(settings -> 'vendor_required_documents')), '{}'),
                  array['pan_card', 'cancelled_cheque'])
    into v_required
  from public.org_modules where org_id = v.org_id and module = 'facility';
  v_required := coalesce(v_required, array['pan_card', 'cancelled_cheque']);
  select array_agg(r) into v_missing from unnest(v_required) r
  where not exists (select 1 from public.vendor_documents d where d.vendor_id = v.id and d.doc_type = r
                    and d.verification_status = 'verified');
  if v_missing is not null then
    raise exception 'verify these documents first: %', array_to_string(v_missing, ', ') using errcode = '23514';
  end if;
  if v.pan is null or v.bank_account_number is null or v.bank_ifsc is null then
    raise exception 'PAN and bank details are required' using errcode = '23514';
  end if;
  perform app.begin_system_update();
  update public.vendors set status = 'pending_approval', verified_by = app.actor_id(), verified_at = now() where id = v.id;
  perform app.end_system_update();
  v_request := app.approval_create(v.org_id, 'facility', 'vendor', v.id, null, null, null, '{}',
    'Vendor onboarding: ' || v.name, app.actor_id());
  update public.vendors set approval_request_id = v_request where id = v.id;
  return jsonb_build_object('status', (select status from public.vendors where id = v.id), 'approval_request_id', v_request);
end $$;

create or replace function app.vendor_on_decision(p_request_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v public.vendors;
begin
  select * into v from public.vendors where id = (select entity_id from public.approval_requests where id = p_request_id);
  perform app.begin_system_update();
  if p_status = 'approved' then
    update public.vendors set status = 'approved',
      vendor_code = coalesce(vendor_code, app.next_number(v.org_id, 'vendor', null)) where id = v.id;
    perform app.queue_message(v.org_id, 'email', v.email, 'vendor_approved', 'You are now an approved vendor',
      jsonb_build_object('vendor', v.name, 'vendor_id', v.id), 'vendor_approved:' || v.id);
  elsif p_status = 'rejected' then
    update public.vendors set status = 'rejected' where id = v.id;
  else
    update public.vendors set status = 'under_verification' where id = v.id;
  end if;
  perform app.end_system_update();
end $$;

insert into app.approval_handlers (entity_type, handler) values ('vendor', 'app.vendor_on_decision(uuid,text)');

-- Status changes on vendors go through actions (submit, approval, blacklist).
create or replace function app.vendors_guard() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.status is distinct from old.status and not app.in_system_update() and app.actor_id() is not null then
    if not (
      (old.status in ('draft', 'invited', 'submitted') and new.status in ('under_verification', 'draft'))
      or (new.status = 'blacklisted' and app.has_permission_anywhere(app.actor_id(), 'vendor:approve', new.org_id))
      or (old.status = 'blacklisted' and new.status = 'approved' and app.has_permission_anywhere(app.actor_id(), 'vendor:approve', new.org_id))
      or (old.status = 'approved' and new.status = 'inactive')
      or (old.status = 'inactive' and new.status = 'approved' and app.has_permission_anywhere(app.actor_id(), 'vendor:approve', new.org_id))
    ) then
      raise exception 'cannot move vendor from % to %', old.status, new.status using errcode = '42501';
    end if;
  end if;
  if new.status = 'blacklisted' and old.status <> 'blacklisted' then
    new.blacklisted_at := now();
    if new.blacklist_reason is null then raise exception 'blacklist reason required' using errcode = '23514'; end if;
  elsif new.status <> 'blacklisted' then
    new.blacklisted_at := null;
  end if;
  return new;
end $$;
create trigger vendors_guard before update on public.vendors for each row execute function app.vendors_guard();

-- Vendor portal tokens (magic links). Service role only.
create or replace function public.vendor_portal_resolve(p_token text)
returns table (vendor_id uuid, org_id uuid, purpose text, vendor_status text)
language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  update public.vendor_portal_tokens t set last_used_at = now()
  from public.vendors v
  where t.token_hash = app.sha256(p_token) and t.revoked_at is null and t.expires_at > now()
    and v.id = t.vendor_id and v.deleted_at is null and v.status <> 'blacklisted'
  returning t.vendor_id, t.org_id, t.purpose, v.status;
end $$;
revoke execute on function public.vendor_portal_resolve(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
select app.enable_standard_rls('public.locations', 'location', 'campus_id');
-- every member can see locations so they can report issues
create policy locations_member_read on public.locations for select to authenticated
  using (org_id in (select app.my_org_ids()));

alter table public.service_categories enable row level security;
create policy sc_select on public.service_categories for select to authenticated using (org_id in (select app.my_org_ids()));
create policy sc_write on public.service_categories for all to authenticated
  using (app.can('vendor:update', org_id)) with check (app.can('vendor:update', org_id));

select app.enable_standard_rls('public.vendors', 'vendor');
select app.enable_child_rls('public.vendor_documents', 'public.vendors', 'vendor_id', 'vendor');
select app.enable_child_rls('public.vendor_agreements', 'public.vendors', 'vendor_id', 'vendor');
alter table public.vendor_ratings enable row level security;
create policy vr_select on public.vendor_ratings for select to authenticated
  using (exists (select 1 from public.vendors v where v.id = vendor_id));
create policy vr_insert on public.vendor_ratings for insert to authenticated
  with check (rated_by = (select auth.uid()) and org_id in (select app.my_org_ids())
              and (app.can('vendor:rate', org_id) or app.can('vendor:update', org_id)));
alter table public.vendor_portal_tokens enable row level security;
create policy vpt_admin on public.vendor_portal_tokens for select to authenticated
  using (app.can('vendor:update', org_id));

alter table public.sla_policies enable row level security;
create policy sla_select on public.sla_policies for select to authenticated using (org_id in (select app.my_org_ids()));
create policy sla_write on public.sla_policies for all to authenticated
  using (app.can('settings:manage', org_id, null, null, true)) with check (app.can('settings:manage', org_id, null, null, true));

alter table public.issue_categories enable row level security;
create policy ic_select on public.issue_categories for select to authenticated using (org_id in (select app.my_org_ids()));
create policy ic_write on public.issue_categories for all to authenticated
  using (app.can('issue:configure', org_id, null, null, true)) with check (app.can('issue:configure', org_id, null, null, true));

alter table public.asset_categories enable row level security;
create policy ac_select on public.asset_categories for select to authenticated using (org_id in (select app.my_org_ids()));
create policy ac_write on public.asset_categories for all to authenticated
  using (app.can('asset:configure', org_id, null, null, true)) with check (app.can('asset:configure', org_id, null, null, true));

select app.enable_standard_rls('public.assets', 'asset', 'campus_id', 'department_id', array['custodian_id']);
select app.enable_standard_rls('public.amc_contracts', 'amc', 'campus_id');
alter table public.amc_contract_assets enable row level security;
create policy aca_select on public.amc_contract_assets for select to authenticated
  using (exists (select 1 from public.amc_contracts c where c.id = amc_contract_id));
create policy aca_write on public.amc_contract_assets for all to authenticated
  using (exists (select 1 from public.amc_contracts c where c.id = amc_contract_id and app.can('amc:update', c.org_id, c.campus_id)))
  with check (exists (select 1 from public.amc_contracts c where c.id = amc_contract_id and app.can('amc:update', c.org_id, c.campus_id)));

alter table public.asset_transfers enable row level security;
create policy at_select on public.asset_transfers for select to authenticated
  using (app.can('asset:read', org_id, from_campus_id) or app.can('asset:read', org_id, to_campus_id)
         or requested_by = (select auth.uid()) or to_custodian_id = (select auth.uid()));
create policy at_insert on public.asset_transfers for insert to authenticated
  with check (app.can('asset:transfer', org_id, from_campus_id) and requested_by = (select auth.uid()));
create policy at_update on public.asset_transfers for update to authenticated
  using (app.can('asset:transfer', org_id, to_campus_id) or app.can('asset:transfer', org_id, from_campus_id))
  with check (app.can('asset:transfer', org_id, to_campus_id) or app.can('asset:transfer', org_id, from_campus_id));

select app.enable_standard_rls('public.asset_verification_audits', 'asset_audit', 'campus_id');
select app.enable_child_rls('public.asset_verification_items', 'public.asset_verification_audits', 'audit_id',
  'asset_audit', 'campus_id');

alter table public.checklist_templates enable row level security;
create policy ct_select on public.checklist_templates for select to authenticated using (org_id in (select app.my_org_ids()));
create policy ct_write on public.checklist_templates for all to authenticated
  using (app.can('pm:update', org_id)) with check (app.can('pm:update', org_id));

select app.enable_standard_rls('public.pm_schedules', 'pm', 'campus_id');
select app.enable_standard_rls('public.compliance_items', 'compliance', 'campus_id', null, array['responsible_user_id']);
select app.enable_standard_rls('public.work_orders', 'work_order', 'campus_id', null,
  array['assignee_id', 'created_by'], true);
select app.enable_standard_rls('public.issues', 'issue', 'campus_id', 'department_id',
  array['reporter_id', 'assignee_id'], true);
-- any member holding issue:report can raise issues as themselves
create policy issues_report on public.issues for insert to authenticated
  with check (app.can('issue:report', org_id, campus_id) and reporter_id = (select auth.uid()) and not is_anonymous);

-- -----------------------------------------------------------------------------
-- Triggers: timestamps/actor, audit, events
-- -----------------------------------------------------------------------------
select app.add_standard_triggers(t) from unnest(array[
  'public.locations', 'public.vendors', 'public.vendor_documents', 'public.vendor_agreements', 'public.issue_categories',
  'public.asset_categories', 'public.amc_contracts', 'public.assets', 'public.asset_verification_audits',
  'public.checklist_templates', 'public.pm_schedules', 'public.compliance_items', 'public.work_orders', 'public.issues'
]::regclass[]) t;

select app.add_audit('public.locations', 'location');
select app.add_audit('public.vendors', 'vendor');
select app.add_audit('public.amc_contracts', 'amc_contract');
select app.add_audit('public.assets', 'asset');
select app.add_audit('public.pm_schedules', 'pm_schedule');
select app.add_audit('public.compliance_items', 'compliance_item');
select app.add_audit('public.work_orders', 'work_order');
select app.add_audit('public.issues', 'issue');

select app.add_events('public.issues', 'issue');
select app.add_events('public.work_orders', 'work_order');
select app.add_events('public.assets', 'asset');
select app.add_events('public.vendors', 'vendor');

insert into app.entity_registry (entity_type, table_name, resource, module, campus_col, dept_col, owner_cols, title_col, number_col, url_template) values
  ('location', 'public.locations', 'location', 'facility', 'campus_id', null, '{}', 'name', 'code', '/facility/locations/{id}'),
  ('issue', 'public.issues', 'issue', 'facility', 'campus_id', 'department_id', '{reporter_id,assignee_id}', 'title', 'number', '/facility/issues/{id}'),
  ('asset', 'public.assets', 'asset', 'facility', 'campus_id', 'department_id', '{custodian_id}', 'name', 'asset_tag', '/facility/assets/{id}'),
  ('vendor', 'public.vendors', 'vendor', 'facility', null, null, '{}', 'name', 'vendor_code', '/facility/vendors/{id}'),
  ('work_order', 'public.work_orders', 'work_order', 'facility', 'campus_id', null, '{assignee_id,created_by}', 'title', 'number', '/facility/work-orders/{id}'),
  ('pm_schedule', 'public.pm_schedules', 'pm', 'facility', 'campus_id', null, '{}', 'title', null, '/facility/maintenance/{id}'),
  ('amc_contract', 'public.amc_contracts', 'amc', 'facility', 'campus_id', null, '{}', 'title', 'contract_number', '/facility/amc/{id}'),
  ('compliance_item', 'public.compliance_items', 'compliance', 'facility', 'campus_id', null, '{responsible_user_id}', 'title', null, '/facility/compliance/{id}'),
  ('asset_audit', 'public.asset_verification_audits', 'asset_audit', 'facility', 'campus_id', null, '{}', 'name', null, '/facility/assets/audits/{id}');
