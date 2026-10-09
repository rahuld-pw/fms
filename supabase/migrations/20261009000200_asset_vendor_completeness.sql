-- -----------------------------------------------------------------------------
-- Assets: warranty start and installation dates, sub-categories, additional
-- warranties with documents, condition assessments, and an activity entry on
-- the asset for every transfer, warranty, AMC link, condition and audit result.
-- Vendors: primary category, campuses served, contract terms and SLA.
-- -----------------------------------------------------------------------------

-- ---- assets -----------------------------------------------------------------
alter table public.assets
  -- no foreign key on purpose: a second assets → asset_categories key would make
  -- existing `category:asset_categories(...)` embeds ambiguous. The trigger below
  -- checks it, and the `subcategory` function gives the API a relationship.
  add column if not exists subcategory_id uuid,
  add column if not exists warranty_start date,
  add column if not exists installed_on date;
alter table public.assets add constraint assets_warranty_dates_check
  check (warranty_start is null or warranty_until is null or warranty_until >= warranty_start);
create index if not exists assets_subcategory_idx on public.assets (org_id, subcategory_id) where deleted_at is null;

-- A sub-category must belong to the chosen category; picking only a
-- sub-category fills in its parent.
create or replace function app.assets_check_subcategory() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_parent uuid;
begin
  if new.subcategory_id is null then return new; end if;
  select parent_id into v_parent from public.asset_categories where id = new.subcategory_id and org_id = new.org_id;
  if not found or v_parent is null then
    raise exception 'Sub-category must be a sub-category of this organisation' using errcode = '23514';
  end if;
  if new.category_id is null then
    new.category_id := v_parent;
  elsif new.category_id <> v_parent then
    raise exception 'Sub-category does not belong to the selected category' using errcode = '23514';
  end if;
  return new;
end $$;
-- "a_" so it runs before assets_before_insert (tag and depreciation defaults)
create or replace trigger assets_a_check_subcategory before insert or update of category_id, subcategory_id on public.assets
  for each row execute function app.assets_check_subcategory();

create or replace function public.subcategory(public.assets) returns setof public.asset_categories
language sql stable rows 1 set search_path = public as $$
  select * from public.asset_categories where id = $1.subcategory_id
$$;

create or replace function app.asset_categories_clear_subcategory() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  update public.assets set subcategory_id = null where subcategory_id = old.id;
  return old;
end $$;
create or replace trigger asset_categories_clear_subcategory before delete on public.asset_categories
  for each row execute function app.asset_categories_clear_subcategory();

-- Depreciation defaults come from the sub-category when it has its own.
create or replace function app.assets_before_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  c public.asset_categories;
  s public.asset_categories;
  v_seq text;
begin
  select * into c from public.asset_categories where id = new.category_id;
  select * into s from public.asset_categories where id = new.subcategory_id;
  if new.asset_tag is null or new.asset_tag = '' then
    v_seq := app.next_number(new.org_id, 'asset', new.campus_id, coalesce(new.purchase_date, current_date));
    new.asset_tag := case when c.code is not null then c.code || '-' else '' end || v_seq;
  end if;
  if s.id is not null and s.useful_life_months is not null then c := s; end if;
  if new.depreciation_method is null and c.id is not null then
    new.depreciation_method := c.depreciation_method;
    new.useful_life_months := coalesce(new.useful_life_months, c.useful_life_months);
    if new.salvage_value is null and new.purchase_cost is not null then
      new.salvage_value := round(new.purchase_cost * c.salvage_percent / 100, 2);
    end if;
  end if;
  return new;
end $$;

-- Choosing an AMC on the asset also lists the asset on the contract.
create or replace function app.assets_sync_amc() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.amc_contract_id is not null and (tg_op = 'INSERT' or new.amc_contract_id is distinct from old.amc_contract_id) then
    if not exists (select 1 from public.amc_contracts where id = new.amc_contract_id and org_id = new.org_id) then
      raise exception 'AMC contract not found' using errcode = '23503';
    end if;
    insert into public.amc_contract_assets (amc_contract_id, asset_id, org_id)
    values (new.amc_contract_id, new.id, new.org_id) on conflict do nothing;
  end if;
  return null;
end $$;
create or replace trigger assets_sync_amc after insert or update of amc_contract_id on public.assets
  for each row execute function app.assets_sync_amc();

-- ---- additional / extended warranties ----------------------------------------
create table if not exists public.asset_warranties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  warranty_type text not null default 'extended' check (warranty_type in ('extended', 'additional', 'manufacturer', 'insurance', 'other')),
  provider text,
  vendor_id uuid references public.vendors(id) on delete set null,
  reference_number text,
  start_date date not null,
  end_date date not null,
  cost numeric(14, 2) check (cost >= 0),
  coverage text,
  attachment_id uuid references public.attachments(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists asset_warranties_asset_idx on public.asset_warranties (asset_id, end_date desc);
create index if not exists asset_warranties_expiry_idx on public.asset_warranties (org_id, end_date);

-- ---- condition assessments -------------------------------------------------------
create table if not exists public.asset_condition_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  condition text not null check (condition in ('new', 'good', 'fair', 'poor', 'damaged')),
  previous_condition text,
  notes text check (length(notes) <= 2000),
  attachment_id uuid references public.attachments(id) on delete set null,
  recorded_by uuid references public.profiles(id) default auth.uid(),
  recorded_at timestamptz not null default now()
);
create index if not exists asset_condition_logs_asset_idx on public.asset_condition_logs (asset_id, recorded_at desc);

-- Recording a condition sets it on the asset (that change is in the asset's history).
create or replace function app.asset_condition_log_before() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  select condition into new.previous_condition from public.assets where id = new.asset_id;
  new.recorded_by := coalesce(new.recorded_by, app.actor_id());
  update public.assets set condition = new.condition where id = new.asset_id and condition is distinct from new.condition;
  if new.previous_condition is not distinct from new.condition then
    perform app.log_activity(new.org_id, 'asset', new.asset_id, 'condition_recorded', null,
      jsonb_build_object('condition', new.condition, 'notes', new.notes));
  end if;
  return new;
end $$;
create or replace trigger asset_condition_log_before before insert on public.asset_condition_logs
  for each row execute function app.asset_condition_log_before();

-- ---- activity on the asset for related records -------------------------------
create or replace function app.asset_related_activity() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  r record;
  v_action text;
  v_meta jsonb;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if not exists (select 1 from public.assets where id = r.asset_id) then return null; end if;
  if tg_table_name = 'asset_warranties' then
    v_action := case tg_op when 'INSERT' then 'warranty_added' when 'UPDATE' then 'warranty_updated' else 'warranty_removed' end;
    v_meta := jsonb_build_object('warranty_type', r.warranty_type, 'provider', r.provider, 'start_date', r.start_date, 'end_date', r.end_date);
  elsif tg_table_name = 'amc_contract_assets' then
    v_action := case tg_op when 'INSERT' then 'amc_linked' else 'amc_unlinked' end;
    v_meta := (select jsonb_build_object('amc_contract_id', c.id, 'title', c.title, 'end_date', c.end_date)
               from public.amc_contracts c where c.id = r.amc_contract_id);
  elsif tg_table_name = 'asset_transfers' then
    if tg_op = 'INSERT' then
      v_action := 'transfer_requested';
    elsif new.status is distinct from old.status then
      v_action := 'transfer_' || new.status;
    else
      return null;
    end if;
    v_meta := jsonb_build_object('transfer_id', r.id, 'reason', r.reason,
      'to', (select concat_ws(' › ', cp.name, nullif(array_to_string(l.path_names || l.name, ' › '), ''))
             from public.campuses cp left join public.locations l on l.id = r.to_location_id where cp.id = r.to_campus_id),
      'to_custodian', (select full_name from public.profiles where id = r.to_custodian_id));
  elsif tg_table_name = 'asset_verification_items' then
    if new.result = 'pending' or (tg_op = 'UPDATE' and new.result is not distinct from old.result) then return null; end if;
    v_action := 'verification_' || new.result;
    v_meta := jsonb_build_object('audit_id', r.audit_id, 'audit', (select name from public.asset_verification_audits where id = r.audit_id),
      'notes', r.notes);
  else
    return null;
  end if;
  perform app.log_activity(r.org_id, 'asset', r.asset_id, v_action, null, coalesce(v_meta, '{}'::jsonb));
  return null;
end $$;

create or replace trigger asset_related_activity after insert or update or delete on public.asset_warranties
  for each row execute function app.asset_related_activity();
create or replace trigger asset_related_activity after insert or delete on public.amc_contract_assets
  for each row execute function app.asset_related_activity();
create or replace trigger asset_related_activity after insert or update of status on public.asset_transfers
  for each row execute function app.asset_related_activity();
create or replace trigger asset_related_activity after insert or update of result on public.asset_verification_items
  for each row when (new.result <> 'pending') execute function app.asset_related_activity();
-- scanning an asset that wasn't in the audit's list adds it with a result: apply that too
create or replace trigger asset_verification_item_after after insert or update of result on public.asset_verification_items
  for each row when (new.result <> 'pending') execute function app.asset_verification_item_after();

-- An audit of a building covers every floor and room inside it; a sub-category
-- scope matches assets by sub-category.
create or replace function public.asset_audit_populate(p_audit_id uuid) returns int
language plpgsql security invoker set search_path = public, app as $$
declare
  a public.asset_verification_audits;
  n int;
begin
  select * into a from public.asset_verification_audits where id = p_audit_id;
  if not found then raise exception 'audit not found' using errcode = 'P0002'; end if;
  insert into public.asset_verification_items (org_id, audit_id, asset_id)
  select a.org_id, a.id, s.id from public.assets s
  where s.org_id = a.org_id and s.campus_id = a.campus_id and s.deleted_at is null and s.status <> 'disposed'
    and (a.location_id is null or s.location_id in (
      with recursive tree as (
        select id from public.locations where id = a.location_id
        union all
        select l.id from public.locations l join tree on l.parent_id = tree.id
      ) select id from tree))
    and (a.category_id is null or s.category_id = a.category_id or s.subcategory_id = a.category_id)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- the generic logger above now covers missing assets as well
create or replace function app.asset_verification_item_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.result in ('found', 'damaged', 'relocated') then
    update public.assets set last_verified_at = coalesce(new.verified_at, now()),
      location_id = case when new.result = 'relocated' and new.found_location_id is not null then new.found_location_id else location_id end,
      condition = case when new.result = 'damaged' then 'damaged'
                       when new.condition in ('new', 'good', 'fair', 'poor', 'damaged') then new.condition else condition end
    where id = new.asset_id;
  elsif new.result = 'missing' then
    update public.assets set last_verified_at = coalesce(new.verified_at, now()) where id = new.asset_id;
  end if;
  return null;
end $$;

-- ---- vendors ----------------------------------------------------------------
alter table public.vendors
  add column if not exists category_id uuid references public.service_categories(id) on delete set null,
  add column if not exists campus_ids uuid[] not null default '{}',
  add column if not exists service_area text,
  add column if not exists contract_type text,
  add column if not exists contract_start date,
  add column if not exists contract_end date,
  add column if not exists contract_value numeric(14, 2),
  add column if not exists sla_response_hours numeric(8, 2),
  add column if not exists sla_resolution_hours numeric(8, 2),
  add column if not exists sla_terms text,
  add column if not exists penalty_terms text;
alter table public.vendors add constraint vendors_contract_type_check check (contract_type is null or contract_type in (
  'amc', 'rate_contract', 'annual', 'retainer', 'on_call', 'one_time', 'other'));
alter table public.vendors add constraint vendors_contract_dates_check
  check (contract_start is null or contract_end is null or contract_end >= contract_start);
alter table public.vendors add constraint vendors_sla_check
  check ((sla_response_hours is null or sla_response_hours > 0) and (sla_resolution_hours is null or sla_resolution_hours > 0));
create index if not exists vendors_category_idx on public.vendors (org_id, category_id) where deleted_at is null;
create index if not exists vendors_campus_ids_idx on public.vendors using gin (campus_ids);
create index if not exists vendors_contract_end_idx on public.vendors (org_id, contract_end) where contract_end is not null and deleted_at is null;

alter table public.vendor_documents drop constraint if exists vendor_documents_doc_type_check;
alter table public.vendor_documents add constraint vendor_documents_doc_type_check check (doc_type in (
  'gst_certificate', 'pan_card', 'cancelled_cheque', 'msme_certificate', 'incorporation', 'insurance', 'license',
  'agreement', 'contract', 'sla', 'work_completion', 'other'));

-- Vendor documents and agreements appear in the vendor's history.
create or replace function app.vendor_related_activity() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  r record;
  v_action text;
  v_meta jsonb;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if not exists (select 1 from public.vendors where id = r.vendor_id) then return null; end if;
  if tg_table_name = 'vendor_documents' then
    if tg_op = 'INSERT' then v_action := 'document_added';
    elsif tg_op = 'DELETE' then v_action := 'document_removed';
    elsif new.verification_status is distinct from old.verification_status then v_action := 'document_' || new.verification_status;
    else v_action := 'document_updated';
    end if;
    v_meta := jsonb_build_object('doc_type', r.doc_type, 'doc_number', r.doc_number, 'expires_on', r.expires_on, 'remarks', r.remarks);
  else
    v_action := case tg_op when 'INSERT' then 'agreement_added' when 'UPDATE' then 'agreement_updated' else 'agreement_removed' end;
    v_meta := jsonb_build_object('title', r.title, 'agreement_type', r.agreement_type, 'start_date', r.start_date,
      'end_date', r.end_date, 'status', r.status);
  end if;
  perform app.log_activity(r.org_id, 'vendor', r.vendor_id, v_action, null, v_meta);
  return null;
end $$;
create or replace trigger vendor_related_activity after insert or update or delete on public.vendor_documents
  for each row execute function app.vendor_related_activity();
create or replace trigger vendor_related_activity after insert or update or delete on public.vendor_agreements
  for each row execute function app.vendor_related_activity();

-- ---- access ---------------------------------------------------------------------
select app.enable_child_rls('public.asset_warranties', 'public.assets', 'asset_id', 'asset', 'campus_id', 'department_id');
-- condition history is a log: readable with the asset, added by managers or the
-- custodian, never edited or deleted
alter table public.asset_condition_logs enable row level security;
create policy acl_select on public.asset_condition_logs for select to authenticated
  using (exists (select 1 from public.assets p where p.id = asset_id));
create policy acl_insert on public.asset_condition_logs for insert to authenticated
  with check (exists (select 1 from public.assets p where p.id = asset_id
    and (app.can('asset:update', p.org_id, p.campus_id, p.department_id) or p.custodian_id = (select auth.uid()))));

select app.add_standard_triggers('public.asset_warranties');

-- ---- reminders ----------------------------------------------------------------
-- Extended warranties and vendor contracts ending soon (runs after the main expiry job).
create or replace function app.send_more_expiry_alerts(p_today date default current_date) returns int
language plpgsql security definer set search_path = public, app as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select w.*, a.name as asset_name, a.asset_tag, a.campus_id from public.asset_warranties w
    join public.assets a on a.id = w.asset_id
    where a.deleted_at is null and a.status <> 'disposed' and w.end_date between p_today and p_today + 30
      and app.module_enabled(w.org_id, 'facility')
  loop
    perform app.alert_once(r.org_id, array(select app.users_with_permission(r.org_id, 'asset:update', r.campus_id)),
      'reminder.warranty_expiry', 'Warranty expiring: ' || r.asset_name || ' (' || r.asset_tag || ')',
      initcap(r.warranty_type) || ' warranty' || coalesce(' from ' || r.provider, '') || ' ends ' || to_char(r.end_date, 'DD Mon YYYY'),
      'asset', r.asset_id, '/facility/assets/' || r.asset_id,
      'w:' || r.id || ':' || case when r.end_date <= p_today + 7 then '7d' else '30d' end);
    n := n + 1;
  end loop;

  for r in
    select * from public.vendors
    where deleted_at is null and status not in ('blacklisted', 'inactive', 'rejected') and contract_end is not null
      and contract_end between p_today - 1 and p_today + 30 and app.module_enabled(org_id, 'facility')
  loop
    perform app.alert_once(r.org_id, array(select app.users_with_permission(r.org_id, 'vendor:update')),
      'reminder.agreement_renewal', 'Vendor contract ending: ' || r.name,
      'Contract ends ' || to_char(r.contract_end, 'DD Mon YYYY'), 'vendor', r.id, '/facility/vendors/' || r.id,
      'contract:' || case when r.contract_end < p_today then 'expired' when r.contract_end <= p_today + 7 then '7d' else '30d' end);
    n := n + 1;
  end loop;
  return n;
end $$;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('expiry-alerts-more', '5 3 * * *', 'select app.send_more_expiry_alerts()');
  end if;
end $cron$;
