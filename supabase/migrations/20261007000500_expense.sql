-- =============================================================================
-- Expense Management: categories (with per-claim limits), budgets
-- (FY x campus x department x category) with amendments and carry-forward,
-- a budget ledger for commitments (approved POs) and actuals, expense claims,
-- advances, petty cash and recurring expenses.
-- =============================================================================

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  parent_id uuid references public.expense_categories(id) on delete set null,
  name text not null,
  code text not null check (code ~ '^[A-Z0-9_-]{1,16}$'),
  gl_code text,
  description text,
  per_claim_limit numeric(14, 2) check (per_claim_limit > 0),
  limit_mode text not null default 'soft' check (limit_mode in ('soft', 'hard')),
  receipt_required_above numeric(14, 2) default 0,
  applies_to text[] not null default '{expense,po}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);

-- -----------------------------------------------------------------------------
-- Budgets
-- -----------------------------------------------------------------------------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  fiscal_year_id uuid not null references public.fiscal_years(id) on delete restrict,
  campus_id uuid references public.campuses(id) on delete restrict,
  department_id uuid references public.departments(id) on delete restrict,
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  allocated_amount numeric(14, 2) not null default 0 check (allocated_amount >= 0),
  carried_forward_amount numeric(14, 2) not null default 0,
  control_mode text not null default 'soft' check (control_mode in ('none', 'soft', 'hard')),
  warning_threshold_pct numeric(5, 2) not null default 90,
  allow_carry_forward boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active', 'frozen', 'closed')),
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index budgets_uniq on public.budgets (org_id, fiscal_year_id,
  coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid), category_id);
create index on public.budgets (org_id, fiscal_year_id);

create table public.budget_amendments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  budget_id uuid not null references public.budgets(id) on delete cascade,
  campus_id uuid references public.campuses(id),
  department_id uuid references public.departments(id),
  amount_delta numeric(14, 2) not null check (amount_delta <> 0),
  reason text not null,
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected', 'cancelled')),
  approval_request_id uuid references public.approval_requests(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index on public.budget_amendments (budget_id);

-- Signed ledger. commitment: +reserve / -release. actual: +spend / -reversal.
create table public.budget_ledger (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organisations(id) on delete cascade,
  budget_id uuid not null references public.budgets(id) on delete cascade,
  entry_type text not null check (entry_type in ('commitment', 'actual')),
  amount numeric(14, 2) not null,
  source_type text not null,            -- purchase_order, grn, vendor_invoice, expense_claim, petty_cash ...
  source_id uuid not null,
  memo text,
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index on public.budget_ledger (budget_id, entry_type);
create index on public.budget_ledger (org_id, entry_date);
create index on public.budget_ledger (source_type, source_id);

create or replace view public.budget_summary
with (security_invoker = true) as
select b.id as budget_id, b.org_id, b.fiscal_year_id, b.campus_id, b.department_id, b.category_id,
  b.control_mode, b.status, b.warning_threshold_pct,
  b.allocated_amount,
  coalesce(am.total, 0) as amendments_amount,
  b.carried_forward_amount,
  b.allocated_amount + coalesce(am.total, 0) + b.carried_forward_amount as total_budget,
  coalesce(l.committed, 0) as committed_amount,
  coalesce(l.actual, 0) as actual_amount,
  b.allocated_amount + coalesce(am.total, 0) + b.carried_forward_amount - coalesce(l.committed, 0) - coalesce(l.actual, 0) as available_amount,
  case when b.allocated_amount + coalesce(am.total, 0) + b.carried_forward_amount = 0 then null
       else round(100 * (coalesce(l.committed, 0) + coalesce(l.actual, 0))
                  / (b.allocated_amount + coalesce(am.total, 0) + b.carried_forward_amount), 1) end as utilisation_pct
from public.budgets b
left join lateral (
  select sum(amount_delta) as total from public.budget_amendments a where a.budget_id = b.id and a.status = 'approved'
) am on true
left join lateral (
  select sum(amount) filter (where entry_type = 'commitment') as committed,
         sum(amount) filter (where entry_type = 'actual') as actual
  from public.budget_ledger x where x.budget_id = b.id
) l on true;

-- Most specific active budget line for a spend.
create or replace function app.find_budget(
  p_org uuid, p_fiscal_year uuid, p_campus uuid, p_department uuid, p_category uuid
) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.budgets
  where org_id = p_org and fiscal_year_id = p_fiscal_year and category_id = p_category
    and status in ('active', 'frozen')
    and (department_id = p_department or department_id is null)
    and (campus_id = p_campus or campus_id is null)
  order by (department_id is not null) desc, (campus_id is not null) desc
  limit 1
$$;

-- Check a prospective spend against the budget. Excludes the source's own
-- existing ledger entries so re-checks during approval are not double counted.
create or replace function public.budget_check(
  p_org uuid, p_date date, p_campus uuid, p_department uuid, p_category uuid, p_amount numeric,
  p_source_type text default null, p_source_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_fy uuid;
  v_budget uuid;
  s record;
  v_own numeric := 0;
  v_available numeric;
  v_result text;
begin
  select id into v_fy from public.fiscal_years where org_id = p_org and p_date between start_date and end_date limit 1;
  if v_fy is null then
    return jsonb_build_object('result', 'no_budget', 'message', 'No fiscal year configured for this date');
  end if;
  v_budget := app.find_budget(p_org, v_fy, p_campus, p_department, p_category);
  if v_budget is null then
    return jsonb_build_object('result', 'no_budget', 'fiscal_year_id', v_fy, 'message', 'No budget line for this category');
  end if;
  select * into s from public.budget_summary where budget_id = v_budget;
  if p_source_id is not null then
    select coalesce(sum(amount), 0) into v_own from public.budget_ledger
    where budget_id = v_budget and source_type = p_source_type and source_id = p_source_id;
  end if;
  v_available := s.available_amount + v_own;
  v_result := case
    when s.status = 'frozen' then 'blocked'
    when s.control_mode = 'none' then 'ok'
    when p_amount > v_available and s.control_mode = 'hard' then 'blocked'
    when p_amount > v_available then 'warning'
    when s.total_budget > 0 and 100 * (s.total_budget - v_available + p_amount) / s.total_budget >= s.warning_threshold_pct then 'warning'
    else 'ok' end;
  return jsonb_build_object(
    'result', v_result, 'budget_id', v_budget, 'fiscal_year_id', v_fy, 'control_mode', s.control_mode,
    'total_budget', s.total_budget, 'committed', s.committed_amount, 'actual', s.actual_amount,
    'available', v_available, 'requested', p_amount,
    'message', case v_result
      when 'blocked' then case when s.status = 'frozen' then 'Budget is frozen' else 'Exceeds available budget (hard limit)' end
      when 'warning' then case when p_amount > v_available then 'Exceeds available budget' else 'Budget utilisation above threshold' end
      else null end);
end $$;

create or replace function app.ledger_post(
  p_org uuid, p_budget uuid, p_type text, p_amount numeric, p_source_type text, p_source_id uuid,
  p_memo text default null, p_date date default current_date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_budget is null or coalesce(p_amount, 0) = 0 then return; end if;
  insert into public.budget_ledger (org_id, budget_id, entry_type, amount, source_type, source_id, memo, entry_date)
  values (p_org, p_budget, p_type, p_amount, p_source_type, p_source_id, p_memo, p_date);
end $$;

-- Carry forward unused amounts into the next FY's matching budget lines.
create or replace function public.budget_carry_forward(p_from_fy uuid, p_to_fy uuid, p_percent numeric default 100)
returns int
language plpgsql security definer set search_path = public, app as $$
declare
  v_org uuid;
  n int;
begin
  select org_id into v_org from public.fiscal_years where id = p_from_fy;
  if not app.has_permission(auth.uid(), 'budget:manage', v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fiscal_years where id = p_to_fy and org_id = v_org) then
    raise exception 'invalid target fiscal year' using errcode = '22023';
  end if;
  insert into public.budgets (org_id, fiscal_year_id, campus_id, department_id, category_id, allocated_amount,
    carried_forward_amount, control_mode, allow_carry_forward, status)
  select s.org_id, p_to_fy, s.campus_id, s.department_id, s.category_id, 0,
    round(greatest(s.available_amount, 0) * p_percent / 100, 2), s.control_mode, true, 'draft'
  from public.budget_summary s join public.budgets b on b.id = s.budget_id
  where s.fiscal_year_id = p_from_fy and b.allow_carry_forward and s.available_amount > 0
  on conflict (org_id, fiscal_year_id, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid), category_id)
  do update set carried_forward_amount = excluded.carried_forward_amount;
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Advances
-- -----------------------------------------------------------------------------
create table public.expense_advances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  number text not null,
  user_id uuid not null references public.profiles(id),
  campus_id uuid not null references public.campuses(id),
  department_id uuid references public.departments(id),
  category_id uuid references public.expense_categories(id),
  purpose text not null,
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected',
    'disbursed', 'settled', 'cancelled')),
  needed_by date,
  disbursed_at timestamptz,
  disbursement_reference text,
  settled_amount numeric(14, 2) not null default 0,
  approval_request_id uuid references public.approval_requests(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, number)
);
create index on public.expense_advances (org_id, user_id, status);

-- -----------------------------------------------------------------------------
-- Petty cash
-- -----------------------------------------------------------------------------
create table public.petty_cash_funds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid not null references public.campuses(id),
  department_id uuid references public.departments(id),
  name text not null,
  custodian_id uuid not null references public.profiles(id),
  float_amount numeric(14, 2) not null check (float_amount >= 0),
  balance numeric(14, 2) not null default 0,
  low_balance_threshold numeric(14, 2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.petty_cash_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  fund_id uuid not null references public.petty_cash_funds(id) on delete cascade,
  txn_type text not null check (txn_type in ('topup', 'expense', 'adjustment')),
  amount numeric(14, 2) not null check (amount > 0),
  direction smallint not null default -1 check (direction in (-1, 1)),
  category_id uuid references public.expense_categories(id),
  description text not null,
  txn_date date not null default current_date,
  claim_id uuid,
  receipt_attachment_id uuid references public.attachments(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.petty_cash_transactions (fund_id, txn_date desc);

create or replace function app.petty_cash_apply() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  f public.petty_cash_funds;
  v_delta numeric;
begin
  new.direction := case when new.txn_type = 'topup' then 1 when new.txn_type = 'expense' then -1 else new.direction end;
  v_delta := new.amount * new.direction;
  select * into f from public.petty_cash_funds where id = new.fund_id for update;
  if f.balance + v_delta < 0 then
    raise exception 'insufficient petty cash balance (available %)', f.balance using errcode = '23514';
  end if;
  update public.petty_cash_funds set balance = balance + v_delta where id = f.id;
  if new.txn_type = 'expense' and new.category_id is not null then
    perform app.ledger_post(new.org_id,
      app.find_budget(new.org_id, app.fiscal_year_for(new.org_id, new.txn_date), f.campus_id, f.department_id, new.category_id),
      'actual', new.amount, 'petty_cash', new.id, new.description, new.txn_date);
  end if;
  if f.balance + v_delta <= f.low_balance_threshold then
    perform app.notify(f.org_id, f.custodian_id, 'petty_cash.low_balance', 'Petty cash low: ' || f.name,
      'Balance ' || (f.balance + v_delta)::text, 'petty_cash_fund', f.id, '/expense/petty-cash');
  end if;
  return new;
end $$;
create trigger petty_cash_apply before insert on public.petty_cash_transactions
  for each row execute function app.petty_cash_apply();

-- -----------------------------------------------------------------------------
-- Recurring expenses (templates that generate claims)
-- -----------------------------------------------------------------------------
create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  campus_id uuid not null references public.campuses(id),
  department_id uuid references public.departments(id),
  category_id uuid not null references public.expense_categories(id),
  vendor_id uuid references public.vendors(id),
  title text not null,
  description text,
  amount numeric(14, 2) not null check (amount > 0),
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly')),
  next_run_date date not null,
  end_date date,
  auto_submit boolean not null default false,
  active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Expense claims
-- -----------------------------------------------------------------------------
create table public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  number text not null,
  claim_type text not null default 'reimbursement' check (claim_type in ('reimbursement', 'advance_settlement', 'petty_cash_replenishment', 'vendor_direct')),
  campus_id uuid not null references public.campuses(id),
  department_id uuid references public.departments(id),
  claimant_id uuid not null references public.profiles(id),
  advance_id uuid references public.expense_advances(id),
  vendor_id uuid references public.vendors(id),
  recurring_expense_id uuid references public.recurring_expenses(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'paid', 'cancelled')),
  total_amount numeric(14, 2) not null default 0,
  currency char(3) not null default 'INR',
  fiscal_year_id uuid references public.fiscal_years(id),
  budget_checks jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  payment_method text check (payment_method in ('bank_transfer', 'upi', 'cheque', 'cash', 'payroll')),
  approval_request_id uuid references public.approval_requests(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, number)
);
create index on public.expense_claims (org_id, status, submitted_at desc) where deleted_at is null;
create index on public.expense_claims (claimant_id, status);
create index on public.expense_claims (org_id, campus_id, department_id);

create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  claim_id uuid not null references public.expense_claims(id) on delete cascade,
  category_id uuid not null references public.expense_categories(id),
  expense_date date not null,
  description text not null,
  merchant text,
  amount numeric(14, 2) not null check (amount > 0),
  tax_amount numeric(14, 2) not null default 0 check (tax_amount >= 0),
  receipt_attachment_id uuid references public.attachments(id) on delete set null,
  budget_id uuid references public.budgets(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.expense_items (claim_id);
create index on public.expense_items (org_id, category_id, expense_date);

alter table public.petty_cash_transactions
  add constraint petty_cash_claim_fk foreign key (claim_id) references public.expense_claims(id) on delete set null;

create or replace function app.expense_claims_before() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if tg_op = 'INSERT' then
    if new.number is null or new.number = '' then
      new.number := app.next_number(new.org_id, 'expense_claim', new.campus_id);
    end if;
    select currency into new.currency from public.organisations where id = new.org_id;
    new.status := case when app.in_system_update() then new.status else 'draft' end;
    return new;
  end if;
  -- status changes go through the RPCs below (system updates), except
  -- draft -> cancelled by the claimant.
  if new.status <> old.status and not app.in_system_update() and auth.uid() is not null
     and not (old.status in ('draft', 'rejected') and new.status = 'cancelled') then
    raise exception 'use the submit/approve/pay actions to change claim status' using errcode = '42501';
  end if;
  if old.status not in ('draft', 'rejected') and not app.in_system_update() and auth.uid() is not null
     and (new.title, new.description, new.campus_id, new.department_id, new.total_amount)
         is distinct from (old.title, old.description, old.campus_id, old.department_id, old.total_amount) then
    raise exception 'claim can only be edited while in draft' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger expense_claims_before before insert or update on public.expense_claims
  for each row execute function app.expense_claims_before();

create or replace function app.expense_items_after() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_claim uuid := coalesce(new.claim_id, old.claim_id);
  v_status text;
begin
  select status into v_status from public.expense_claims where id = v_claim;
  if v_status not in ('draft', 'rejected') and not app.in_system_update() then
    raise exception 'items can only be changed while the claim is a draft' using errcode = '42501';
  end if;
  perform app.begin_system_update();
  update public.expense_claims set total_amount = (
    select coalesce(sum(amount + tax_amount), 0) from public.expense_items where claim_id = v_claim)
  where id = v_claim;
  perform app.end_system_update();
  return null;
end $$;
create trigger expense_items_after after insert or update or delete on public.expense_items
  for each row execute function app.expense_items_after();

-- Submit a claim for approval: validates items, receipts, category limits and
-- budgets (hard limits block, soft limits warn), then hands over to the
-- approval engine (which may auto-approve below the configured threshold).
create or replace function public.expense_claim_submit(p_claim_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  c public.expense_claims;
  it record;
  v_checks jsonb := '[]'::jsonb;
  v_check jsonb;
  v_fy uuid;
  v_request uuid;
  v_categories uuid[];
  v_status text;
  v_actor uuid := app.actor_id();
begin
  select * into c from public.expense_claims where id = p_claim_id for update;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  if v_actor is distinct from c.claimant_id and v_actor is distinct from c.created_by
     and not app.has_permission(v_actor, 'expense:update', c.org_id, c.campus_id, c.department_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not app.module_enabled(c.org_id, 'expense') then raise exception 'expense module disabled' using errcode = '42501'; end if;
  if c.status not in ('draft', 'rejected') then
    raise exception 'claim is already %', c.status using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.expense_items where claim_id = c.id) then
    raise exception 'add at least one expense item' using errcode = '23514';
  end if;

  -- receipts & per-claim category limits
  for it in
    select i.category_id, ec.name, ec.per_claim_limit, ec.limit_mode, ec.receipt_required_above,
           sum(i.amount + i.tax_amount) as total,
           bool_or(i.receipt_attachment_id is null and (i.amount + i.tax_amount) > coalesce(ec.receipt_required_above, 0)) as missing_receipt
    from public.expense_items i join public.expense_categories ec on ec.id = i.category_id
    where i.claim_id = c.id group by i.category_id, ec.name, ec.per_claim_limit, ec.limit_mode, ec.receipt_required_above
  loop
    if it.missing_receipt and not exists (
      select 1 from public.attachments a where a.entity_type = 'expense_claim' and a.entity_id = c.id and a.deleted_at is null) then
      raise exception 'receipt required for % items', it.name using errcode = '23514';
    end if;
    if it.per_claim_limit is not null and it.total > it.per_claim_limit then
      if it.limit_mode = 'hard' then
        raise exception '% exceeds the per-claim limit of %', it.name, it.per_claim_limit using errcode = '23514';
      end if;
      v_checks := v_checks || jsonb_build_object('category_id', it.category_id, 'result', 'warning',
        'message', it.name || ' exceeds the per-claim limit of ' || it.per_claim_limit);
    end if;
  end loop;

  -- budget checks per category
  v_fy := app.fiscal_year_for(c.org_id, (select min(expense_date) from public.expense_items where claim_id = c.id));
  for it in
    select i.category_id, sum(i.amount + i.tax_amount) as total, min(i.expense_date) as d
    from public.expense_items i where i.claim_id = c.id group by i.category_id
  loop
    v_check := public.budget_check(c.org_id, it.d, c.campus_id, c.department_id, it.category_id, it.total,
                                   'expense_claim', c.id);
    if v_check ->> 'result' = 'blocked' then
      raise exception 'Budget check failed: %', v_check ->> 'message' using errcode = '23514';
    end if;
    v_checks := v_checks || (v_check || jsonb_build_object('category_id', it.category_id));
    update public.expense_items set budget_id = (v_check ->> 'budget_id')::uuid
    where claim_id = c.id and category_id = it.category_id;
  end loop;

  select array_agg(distinct category_id) into v_categories from public.expense_items where claim_id = c.id;
  perform app.begin_system_update();
  update public.expense_claims set status = 'pending_approval', submitted_at = now(), fiscal_year_id = v_fy,
    budget_checks = v_checks, rejected_at = null
  where id = c.id;
  perform app.end_system_update();

  v_request := app.approval_create(c.org_id, 'expense', 'expense_claim', c.id, c.campus_id, c.department_id,
    c.total_amount, v_categories, c.number || ' · ' || c.title, c.claimant_id,
    jsonb_build_object('claim_type', c.claim_type, 'budget_checks', v_checks));
  perform app.begin_system_update();
  update public.expense_claims set approval_request_id = v_request where id = c.id;
  perform app.end_system_update();
  select status into v_status from public.expense_claims where id = c.id;
  return jsonb_build_object('status', v_status, 'approval_request_id', v_request, 'budget_checks', v_checks);
end $$;

create or replace function app.expense_claim_on_decision(p_request_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  r public.approval_requests;
  c public.expense_claims;
  it record;
begin
  select * into r from public.approval_requests where id = p_request_id;
  select * into c from public.expense_claims where id = r.entity_id for update;
  perform app.begin_system_update();
  if p_status = 'approved' then
    update public.expense_claims set status = 'approved', approved_at = now() where id = c.id;
    for it in select budget_id, sum(amount + tax_amount) as total, max(expense_date) as d
              from public.expense_items where claim_id = c.id and budget_id is not null group by budget_id loop
      perform app.ledger_post(c.org_id, it.budget_id, 'actual', it.total, 'expense_claim', c.id, c.number, it.d);
    end loop;
    if c.advance_id is not null then
      update public.expense_advances set settled_amount = settled_amount + c.total_amount,
        status = case when settled_amount + c.total_amount >= amount then 'settled' else status end
      where id = c.advance_id;
    end if;
  elsif p_status = 'rejected' then
    update public.expense_claims set status = 'rejected', rejected_at = now() where id = c.id;
  elsif p_status = 'cancelled' then
    update public.expense_claims set status = 'draft' where id = c.id;
  end if;
  perform app.end_system_update();
end $$;

create or replace function public.expense_claim_mark_paid(
  p_claim_id uuid, p_reference text, p_method text default 'bank_transfer'
) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  c public.expense_claims;
begin
  select * into c from public.expense_claims where id = p_claim_id for update;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  if not app.has_permission(app.actor_id(), 'expense:pay', c.org_id, c.campus_id, c.department_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.status <> 'approved' then raise exception 'only approved claims can be paid' using errcode = 'P0001'; end if;
  perform app.begin_system_update();
  update public.expense_claims set status = 'paid', paid_at = now(), payment_reference = p_reference,
    payment_method = p_method where id = c.id;
  perform app.end_system_update();
  perform app.notify(c.org_id, c.claimant_id, 'expense.paid', 'Reimbursed: ' || c.number,
    'Reference ' || coalesce(p_reference, '-'), 'expense_claim', c.id, '/expense/claims/' || c.id);
end $$;

-- Advances
create or replace function app.expense_advances_before() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if tg_op = 'INSERT' then
    new.number := app.next_number(new.org_id, 'advance', new.campus_id);
    if not app.in_system_update() then new.status := 'draft'; end if;
  elsif new.status <> old.status and not app.in_system_update() and auth.uid() is not null
        and not (old.status = 'draft' and new.status = 'cancelled') then
    raise exception 'use the advance actions to change status' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger expense_advances_before before insert or update on public.expense_advances
  for each row execute function app.expense_advances_before();

create or replace function public.expense_advance_submit(p_advance_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  a public.expense_advances;
  v_request uuid;
begin
  select * into a from public.expense_advances where id = p_advance_id for update;
  if not found then raise exception 'advance not found' using errcode = 'P0002'; end if;
  if app.actor_id() is distinct from a.user_id and app.actor_id() is distinct from a.created_by then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status <> 'draft' then raise exception 'advance is already %', a.status using errcode = 'P0001'; end if;
  if exists (select 1 from public.expense_advances where user_id = a.user_id and org_id = a.org_id
             and status in ('approved', 'disbursed') and id <> a.id
             and (select coalesce((settings ->> 'single_open_advance')::boolean, true) from public.org_modules
                  where org_id = a.org_id and module = 'expense')) then
    raise exception 'settle your open advance before requesting another' using errcode = 'P0001';
  end if;
  perform app.begin_system_update();
  update public.expense_advances set status = 'pending_approval' where id = a.id;
  perform app.end_system_update();
  v_request := app.approval_create(a.org_id, 'expense', 'expense_advance', a.id, a.campus_id, a.department_id,
    a.amount, case when a.category_id is null then '{}'::uuid[] else array[a.category_id] end,
    a.number || ' · ' || a.purpose, a.user_id);
  perform app.begin_system_update();
  update public.expense_advances set approval_request_id = v_request where id = a.id;
  perform app.end_system_update();
  return jsonb_build_object('status', (select status from public.expense_advances where id = a.id), 'approval_request_id', v_request);
end $$;

create or replace function app.expense_advance_on_decision(p_request_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_id uuid;
begin
  select entity_id into v_id from public.approval_requests where id = p_request_id;
  perform app.begin_system_update();
  update public.expense_advances set status = case p_status when 'approved' then 'approved'
    when 'rejected' then 'rejected' else 'draft' end where id = v_id;
  perform app.end_system_update();
end $$;

create or replace function public.expense_advance_disburse(p_advance_id uuid, p_reference text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  a public.expense_advances;
begin
  select * into a from public.expense_advances where id = p_advance_id for update;
  if not app.has_permission(app.actor_id(), 'expense:pay', a.org_id, a.campus_id, a.department_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status <> 'approved' then raise exception 'advance must be approved first' using errcode = 'P0001'; end if;
  perform app.begin_system_update();
  update public.expense_advances set status = 'disbursed', disbursed_at = now(), disbursement_reference = p_reference
  where id = a.id;
  perform app.end_system_update();
  perform app.notify(a.org_id, a.user_id, 'expense.advance_disbursed', 'Advance disbursed: ' || a.number,
    null, 'expense_advance', a.id, '/expense/advances');
end $$;

-- Budget amendments go through the approval engine as well.
create or replace function public.budget_amendment_request(p_budget_id uuid, p_delta numeric, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  b public.budgets;
  v_id uuid;
  v_request uuid;
begin
  select * into b from public.budgets where id = p_budget_id;
  if not found then raise exception 'budget not found' using errcode = 'P0002'; end if;
  if not app.has_permission(app.actor_id(), 'budget:update', b.org_id, b.campus_id, b.department_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.budget_amendments (org_id, budget_id, campus_id, department_id, amount_delta, reason, created_by)
  values (b.org_id, b.id, b.campus_id, b.department_id, p_delta, p_reason, app.actor_id()) returning id into v_id;
  v_request := app.approval_create(b.org_id, 'expense', 'budget_amendment', v_id, b.campus_id, b.department_id,
    abs(p_delta), array[b.category_id], 'Budget amendment ' || p_delta::text, app.actor_id(),
    jsonb_build_object('budget_id', b.id, 'reason', p_reason));
  update public.budget_amendments set approval_request_id = v_request where id = v_id and approval_request_id is null;
  return v_id;
end $$;

create or replace function app.budget_amendment_on_decision(p_request_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  update public.budget_amendments set status = case p_status when 'approved' then 'approved'
    when 'rejected' then 'rejected' else 'cancelled' end, decided_at = now()
  where id = (select entity_id from public.approval_requests where id = p_request_id);
end $$;

insert into app.approval_handlers (entity_type, handler) values
  ('expense_claim', 'app.expense_claim_on_decision(uuid,text)'),
  ('expense_advance', 'app.expense_advance_on_decision(uuid,text)'),
  ('budget_amendment', 'app.budget_amendment_on_decision(uuid,text)');

-- Generate claims from recurring expenses (pg_cron daily).
create or replace function app.run_recurring_expenses(p_today date default current_date) returns int
language plpgsql security definer set search_path = public, app as $$
declare
  r public.recurring_expenses;
  v_claim uuid;
  n int := 0;
begin
  for r in select * from public.recurring_expenses
           where active and next_run_date <= p_today and (end_date is null or next_run_date <= end_date)
           for update skip locked
  loop
    if not app.module_enabled(r.org_id, 'expense') then continue; end if;
    insert into public.expense_claims (org_id, claim_type, campus_id, department_id, claimant_id, vendor_id,
      recurring_expense_id, title, description, created_by, number)
    values (r.org_id, case when r.vendor_id is not null then 'vendor_direct' else 'reimbursement' end,
      r.campus_id, r.department_id, r.owner_id, r.vendor_id, r.id,
      r.title || ' (' || to_char(r.next_run_date, 'Mon YYYY') || ')', r.description, r.owner_id, '')
    returning id into v_claim;
    insert into public.expense_items (org_id, claim_id, category_id, expense_date, description, amount)
    values (r.org_id, v_claim, r.category_id, r.next_run_date, r.title, r.amount);
    if r.auto_submit then
      begin
        perform set_config('request.jwt.claim.sub', r.owner_id::text, true);
        perform public.expense_claim_submit(v_claim);
        perform set_config('request.jwt.claim.sub', '', true);
      exception when others then
        perform set_config('request.jwt.claim.sub', '', true);
        perform app.notify(r.org_id, r.owner_id, 'reminder.recurring_expense_failed',
          'Recurring expense needs attention', sqlerrm, 'expense_claim', v_claim, '/expense/claims/' || v_claim);
      end;
    else
      perform app.notify(r.org_id, r.owner_id, 'reminder.recurring_expense', 'Recurring expense drafted: ' || r.title,
        null, 'expense_claim', v_claim, '/expense/claims/' || v_claim);
    end if;
    update public.recurring_expenses set last_run_at = now(), next_run_date = case frequency
      when 'weekly' then next_run_date + 7
      when 'monthly' then (next_run_date + interval '1 month')::date
      when 'quarterly' then (next_run_date + interval '3 months')::date
      when 'half_yearly' then (next_run_date + interval '6 months')::date
      else (next_run_date + interval '1 year')::date end
    where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Dashboard RPC: budget vs committed vs actual grouped by department, category or campus.
create or replace function public.budget_dashboard(p_org uuid, p_fiscal_year uuid, p_group_by text default 'department')
returns table (group_id uuid, group_name text, total_budget numeric, committed numeric, actual numeric,
               available numeric, utilisation_pct numeric)
language sql stable security invoker as $$
  select
    case p_group_by when 'category' then s.category_id when 'campus' then s.campus_id else s.department_id end,
    coalesce(case p_group_by when 'category' then ec.name when 'campus' then c.name else d.name end, 'Unassigned'),
    sum(s.total_budget), sum(s.committed_amount), sum(s.actual_amount), sum(s.available_amount),
    case when sum(s.total_budget) = 0 then null
         else round(100 * (sum(s.committed_amount) + sum(s.actual_amount)) / sum(s.total_budget), 1) end
  from public.budget_summary s
  left join public.expense_categories ec on ec.id = s.category_id
  left join public.campuses c on c.id = s.campus_id
  left join public.departments d on d.id = s.department_id
  where s.org_id = p_org and s.fiscal_year_id = p_fiscal_year
  group by 1, 2
  order by 3 desc
$$;

create or replace function public.budget_monthly(p_org uuid, p_fiscal_year uuid)
returns table (month date, committed numeric, actual numeric)
language sql stable security invoker as $$
  select date_trunc('month', l.entry_date)::date,
    sum(l.amount) filter (where l.entry_type = 'commitment'),
    sum(l.amount) filter (where l.entry_type = 'actual')
  from public.budget_ledger l join public.budgets b on b.id = l.budget_id
  where l.org_id = p_org and b.fiscal_year_id = p_fiscal_year
  group by 1 order by 1
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.expense_categories enable row level security;
create policy ecat_select on public.expense_categories for select to authenticated using (org_id in (select app.my_org_ids()));
create policy ecat_write on public.expense_categories for all to authenticated
  using (app.can('budget:manage', org_id, null, null, true)) with check (app.can('budget:manage', org_id, null, null, true));

select app.enable_standard_rls('public.budgets', 'budget', 'campus_id', 'department_id');
alter table public.budget_amendments enable row level security;
create policy bam_select on public.budget_amendments for select to authenticated
  using (app.can('budget:read', org_id, campus_id, department_id) or created_by = (select auth.uid()));
alter table public.budget_ledger enable row level security;
create policy bl_select on public.budget_ledger for select to authenticated
  using (exists (select 1 from public.budgets b where b.id = budget_id));

select app.enable_standard_rls('public.expense_claims', 'expense', 'campus_id', 'department_id',
  array['claimant_id', 'created_by'], true);
-- staff can raise their own claims
create policy claims_own_insert on public.expense_claims for insert to authenticated
  with check (claimant_id = (select auth.uid()) and app.can('expense:submit', org_id, campus_id, department_id));
select app.enable_child_rls('public.expense_items', 'public.expense_claims', 'claim_id', 'expense',
  'campus_id', 'department_id', array['claimant_id', 'created_by']);

select app.enable_standard_rls('public.expense_advances', 'expense', 'campus_id', 'department_id',
  array['user_id', 'created_by'], true);
create policy advances_own_insert on public.expense_advances for insert to authenticated
  with check (user_id = (select auth.uid()) and app.can('expense:submit', org_id, campus_id, department_id));

select app.enable_standard_rls('public.petty_cash_funds', 'petty_cash', 'campus_id', 'department_id', array['custodian_id']);
alter table public.petty_cash_transactions enable row level security;
create policy pct_select on public.petty_cash_transactions for select to authenticated
  using (exists (select 1 from public.petty_cash_funds f where f.id = fund_id));
create policy pct_insert on public.petty_cash_transactions for insert to authenticated
  with check (exists (select 1 from public.petty_cash_funds f where f.id = fund_id
              and (f.custodian_id = (select auth.uid()) or app.can('petty_cash:update', f.org_id, f.campus_id, f.department_id)))
              and (txn_type = 'expense' or app.can('petty_cash:update', org_id)));

select app.enable_standard_rls('public.recurring_expenses', 'expense', 'campus_id', 'department_id', array['owner_id'], true);

select app.add_standard_triggers(t) from unnest(array[
  'public.expense_categories', 'public.budgets', 'public.expense_advances', 'public.petty_cash_funds',
  'public.recurring_expenses', 'public.expense_claims', 'public.expense_items'
]::regclass[]) t;
select app.add_audit('public.budgets', 'budget');
select app.add_audit('public.expense_claims', 'expense_claim');
select app.add_audit('public.expense_advances', 'expense_advance');
select app.add_audit('public.petty_cash_funds', 'petty_cash_fund');
select app.add_events('public.expense_claims', 'expense_claim');
select app.add_events('public.expense_advances', 'expense_advance');
select app.add_events('public.budgets', 'budget');

insert into app.entity_registry (entity_type, table_name, resource, module, campus_col, dept_col, owner_cols, title_col, number_col, url_template) values
  ('expense_claim', 'public.expense_claims', 'expense', 'expense', 'campus_id', 'department_id', '{claimant_id,created_by}', 'title', 'number', '/expense/claims/{id}'),
  ('expense_advance', 'public.expense_advances', 'expense', 'expense', 'campus_id', 'department_id', '{user_id,created_by}', 'purpose', 'number', '/expense/advances/{id}'),
  ('budget', 'public.budgets', 'budget', 'expense', 'campus_id', 'department_id', '{}', 'notes', null, '/expense/budgets/{id}'),
  ('budget_amendment', 'public.budget_amendments', 'budget', 'expense', 'campus_id', 'department_id', '{created_by}', 'reason', null, '/expense/budgets'),
  ('petty_cash_fund', 'public.petty_cash_funds', 'petty_cash', 'expense', 'campus_id', 'department_id', '{custodian_id}', 'name', null, '/expense/petty-cash/{id}');
