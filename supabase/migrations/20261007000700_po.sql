-- =============================================================================
-- PO Management: requisition/indent > RFQ & quote comparison > approval > PO >
-- vendor acknowledgement > GRN (partial receipts) > invoice with 3-way match >
-- payment tracking > close. Budget commitments, PO versioning/amendments,
-- GST lines, configurable number series per campus/financial year.
-- =============================================================================

create table public.items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  sku text,
  description text,
  unit text not null default 'nos',
  hsn_sac text,
  gst_rate numeric(5, 2) not null default 18 check (gst_rate in (0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28)),
  expense_category_id uuid references public.expense_categories(id) on delete set null,
  is_asset boolean not null default false,
  asset_category_id uuid references public.asset_categories(id) on delete set null,
  last_price numeric(14, 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on public.items (org_id, sku) where sku is not null;
create index on public.items using gin (name extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Requisitions
-- -----------------------------------------------------------------------------
create table public.requisitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  number text not null,
  campus_id uuid not null references public.campuses(id),
  department_id uuid references public.departments(id),
  category_id uuid references public.expense_categories(id),
  requested_by uuid not null references public.profiles(id),
  title text not null,
  justification text,
  needed_by date,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected',
    'rfq', 'ordered', 'closed', 'cancelled')),
  estimated_total numeric(14, 2) not null default 0,
  budget_check jsonb,
  approval_request_id uuid references public.approval_requests(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, number)
);
create index on public.requisitions (org_id, status, created_at desc) where deleted_at is null;

create table public.requisition_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  requisition_id uuid not null references public.requisitions(id) on delete cascade,
  item_id uuid references public.items(id),
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit text not null default 'nos',
  estimated_unit_price numeric(14, 2) not null default 0 check (estimated_unit_price >= 0),
  line_total numeric(14, 2) generated always as (round(quantity * estimated_unit_price, 2)) stored,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.requisition_lines (requisition_id);

-- -----------------------------------------------------------------------------
-- RFQs & quotes
-- -----------------------------------------------------------------------------
create table public.rfqs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  number text not null,
  requisition_id uuid references public.requisitions(id) on delete set null,
  campus_id uuid not null references public.campuses(id),
  department_id uuid references public.departments(id),
  title text not null,
  terms text,
  due_date date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'closed', 'awarded', 'cancelled')),
  awarded_quote_id uuid,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, number)
);

create table public.rfq_vendors (
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  declined boolean not null default false,
  primary key (rfq_id, vendor_id)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  quote_reference text,
  valid_until date,
  delivery_days int,
  payment_terms text,
  notes text,
  subtotal numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  status text not null default 'received' check (status in ('received', 'shortlisted', 'awarded', 'rejected')),
  submitted_via text not null default 'manual' check (submitted_via in ('manual', 'portal', 'api')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rfq_id, vendor_id)
);

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  requisition_line_id uuid references public.requisition_lines(id) on delete set null,
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  tax_rate numeric(5, 2) not null default 18,
  line_total numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored,
  tax_amount numeric(14, 2) generated always as (round(quantity * unit_price * tax_rate / 100, 2)) stored
);
create index on public.quote_lines (quote_id);

alter table public.rfqs add constraint rfqs_awarded_fk foreign key (awarded_quote_id) references public.quotes(id) on delete set null;

create or replace function app.quote_lines_rollup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_quote uuid := coalesce(new.quote_id, old.quote_id);
begin
  update public.quotes q set
    subtotal = coalesce((select sum(line_total) from public.quote_lines where quote_id = v_quote), 0),
    tax_total = coalesce((select sum(tax_amount) from public.quote_lines where quote_id = v_quote), 0),
    total = coalesce((select sum(line_total + tax_amount) from public.quote_lines where quote_id = v_quote), 0)
  where q.id = v_quote;
  return null;
end $$;
create trigger quote_lines_rollup after insert or update or delete on public.quote_lines
  for each row execute function app.quote_lines_rollup();

-- Side-by-side comparison per requisition line.
create or replace view public.rfq_quote_comparison
with (security_invoker = true) as
select q.rfq_id, q.org_id, ql.requisition_line_id, coalesce(rl.description, ql.description) as description,
  q.id as quote_id, q.vendor_id, v.name as vendor_name, ql.quantity, ql.unit_price, ql.tax_rate,
  ql.line_total, ql.tax_amount, q.total as quote_total, q.delivery_days, q.valid_until, v.rating_avg,
  ql.unit_price = min(ql.unit_price) over (partition by q.rfq_id, coalesce(ql.requisition_line_id::text, ql.description)) as is_lowest_line,
  q.total = min(q.total) over (partition by q.rfq_id) as is_lowest_total
from public.quotes q
join public.quote_lines ql on ql.quote_id = q.id
join public.vendors v on v.id = q.vendor_id
left join public.requisition_lines rl on rl.id = ql.requisition_line_id
where q.status <> 'rejected';

-- -----------------------------------------------------------------------------
-- Purchase orders
-- -----------------------------------------------------------------------------
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  number text not null,
  version int not null default 1,
  campus_id uuid not null references public.campuses(id),
  department_id uuid references public.departments(id),
  category_id uuid references public.expense_categories(id),
  vendor_id uuid not null references public.vendors(id),
  requisition_id uuid references public.requisitions(id) on delete set null,
  rfq_id uuid references public.rfqs(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  fiscal_year_id uuid references public.fiscal_years(id),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'sent',
    'acknowledged', 'partially_received', 'received', 'closed', 'cancelled')),
  order_date date not null default current_date,
  expected_delivery date,
  delivery_location_id uuid references public.locations(id),
  billing_address text,
  shipping_address text,
  payment_terms text,
  terms_and_conditions text,
  notes text,
  currency char(3) not null default 'INR',
  tax_type text not null default 'cgst_sgst' check (tax_type in ('cgst_sgst', 'igst', 'none')),
  subtotal numeric(14, 2) not null default 0,
  discount_total numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  budget_check jsonb,
  approval_request_id uuid references public.approval_requests(id),
  approved_at timestamptz,
  sent_at timestamptz,
  vendor_ack_at timestamptz,
  vendor_ack_name text,
  vendor_ack_note text,
  closed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  amendment_reason text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, number)
);
create index on public.purchase_orders (org_id, status, order_date desc) where deleted_at is null;
create index on public.purchase_orders (vendor_id);
create index on public.purchase_orders (org_id, campus_id, department_id);

create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  line_no int not null,
  item_id uuid references public.items(id),
  requisition_line_id uuid references public.requisition_lines(id) on delete set null,
  description text not null,
  hsn_sac text,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit text not null default 'nos',
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate numeric(5, 2) not null default 18 check (tax_rate between 0 and 28),
  taxable_amount numeric(14, 2) not null default 0,
  cgst_amount numeric(14, 2) not null default 0,
  sgst_amount numeric(14, 2) not null default 0,
  igst_amount numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null default 0,     -- taxable + tax
  received_qty numeric(14, 3) not null default 0,
  invoiced_qty numeric(14, 3) not null default 0,
  is_asset boolean not null default false,
  asset_category_id uuid references public.asset_categories(id),
  unique (po_id, line_no)
);
create index on public.po_lines (po_id);

create table public.po_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,                 -- header + lines as they were
  change_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (po_id, version)
);

create or replace function app.po_lines_compute() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_tax_type text;
  v_tax numeric;
begin
  if not app.in_system_update() and exists (select 1 from public.purchase_orders
         where id = new.po_id and status not in ('draft', 'rejected')) then
    raise exception 'PO lines can only be changed while the PO is a draft (amend it first)' using errcode = '42501';
  end if;
  select tax_type into v_tax_type from public.purchase_orders where id = new.po_id;
  if tg_op = 'INSERT' and (new.line_no is null or new.line_no = 0) then
    new.line_no := coalesce((select max(line_no) from public.po_lines where po_id = new.po_id), 0) + 1;
  end if;
  new.taxable_amount := round(new.quantity * new.unit_price * (1 - new.discount_pct / 100), 2);
  v_tax := case when v_tax_type = 'none' then 0 else round(new.taxable_amount * new.tax_rate / 100, 2) end;
  if v_tax_type = 'igst' then
    new.igst_amount := v_tax; new.cgst_amount := 0; new.sgst_amount := 0;
  else
    new.cgst_amount := round(v_tax / 2, 2); new.sgst_amount := v_tax - round(v_tax / 2, 2); new.igst_amount := 0;
  end if;
  new.line_total := new.taxable_amount + v_tax;
  return new;
end $$;
create trigger po_lines_compute before insert or update of quantity, unit_price, discount_pct, tax_rate, description, item_id
  on public.po_lines for each row execute function app.po_lines_compute();

create or replace function app.po_lines_rollup() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_po uuid := coalesce(new.po_id, old.po_id);
begin
  if tg_op = 'DELETE' and not app.in_system_update() and exists (select 1 from public.purchase_orders
         where id = v_po and status not in ('draft', 'rejected')) then
    raise exception 'PO lines can only be changed while the PO is a draft' using errcode = '42501';
  end if;
  perform app.begin_system_update();
  update public.purchase_orders p set
    subtotal = coalesce(x.gross, 0), discount_total = coalesce(x.gross - x.taxable, 0),
    tax_total = coalesce(x.tax, 0), total = coalesce(x.total, 0)
  from (select sum(round(quantity * unit_price, 2)) as gross, sum(taxable_amount) as taxable,
               sum(cgst_amount + sgst_amount + igst_amount) as tax, sum(line_total) as total
        from public.po_lines where po_id = v_po) x
  where p.id = v_po;
  perform app.end_system_update();
  return null;
end $$;
create trigger po_lines_rollup after insert or update or delete on public.po_lines
  for each row execute function app.po_lines_rollup();

-- Inter-state supply (vendor GSTIN state code differs from campus GSTIN) => IGST.
create or replace function app.po_tax_type(p_vendor uuid, p_campus uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when v.gstin is null or c.gstin is null then 'cgst_sgst'
    when left(v.gstin, 2) <> left(c.gstin, 2) then 'igst'
    else 'cgst_sgst' end
  from public.vendors v, public.campuses c where v.id = p_vendor and c.id = p_campus
$$;

create or replace function app.purchase_orders_before() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if tg_op = 'INSERT' then
    if new.number is null or new.number = '' then
      new.number := app.next_number(new.org_id, 'purchase_order', new.campus_id, new.order_date);
    end if;
    select currency into new.currency from public.organisations where id = new.org_id;
    new.tax_type := coalesce(app.po_tax_type(new.vendor_id, new.campus_id), new.tax_type);
    new.fiscal_year_id := app.fiscal_year_for(new.org_id, new.order_date);
    if not app.in_system_update() then new.status := 'draft'; end if;
    if not exists (select 1 from public.vendors where id = new.vendor_id and org_id = new.org_id
                   and status = 'approved') then
      raise exception 'purchase orders can only be raised on approved vendors' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.status <> old.status and not app.in_system_update() and auth.uid() is not null then
    raise exception 'use the PO actions to change status' using errcode = '42501';
  end if;
  if old.status not in ('draft', 'rejected') and not app.in_system_update() and auth.uid() is not null
     and (new.vendor_id, new.campus_id, new.department_id, new.category_id, new.total, new.tax_type)
         is distinct from (old.vendor_id, old.campus_id, old.department_id, old.category_id, old.total, old.tax_type) then
    raise exception 'amend the PO to change it after submission' using errcode = '42501';
  end if;
  if new.vendor_id <> old.vendor_id or new.campus_id <> old.campus_id then
    new.tax_type := coalesce(app.po_tax_type(new.vendor_id, new.campus_id), new.tax_type);
  end if;
  return new;
end $$;
create trigger purchase_orders_before before insert or update on public.purchase_orders
  for each row execute function app.purchase_orders_before();

-- Outstanding (unreceived/uninvoiced) value of a PO, used for commitments.
create or replace function app.po_open_value(p_po uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(round(greatest(quantity - invoiced_qty, 0) / quantity * line_total, 2)), 0)
  from public.po_lines where po_id = p_po
$$;

-- Move the PO's commitment to match its open value.
create or replace function app.po_sync_commitment(p_po uuid, p_memo text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  p public.purchase_orders;
  v_budget uuid;
  v_current numeric;
  v_target numeric;
begin
  select * into p from public.purchase_orders where id = p_po;
  if p.category_id is null then return; end if;
  select budget_id, sum(amount) into v_budget, v_current from public.budget_ledger
  where source_type = 'purchase_order' and source_id = p.id and entry_type = 'commitment'
  group by budget_id order by sum(amount) desc limit 1;
  v_budget := coalesce(v_budget, app.find_budget(p.org_id, p.fiscal_year_id, p.campus_id, p.department_id, p.category_id));
  v_target := case when p.status in ('cancelled', 'closed', 'rejected', 'draft') then 0 else app.po_open_value(p.id) end;
  perform app.ledger_post(p.org_id, v_budget, 'commitment', v_target - coalesce(v_current, 0),
    'purchase_order', p.id, p_memo);
end $$;

create or replace function app.po_snapshot(p_po uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) || jsonb_build_object('lines',
    coalesce((select jsonb_agg(to_jsonb(l) order by l.line_no) from public.po_lines l where l.po_id = p.id), '[]'))
  from public.purchase_orders p where p.id = p_po
$$;

create or replace function app.po_set_status(p_po uuid, p_status text, p_extra jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.begin_system_update();
  update public.purchase_orders set status = p_status,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    closed_at = case when p_status = 'closed' then now() else closed_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancel_reason = coalesce(p_extra ->> 'cancel_reason', cancel_reason),
    vendor_ack_at = case when p_status = 'acknowledged' then now() else vendor_ack_at end,
    vendor_ack_name = coalesce(p_extra ->> 'ack_name', vendor_ack_name),
    vendor_ack_note = coalesce(p_extra ->> 'ack_note', vendor_ack_note),
    amendment_reason = coalesce(p_extra ->> 'amendment_reason', amendment_reason)
  where id = p_po;
  perform app.end_system_update();
end $$;

create or replace function app.require(p_permission text, p_org uuid, p_campus uuid default null, p_dept uuid default null)
returns void language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.has_permission(app.actor_id(), p_permission, p_org, p_campus, p_dept) then
    raise exception 'missing permission %', p_permission using errcode = '42501';
  end if;
end $$;

create or replace function public.po_submit(p_po_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  p public.purchase_orders;
  v_check jsonb;
  v_request uuid;
begin
  select * into p from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception 'PO not found' using errcode = 'P0002'; end if;
  perform app.require('po:create', p.org_id, p.campus_id, p.department_id);
  if p.status not in ('draft', 'rejected') then raise exception 'PO is already %', p.status using errcode = 'P0001'; end if;
  if not exists (select 1 from public.po_lines where po_id = p.id) then
    raise exception 'add at least one line' using errcode = '23514';
  end if;
  if p.category_id is not null then
    v_check := public.budget_check(p.org_id, p.order_date, p.campus_id, p.department_id, p.category_id, p.total,
                                   'purchase_order', p.id);
    if v_check ->> 'result' = 'blocked' then
      raise exception 'Budget check failed: %', v_check ->> 'message' using errcode = '23514';
    end if;
  end if;
  perform app.begin_system_update();
  update public.purchase_orders set budget_check = v_check where id = p.id;
  perform app.end_system_update();
  perform app.po_set_status(p.id, 'pending_approval');
  v_request := app.approval_create(p.org_id, 'po', 'purchase_order', p.id, p.campus_id, p.department_id, p.total,
    case when p.category_id is null then '{}'::uuid[] else array[p.category_id] end,
    p.number || ' · ' || (select name from public.vendors where id = p.vendor_id), app.actor_id(),
    jsonb_build_object('budget_check', v_check, 'version', p.version));
  perform app.begin_system_update();
  update public.purchase_orders set approval_request_id = v_request where id = p.id;
  perform app.end_system_update();
  return jsonb_build_object('status', (select status from public.purchase_orders where id = p.id),
    'approval_request_id', v_request, 'budget_check', v_check);
end $$;

create or replace function app.po_on_decision(p_request_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  p public.purchase_orders;
  v_check jsonb;
begin
  select * into p from public.purchase_orders where id = (select entity_id from public.approval_requests where id = p_request_id);
  if p_status = 'approved' then
    -- final budget check at approval time (hard limits block)
    if p.category_id is not null then
      v_check := public.budget_check(p.org_id, p.order_date, p.campus_id, p.department_id, p.category_id,
                                     app.po_open_value(p.id), 'purchase_order', p.id);
      if v_check ->> 'result' = 'blocked' then
        raise exception 'Budget check failed at approval: %', v_check ->> 'message' using errcode = '23514';
      end if;
    end if;
    perform app.po_set_status(p.id, 'approved');
    perform app.po_sync_commitment(p.id, p.number || ' approved (v' || p.version || ')');
    if p.requisition_id is not null then
      update public.requisitions set status = 'ordered' where id = p.requisition_id and status in ('approved', 'rfq');
    end if;
  elsif p_status = 'rejected' then
    perform app.po_set_status(p.id, 'rejected');
  else
    perform app.po_set_status(p.id, 'draft');
  end if;
end $$;

create or replace function public.po_send(p_po_id uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  p public.purchase_orders;
  v public.vendors;
begin
  select * into p from public.purchase_orders where id = p_po_id for update;
  perform app.require('po:send', p.org_id, p.campus_id, p.department_id);
  if p.status not in ('approved', 'sent') then raise exception 'PO must be approved before sending' using errcode = 'P0001'; end if;
  perform app.po_set_status(p.id, 'sent');
  select * into v from public.vendors where id = p.vendor_id;
  perform app.queue_message(p.org_id, 'email', v.email, 'po_sent', 'Purchase Order ' || p.number,
    jsonb_build_object('po_id', p.id, 'number', p.number, 'vendor', v.name, 'total', p.total, 'version', p.version),
    'po_sent:' || p.id || ':' || p.version);
end $$;

-- Vendor acknowledgement (called via the vendor portal with the service role).
create or replace function public.po_vendor_acknowledge(p_po_id uuid, p_vendor_id uuid, p_name text, p_note text default null)
returns void
language plpgsql security definer set search_path = public, app as $$
declare
  p public.purchase_orders;
begin
  if not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into p from public.purchase_orders where id = p_po_id and vendor_id = p_vendor_id for update;
  if not found then raise exception 'PO not found' using errcode = 'P0002'; end if;
  if p.status not in ('sent', 'approved') then raise exception 'PO cannot be acknowledged in status %', p.status using errcode = 'P0001'; end if;
  perform app.po_set_status(p.id, 'acknowledged', jsonb_build_object('ack_name', p_name, 'ack_note', p_note));
  perform app.notify(p.org_id, p.created_by, 'po.acknowledged', 'Vendor acknowledged ' || p.number, p_note,
    'purchase_order', p.id, '/po/orders/' || p.id);
end $$;
revoke execute on function public.po_vendor_acknowledge(uuid, uuid, text, text) from public, anon, authenticated;

-- Amend an approved PO: snapshot the current version, bump the version and
-- return it to draft. Re-submission goes through approval again and the
-- commitment is re-synced on approval.
create or replace function public.po_amend(p_po_id uuid, p_reason text) returns int
language plpgsql security definer set search_path = public, app as $$
declare
  p public.purchase_orders;
begin
  select * into p from public.purchase_orders where id = p_po_id for update;
  perform app.require('po:amend', p.org_id, p.campus_id, p.department_id);
  if p.status not in ('approved', 'sent', 'acknowledged', 'partially_received') then
    raise exception 'PO in status % cannot be amended', p.status using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason required' using errcode = '22023'; end if;
  insert into public.po_versions (org_id, po_id, version, snapshot, change_reason, created_by)
  values (p.org_id, p.id, p.version, app.po_snapshot(p.id), p_reason, app.actor_id());
  perform app.begin_system_update();
  update public.purchase_orders set version = version + 1, status = 'draft', amendment_reason = p_reason,
    approval_request_id = null, vendor_ack_at = null where id = p.id;
  perform app.end_system_update();
  -- commitment stays in place until the amendment is approved
  return p.version + 1;
end $$;

create or replace function public.po_cancel(p_po_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  p public.purchase_orders;
begin
  select * into p from public.purchase_orders where id = p_po_id for update;
  perform app.require('po:cancel', p.org_id, p.campus_id, p.department_id);
  if p.status in ('closed', 'cancelled') or exists (select 1 from public.po_lines where po_id = p.id and received_qty > 0) then
    raise exception 'PO cannot be cancelled (already received or closed)' using errcode = 'P0001';
  end if;
  if p.status = 'pending_approval' then
    perform public.approval_cancel(p.approval_request_id, 'PO cancelled');
  end if;
  perform app.po_set_status(p.id, 'cancelled', jsonb_build_object('cancel_reason', p_reason));
  perform app.po_sync_commitment(p.id, p.number || ' cancelled');
end $$;

-- -----------------------------------------------------------------------------
-- GRN (goods receipt notes) with partial receipts
-- -----------------------------------------------------------------------------
create table public.grns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  number text not null,
  po_id uuid not null references public.purchase_orders(id),
  campus_id uuid not null references public.campuses(id),
  received_date date not null default current_date,
  received_by uuid references public.profiles(id),
  delivery_note_number text,
  vehicle_number text,
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  notes text,
  posted_at timestamptz,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number)
);
create index on public.grns (po_id);

create table public.grn_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  grn_id uuid not null references public.grns(id) on delete cascade,
  po_line_id uuid not null references public.po_lines(id),
  received_qty numeric(14, 3) not null check (received_qty >= 0),
  accepted_qty numeric(14, 3) not null check (accepted_qty >= 0),
  rejected_qty numeric(14, 3) generated always as (received_qty - accepted_qty) stored,
  remarks text,
  assets_created int not null default 0,
  check (accepted_qty <= received_qty),
  unique (grn_id, po_line_id)
);

create or replace function app.grns_before() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if tg_op = 'INSERT' then
    new.number := app.next_number(new.org_id, 'grn', new.campus_id, new.received_date);
    if not app.in_system_update() then new.status := 'draft'; end if;
  elsif new.status <> old.status and not app.in_system_update() and auth.uid() is not null then
    raise exception 'use grn_post to post a GRN' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger grns_before before insert or update on public.grns
  for each row execute function app.grns_before();

create or replace function public.grn_post(p_grn_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  g public.grns;
  p public.purchase_orders;
  l record;
  v_tolerance numeric;
  v_status text;
begin
  select * into g from public.grns where id = p_grn_id for update;
  if not found then raise exception 'GRN not found' using errcode = 'P0002'; end if;
  perform app.require('grn:create', g.org_id, g.campus_id);
  if g.status <> 'draft' then raise exception 'GRN already %', g.status using errcode = 'P0001'; end if;
  select * into p from public.purchase_orders where id = g.po_id for update;
  if p.status not in ('approved', 'sent', 'acknowledged', 'partially_received') then
    raise exception 'cannot receive against a PO in status %', p.status using errcode = 'P0001';
  end if;
  v_tolerance := coalesce((select (settings ->> 'over_receipt_tolerance_pct')::numeric from public.organisations
                           where id = g.org_id), 0);
  for l in
    select gl.*, pl.quantity, pl.received_qty as already, pl.description
    from public.grn_lines gl join public.po_lines pl on pl.id = gl.po_line_id
    where gl.grn_id = g.id
  loop
    if l.already + l.accepted_qty > l.quantity * (1 + v_tolerance / 100) then
      raise exception 'Receiving % of "%" exceeds the ordered quantity (% ordered, % already received)',
        l.accepted_qty, l.description, l.quantity, l.already using errcode = '23514';
    end if;
  end loop;
  if not exists (select 1 from public.grn_lines where grn_id = g.id and received_qty > 0) then
    raise exception 'GRN has no received quantities' using errcode = '23514';
  end if;

  perform app.begin_system_update();
  update public.po_lines pl set received_qty = pl.received_qty + gl.accepted_qty
  from public.grn_lines gl where gl.grn_id = g.id and gl.po_line_id = pl.id;
  update public.grns set status = 'posted', posted_at = now(), received_by = coalesce(received_by, app.actor_id())
  where id = g.id;
  perform app.end_system_update();

  v_status := case when exists (select 1 from public.po_lines where po_id = p.id and received_qty < quantity)
                   then 'partially_received' else 'received' end;
  perform app.po_set_status(p.id, v_status);
  perform app.emit_event(g.org_id, 'grn.posted', 'grn', g.id, jsonb_build_object('po_id', p.id, 'number', g.number));
  perform app.notify(g.org_id, p.created_by, 'grn.posted', 'Goods received for ' || p.number, g.number,
    'purchase_order', p.id, '/po/orders/' || p.id);

  return jsonb_build_object('status', 'posted', 'po_status', v_status,
    'asset_candidates', coalesce((select jsonb_agg(jsonb_build_object('grn_line_id', gl.id, 'po_line_id', pl.id,
        'description', pl.description, 'accepted_qty', gl.accepted_qty, 'asset_category_id', pl.asset_category_id))
      from public.grn_lines gl join public.po_lines pl on pl.id = gl.po_line_id
      left join public.items i on i.id = pl.item_id
      where gl.grn_id = g.id and gl.accepted_qty > 0 and (pl.is_asset or coalesce(i.is_asset, false))), '[]'::jsonb));
end $$;

-- Create one asset per accepted unit on a GRN line.
create or replace function public.grn_create_assets(
  p_grn_line_id uuid, p_location_id uuid default null, p_category_id uuid default null, p_custodian_id uuid default null
) returns int
language plpgsql security definer set search_path = public, app as $$
declare
  gl public.grn_lines;
  g public.grns;
  pl public.po_lines;
  p public.purchase_orders;
  v_count int;
  i int;
begin
  select * into gl from public.grn_lines where id = p_grn_line_id for update;
  select * into g from public.grns where id = gl.grn_id;
  select * into pl from public.po_lines where id = gl.po_line_id;
  select * into p from public.purchase_orders where id = pl.po_id;
  perform app.require('asset:create', g.org_id, g.campus_id);
  if g.status <> 'posted' then raise exception 'post the GRN first' using errcode = 'P0001'; end if;
  v_count := floor(gl.accepted_qty)::int - gl.assets_created;
  if v_count <= 0 then return 0; end if;
  if v_count > 500 then raise exception 'too many assets in one go (max 500)' using errcode = '22023'; end if;
  for i in 1..v_count loop
    insert into public.assets (org_id, campus_id, location_id, category_id, department_id, name, description, status,
      custodian_id, purchase_date, purchase_cost, vendor_id, po_id, grn_id, asset_tag)
    values (g.org_id, g.campus_id, p_location_id, coalesce(p_category_id, pl.asset_category_id), p.department_id,
      pl.description, 'From ' || p.number || ' / ' || g.number,
      case when p_custodian_id is not null then 'in_use' else 'in_stock' end,
      p_custodian_id, g.received_date, round(pl.line_total / pl.quantity, 2), p.vendor_id, p.id, g.id, '');
  end loop;
  update public.grn_lines set assets_created = assets_created + v_count where id = gl.id;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Vendor invoices & 3-way match
-- -----------------------------------------------------------------------------
create table public.vendor_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  number text not null,                    -- internal reference
  vendor_invoice_number text not null,
  vendor_id uuid not null references public.vendors(id),
  po_id uuid not null references public.purchase_orders(id),
  campus_id uuid not null references public.campuses(id),
  invoice_date date not null,
  due_date date,
  subtotal numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  amount_paid numeric(14, 2) not null default 0,
  status text not null default 'received' check (status in ('received', 'approved', 'partially_paid', 'paid',
    'disputed', 'cancelled')),
  match_status text not null default 'pending' check (match_status in ('pending', 'matched', 'qty_mismatch',
    'price_mismatch', 'over_billed', 'override')),
  match_details jsonb,
  override_reason text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  attachment_id uuid references public.attachments(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number),
  unique (org_id, vendor_id, vendor_invoice_number)
);
create index on public.vendor_invoices (po_id);
create index on public.vendor_invoices (org_id, status, due_date);

create table public.vendor_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  invoice_id uuid not null references public.vendor_invoices(id) on delete cascade,
  po_line_id uuid not null references public.po_lines(id),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  tax_amount numeric(14, 2) not null default 0,
  line_total numeric(14, 2) generated always as (round(quantity * unit_price, 2) + tax_amount) stored,
  unique (invoice_id, po_line_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  number text not null,
  invoice_id uuid not null references public.vendor_invoices(id),
  vendor_id uuid not null references public.vendors(id),
  amount numeric(14, 2) not null check (amount > 0),
  tds_amount numeric(14, 2) not null default 0,
  paid_on date not null default current_date,
  method text not null check (method in ('neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash', 'other')),
  reference text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create index on public.payments (invoice_id);

create or replace function app.vendor_invoices_before() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if tg_op = 'INSERT' then
    new.number := app.next_number(new.org_id, 'invoice', new.campus_id, new.invoice_date);
    select vendor_id, campus_id into new.vendor_id, new.campus_id from public.purchase_orders where id = new.po_id;
    if not app.in_system_update() then
      new.status := 'received'; new.match_status := 'pending';
    end if;
  elsif (new.status <> old.status or new.match_status <> old.match_status) and not app.in_system_update()
        and auth.uid() is not null then
    raise exception 'use the invoice actions to change status' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger vendor_invoices_before before insert or update on public.vendor_invoices
  for each row execute function app.vendor_invoices_before();

create or replace function app.invoice_lines_rollup() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_inv uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  if not app.in_system_update() and exists (select 1 from public.vendor_invoices where id = v_inv and status <> 'received') then
    raise exception 'invoice lines are locked after approval' using errcode = '42501';
  end if;
  perform app.begin_system_update();
  update public.vendor_invoices set
    subtotal = coalesce((select sum(round(quantity * unit_price, 2)) from public.vendor_invoice_lines where invoice_id = v_inv), 0),
    tax_total = coalesce((select sum(tax_amount) from public.vendor_invoice_lines where invoice_id = v_inv), 0),
    total = coalesce((select sum(line_total) from public.vendor_invoice_lines where invoice_id = v_inv), 0),
    match_status = 'pending'
  where id = v_inv;
  perform app.end_system_update();
  return null;
end $$;
create trigger invoice_lines_rollup after insert or update or delete on public.vendor_invoice_lines
  for each row execute function app.invoice_lines_rollup();

-- 3-way match: PO (price/qty ordered) vs GRN (qty accepted) vs invoice.
-- Tolerances come from organisations.settings:
--   three_way_match_price_tolerance_pct (default 0), three_way_match_qty_tolerance_pct (default 0)
create or replace function public.invoice_three_way_match(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  inv public.vendor_invoices;
  v_price_tol numeric;
  v_qty_tol numeric;
  v_lines jsonb := '[]'::jsonb;
  v_status text := 'matched';
  l record;
  v_line_status text;
begin
  select * into inv from public.vendor_invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if app.actor_id() is not null then
    perform app.require('invoice:read', inv.org_id, inv.campus_id);
  elsif not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce((settings ->> 'three_way_match_price_tolerance_pct')::numeric, 0),
         coalesce((settings ->> 'three_way_match_qty_tolerance_pct')::numeric, 0)
    into v_price_tol, v_qty_tol
  from public.organisations where id = inv.org_id;

  if not exists (select 1 from public.vendor_invoice_lines where invoice_id = inv.id) then
    raise exception 'invoice has no lines' using errcode = '23514';
  end if;

  for l in
    select il.*, pl.description, pl.quantity as ordered_qty, pl.unit_price as po_price, pl.discount_pct,
      pl.received_qty,
      -- quantity already invoiced on other (non-cancelled) invoices
      coalesce((select sum(x.quantity) from public.vendor_invoice_lines x join public.vendor_invoices vi on vi.id = x.invoice_id
                where x.po_line_id = il.po_line_id and x.invoice_id <> inv.id and vi.status <> 'cancelled'), 0) as other_invoiced
    from public.vendor_invoice_lines il join public.po_lines pl on pl.id = il.po_line_id
    where il.invoice_id = inv.id
  loop
    v_line_status := 'matched';
    if l.other_invoiced + l.quantity > l.ordered_qty * (1 + v_qty_tol / 100) then
      v_line_status := 'over_billed';
    elsif l.other_invoiced + l.quantity > l.received_qty * (1 + v_qty_tol / 100) then
      v_line_status := 'qty_mismatch';
    elsif l.unit_price > round(l.po_price * (1 - l.discount_pct / 100), 2) * (1 + v_price_tol / 100) + 0.005 then
      v_line_status := 'price_mismatch';
    end if;
    if v_line_status <> 'matched' and v_status = 'matched' then v_status := v_line_status;
    elsif v_line_status = 'over_billed' then v_status := 'over_billed';
    end if;
    v_lines := v_lines || jsonb_build_object('po_line_id', l.po_line_id, 'description', l.description,
      'ordered_qty', l.ordered_qty, 'received_qty', l.received_qty, 'previously_invoiced_qty', l.other_invoiced,
      'invoiced_qty', l.quantity, 'po_unit_price', round(l.po_price * (1 - l.discount_pct / 100), 2),
      'invoiced_unit_price', l.unit_price, 'result', v_line_status);
  end loop;

  perform app.begin_system_update();
  update public.vendor_invoices set match_status = v_status,
    match_details = jsonb_build_object('checked_at', now(), 'lines', v_lines,
      'price_tolerance_pct', v_price_tol, 'qty_tolerance_pct', v_qty_tol)
  where id = inv.id;
  perform app.end_system_update();
  return jsonb_build_object('match_status', v_status, 'lines', v_lines);
end $$;

-- Approve an invoice for payment: requires a 3-way match (or an override with
-- reason by someone holding invoice:override). Moves commitment -> actual.
create or replace function public.invoice_approve(p_invoice_id uuid, p_override_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  inv public.vendor_invoices;
  p public.purchase_orders;
  v_match jsonb;
  v_budget uuid;
begin
  select * into inv from public.vendor_invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform app.require('invoice:approve', inv.org_id, inv.campus_id);
  if inv.status <> 'received' then raise exception 'invoice is already %', inv.status using errcode = 'P0001'; end if;
  v_match := public.invoice_three_way_match(inv.id);
  if v_match ->> 'match_status' <> 'matched' then
    if p_override_reason is null then
      raise exception '3-way match failed (%); an override reason is required', v_match ->> 'match_status' using errcode = '23514';
    end if;
    perform app.require('invoice:override', inv.org_id, inv.campus_id);
  end if;
  select * into p from public.purchase_orders where id = inv.po_id;

  perform app.begin_system_update();
  update public.vendor_invoices set status = 'approved', approved_by = app.actor_id(), approved_at = now(),
    match_status = case when p_override_reason is not null and match_status <> 'matched' then 'override' else match_status end,
    override_reason = p_override_reason
  where id = inv.id;
  update public.po_lines pl set invoiced_qty = pl.invoiced_qty + il.quantity
  from public.vendor_invoice_lines il where il.invoice_id = inv.id and il.po_line_id = pl.id;
  perform app.end_system_update();

  -- budget: release commitment for the invoiced value, book the actual
  if p.category_id is not null then
    v_budget := coalesce(
      (select budget_id from public.budget_ledger where source_type = 'purchase_order' and source_id = p.id limit 1),
      app.find_budget(p.org_id, p.fiscal_year_id, p.campus_id, p.department_id, p.category_id));
    perform app.ledger_post(p.org_id, v_budget, 'actual', inv.total, 'vendor_invoice', inv.id,
      inv.vendor_invoice_number, inv.invoice_date);
    perform app.po_sync_commitment(p.id, 'invoice ' || inv.number);
  end if;
  return jsonb_build_object('status', 'approved', 'match', v_match);
end $$;

create or replace function public.invoice_record_payment(
  p_invoice_id uuid, p_amount numeric, p_method text, p_reference text default null,
  p_paid_on date default current_date, p_tds numeric default 0
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  inv public.vendor_invoices;
  v_id uuid;
begin
  select * into inv from public.vendor_invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform app.require('payment:create', inv.org_id, inv.campus_id);
  if inv.status not in ('approved', 'partially_paid') then
    raise exception 'invoice must be approved before payment' using errcode = 'P0001';
  end if;
  if inv.amount_paid + p_amount + coalesce(p_tds, 0) > inv.total + 0.005 then
    raise exception 'payment exceeds the invoice balance (%)', inv.total - inv.amount_paid using errcode = '23514';
  end if;
  insert into public.payments (org_id, number, invoice_id, vendor_id, amount, tds_amount, paid_on, method, reference, created_by)
  values (inv.org_id, app.next_number(inv.org_id, 'payment', inv.campus_id, p_paid_on), inv.id, inv.vendor_id,
    p_amount, coalesce(p_tds, 0), p_paid_on, p_method, p_reference, app.actor_id())
  returning id into v_id;
  perform app.begin_system_update();
  update public.vendor_invoices set amount_paid = amount_paid + p_amount + coalesce(p_tds, 0),
    status = case when amount_paid + p_amount + coalesce(p_tds, 0) >= total - 0.005 then 'paid' else 'partially_paid' end
  where id = inv.id;
  perform app.end_system_update();
  perform app.emit_event(inv.org_id, 'payment.recorded', 'vendor_invoice', inv.id,
    jsonb_build_object('payment_id', v_id, 'amount', p_amount, 'po_id', inv.po_id));
  return v_id;
end $$;

-- Close a PO: releases any remaining commitment and optionally records vendor feedback.
create or replace function public.po_close(p_po_id uuid, p_rating smallint default null, p_comment text default null)
returns void
language plpgsql security definer set search_path = public, app as $$
declare
  p public.purchase_orders;
begin
  select * into p from public.purchase_orders where id = p_po_id for update;
  perform app.require('po:close', p.org_id, p.campus_id, p.department_id);
  if p.status not in ('received', 'partially_received', 'acknowledged', 'sent', 'approved') then
    raise exception 'PO in status % cannot be closed', p.status using errcode = 'P0001';
  end if;
  if exists (select 1 from public.vendor_invoices where po_id = p.id and status in ('received', 'disputed')) then
    raise exception 'resolve pending invoices before closing' using errcode = 'P0001';
  end if;
  perform app.po_set_status(p.id, 'closed');
  perform app.po_sync_commitment(p.id, p.number || ' closed');
  if p_rating is not null then
    insert into public.vendor_ratings (org_id, vendor_id, source_type, source_id, rating, comment, rated_by)
    values (p.org_id, p.vendor_id, 'purchase_order', p.id, p_rating, p_comment, app.actor_id())
    on conflict do nothing;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Requisition & RFQ actions
-- -----------------------------------------------------------------------------
create or replace function app.requisitions_before() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if tg_op = 'INSERT' then
    new.number := app.next_number(new.org_id, 'requisition', new.campus_id);
    if not app.in_system_update() then new.status := 'draft'; end if;
  elsif new.status <> old.status and not app.in_system_update() and auth.uid() is not null
        and not (old.status in ('draft', 'rejected') and new.status = 'cancelled') then
    raise exception 'use the requisition actions to change status' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger requisitions_before before insert or update on public.requisitions
  for each row execute function app.requisitions_before();

create or replace function app.requisition_lines_rollup() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_req uuid := coalesce(new.requisition_id, old.requisition_id);
begin
  if not app.in_system_update() and exists (select 1 from public.requisitions where id = v_req and status not in ('draft', 'rejected')) then
    raise exception 'requisition lines can only be changed while in draft' using errcode = '42501';
  end if;
  update public.requisitions set estimated_total = coalesce((select sum(line_total) from public.requisition_lines
    where requisition_id = v_req), 0) where id = v_req;
  return null;
end $$;
create trigger requisition_lines_rollup after insert or update or delete on public.requisition_lines
  for each row execute function app.requisition_lines_rollup();

create or replace function public.requisition_submit(p_requisition_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  r public.requisitions;
  v_check jsonb;
  v_request uuid;
begin
  select * into r from public.requisitions where id = p_requisition_id for update;
  if not found then raise exception 'requisition not found' using errcode = 'P0002'; end if;
  if app.actor_id() is distinct from r.requested_by
     and not app.has_permission(app.actor_id(), 'requisition:update', r.org_id, r.campus_id, r.department_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'rejected') then raise exception 'requisition is already %', r.status using errcode = 'P0001'; end if;
  if not exists (select 1 from public.requisition_lines where requisition_id = r.id) then
    raise exception 'add at least one line' using errcode = '23514';
  end if;
  if r.category_id is not null then
    v_check := public.budget_check(r.org_id, current_date, r.campus_id, r.department_id, r.category_id, r.estimated_total);
  end if;
  perform app.begin_system_update();
  update public.requisitions set status = 'pending_approval', budget_check = v_check where id = r.id;
  perform app.end_system_update();
  v_request := app.approval_create(r.org_id, 'po', 'requisition', r.id, r.campus_id, r.department_id, r.estimated_total,
    case when r.category_id is null then '{}'::uuid[] else array[r.category_id] end, r.number || ' · ' || r.title,
    r.requested_by, jsonb_build_object('budget_check', v_check));
  perform app.begin_system_update();
  update public.requisitions set approval_request_id = v_request where id = r.id;
  perform app.end_system_update();
  return jsonb_build_object('status', (select status from public.requisitions where id = r.id),
    'approval_request_id', v_request, 'budget_check', v_check);
end $$;

create or replace function app.requisition_on_decision(p_request_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.begin_system_update();
  update public.requisitions set status = case p_status when 'approved' then 'approved' when 'rejected' then 'rejected'
    else 'draft' end
  where id = (select entity_id from public.approval_requests where id = p_request_id);
  perform app.end_system_update();
end $$;

create or replace function public.rfq_create_from_requisition(
  p_requisition_id uuid, p_vendor_ids uuid[], p_due_date date default null, p_terms text default null
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  r public.requisitions;
  v_rfq uuid;
begin
  select * into r from public.requisitions where id = p_requisition_id for update;
  perform app.require('rfq:create', r.org_id, r.campus_id, r.department_id);
  if r.status not in ('approved', 'rfq') then raise exception 'requisition must be approved' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(p_vendor_ids) v where not exists (
      select 1 from public.vendors x where x.id = v and x.org_id = r.org_id and x.status = 'approved')) then
    raise exception 'all vendors must be approved vendors of this organisation' using errcode = '23514';
  end if;
  insert into public.rfqs (org_id, number, requisition_id, campus_id, department_id, title, terms, due_date, status, created_by)
  values (r.org_id, app.next_number(r.org_id, 'rfq', r.campus_id), r.id, r.campus_id, r.department_id,
    'RFQ for ' || r.title, p_terms, coalesce(p_due_date, current_date + 7), 'sent', app.actor_id())
  returning id into v_rfq;
  insert into public.rfq_vendors (rfq_id, vendor_id, org_id) select v_rfq, v, r.org_id from unnest(p_vendor_ids) v;
  perform app.begin_system_update();
  update public.requisitions set status = 'rfq' where id = r.id;
  perform app.end_system_update();
  perform app.queue_message(r.org_id, 'email', v.email, 'rfq_invite', 'Request for quotation: ' || r.title,
    jsonb_build_object('rfq_id', v_rfq, 'vendor_id', v.id, 'vendor', v.name, 'due_date', coalesce(p_due_date, current_date + 7)),
    'rfq:' || v_rfq || ':' || v.id)
  from public.vendors v where v.id = any (p_vendor_ids);
  perform app.emit_event(r.org_id, 'rfq.sent', 'rfq', v_rfq, jsonb_build_object('vendor_ids', to_jsonb(p_vendor_ids)));
  return v_rfq;
end $$;

-- Award a quote: rejects the others and creates a draft PO from it.
create or replace function public.rfq_award(p_quote_id uuid, p_category_id uuid default null) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  q public.quotes;
  f public.rfqs;
  r public.requisitions;
  v_po uuid;
begin
  select * into q from public.quotes where id = p_quote_id for update;
  select * into f from public.rfqs where id = q.rfq_id for update;
  perform app.require('rfq:award', f.org_id, f.campus_id, f.department_id);
  if f.status not in ('sent', 'closed') then raise exception 'RFQ is %', f.status using errcode = 'P0001'; end if;
  select * into r from public.requisitions where id = f.requisition_id;
  update public.quotes set status = case when id = q.id then 'awarded' else 'rejected' end where rfq_id = f.id;
  update public.rfqs set status = 'awarded', awarded_quote_id = q.id where id = f.id;

  perform app.begin_system_update();
  insert into public.purchase_orders (org_id, number, campus_id, department_id, category_id, vendor_id, requisition_id,
    rfq_id, quote_id, payment_terms, expected_delivery, created_by, status)
  values (f.org_id, '', f.campus_id, f.department_id, coalesce(p_category_id, r.category_id), q.vendor_id, r.id, f.id, q.id,
    q.payment_terms, case when q.delivery_days is not null then current_date + q.delivery_days end, app.actor_id(), 'draft')
  returning id into v_po;
  insert into public.po_lines (org_id, po_id, line_no, item_id, requisition_line_id, description, quantity, unit, unit_price, tax_rate, hsn_sac)
  select f.org_id, v_po, row_number() over (order by rl.position, ql.id), rl.item_id, ql.requisition_line_id, ql.description,
    ql.quantity, coalesce(rl.unit, 'nos'), ql.unit_price, ql.tax_rate, i.hsn_sac
  from public.quote_lines ql
  left join public.requisition_lines rl on rl.id = ql.requisition_line_id
  left join public.items i on i.id = rl.item_id
  where ql.quote_id = q.id;
  perform app.end_system_update();
  return v_po;
end $$;

insert into app.approval_handlers (entity_type, handler) values
  ('purchase_order', 'app.po_on_decision(uuid,text)'),
  ('requisition', 'app.requisition_on_decision(uuid,text)');

-- PO status timeline (activity + approvals) for the detail page.
create or replace function public.po_timeline(p_po_id uuid)
returns table (at timestamptz, kind text, label text, actor_id uuid, details jsonb)
language sql stable security invoker as $$
  select created_at, 'activity', action, actor_id, coalesce(changes, metadata)
  from public.activity_log where entity_type = 'purchase_order' and entity_id = p_po_id
  union all
  select a.created_at, 'approval', a.action, a.actor_id, jsonb_build_object('comment', a.comment)
  from public.approval_actions a join public.approval_requests r on r.id = a.request_id
  where r.entity_type = 'purchase_order' and r.entity_id = p_po_id
  union all
  select g.posted_at, 'grn', 'goods received ' || g.number, g.received_by, null
  from public.grns g where g.po_id = p_po_id and g.status = 'posted'
  union all
  select v.created_at, 'invoice', 'invoice ' || v.vendor_invoice_number || ' (' || v.match_status || ')', v.created_by, null
  from public.vendor_invoices v where v.po_id = p_po_id
  union all
  select p.created_at, 'payment', 'payment ' || p.number || ' ₹' || p.amount, p.created_by, null
  from public.payments p join public.vendor_invoices v on v.id = p.invoice_id where v.po_id = p_po_id
  order by 1
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.items enable row level security;
create policy items_select on public.items for select to authenticated using (org_id in (select app.my_org_ids()));
create policy items_write on public.items for all to authenticated
  using (app.can('po:create', org_id)) with check (app.can('po:create', org_id));

select app.enable_standard_rls('public.requisitions', 'requisition', 'campus_id', 'department_id',
  array['requested_by', 'created_by'], true);
create policy requisitions_own_insert on public.requisitions for insert to authenticated
  with check (requested_by = (select auth.uid()) and app.can('requisition:submit', org_id, campus_id, department_id));
select app.enable_child_rls('public.requisition_lines', 'public.requisitions', 'requisition_id', 'requisition',
  'campus_id', 'department_id', array['requested_by', 'created_by']);

select app.enable_standard_rls('public.rfqs', 'rfq', 'campus_id', 'department_id');
select app.enable_child_rls('public.rfq_vendors', 'public.rfqs', 'rfq_id', 'rfq', 'campus_id', 'department_id');
select app.enable_child_rls('public.quotes', 'public.rfqs', 'rfq_id', 'rfq', 'campus_id', 'department_id');
alter table public.quote_lines enable row level security;
create policy ql_select on public.quote_lines for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id));
create policy ql_write on public.quote_lines for all to authenticated
  using (exists (select 1 from public.quotes q join public.rfqs f on f.id = q.rfq_id where q.id = quote_id
                 and app.can('rfq:update', f.org_id, f.campus_id, f.department_id)))
  with check (exists (select 1 from public.quotes q join public.rfqs f on f.id = q.rfq_id where q.id = quote_id
                 and app.can('rfq:update', f.org_id, f.campus_id, f.department_id)));

select app.enable_standard_rls('public.purchase_orders', 'po', 'campus_id', 'department_id', array['created_by']);
select app.enable_child_rls('public.po_lines', 'public.purchase_orders', 'po_id', 'po', 'campus_id', 'department_id', array['created_by']);
select app.enable_child_rls('public.po_versions', 'public.purchase_orders', 'po_id', 'po', 'campus_id', 'department_id');

select app.enable_standard_rls('public.grns', 'grn', 'campus_id');
select app.enable_child_rls('public.grn_lines', 'public.grns', 'grn_id', 'grn', 'campus_id');

select app.enable_standard_rls('public.vendor_invoices', 'invoice', 'campus_id');
select app.enable_child_rls('public.vendor_invoice_lines', 'public.vendor_invoices', 'invoice_id', 'invoice', 'campus_id');
alter table public.payments enable row level security;
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.vendor_invoices v where v.id = invoice_id));

select app.add_standard_triggers(t) from unnest(array[
  'public.items', 'public.requisitions', 'public.rfqs', 'public.quotes', 'public.purchase_orders', 'public.grns',
  'public.vendor_invoices'
]::regclass[]) t;
select app.add_audit('public.requisitions', 'requisition');
select app.add_audit('public.rfqs', 'rfq');
select app.add_audit('public.purchase_orders', 'purchase_order');
select app.add_audit('public.grns', 'grn');
select app.add_audit('public.vendor_invoices', 'vendor_invoice');
select app.add_events('public.requisitions', 'requisition');
select app.add_events('public.purchase_orders', 'po');
select app.add_events('public.vendor_invoices', 'invoice');

-- foreign keys from facility tables now that PO tables exist
alter table public.assets add constraint assets_po_fk foreign key (po_id) references public.purchase_orders(id) on delete set null;
alter table public.assets add constraint assets_grn_fk foreign key (grn_id) references public.grns(id) on delete set null;
alter table public.work_orders add constraint work_orders_po_fk foreign key (po_id) references public.purchase_orders(id) on delete set null;
alter table public.amc_contracts add constraint amc_po_fk foreign key (po_id) references public.purchase_orders(id) on delete set null;
alter table public.issues add constraint issues_task_fk foreign key (task_id) references public.tasks(id) on delete set null;

insert into app.entity_registry (entity_type, table_name, resource, module, campus_col, dept_col, owner_cols, title_col, number_col, url_template) values
  ('requisition', 'public.requisitions', 'requisition', 'po', 'campus_id', 'department_id', '{requested_by,created_by}', 'title', 'number', '/po/requisitions/{id}'),
  ('rfq', 'public.rfqs', 'rfq', 'po', 'campus_id', 'department_id', '{}', 'title', 'number', '/po/rfqs/{id}'),
  ('purchase_order', 'public.purchase_orders', 'po', 'po', 'campus_id', 'department_id', '{created_by}', 'number', 'number', '/po/orders/{id}'),
  ('grn', 'public.grns', 'grn', 'po', 'campus_id', null, '{}', 'number', 'number', '/po/grns/{id}'),
  ('vendor_invoice', 'public.vendor_invoices', 'invoice', 'po', 'campus_id', null, '{}', 'vendor_invoice_number', 'number', '/po/invoices/{id}');
