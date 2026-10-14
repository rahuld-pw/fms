-- -----------------------------------------------------------------------------
-- Public (QR) reports can name the exact spot: a building, floor, room or area
-- on the same campus as the scanned code. A new name rather than a changed
-- signature, so the previous release keeps working during the deploy; the old
-- submit_public_issue can be dropped once nothing calls it.
-- -----------------------------------------------------------------------------
create or replace function public.submit_public_report(
  p_qr_token text, p_title text, p_description text, p_category_id uuid default null,
  p_priority text default null, p_campus_id uuid default null, p_org_slug text default null,
  p_location_id uuid default null
) returns table (issue_id uuid, issue_number text, tracking_token text)
language plpgsql security definer set search_path = public, app as $$
declare
  l public.locations;
  a public.assets;
  v_org uuid;
  v_campus uuid;
  v_location uuid;
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
  if p_location_id is not null then
    select id into v_location from public.locations
    where id = p_location_id and org_id = v_org and campus_id = v_campus and deleted_at is null;
    if v_location is null then
      raise exception 'invalid location' using errcode = '22023';
    end if;
  end if;

  insert into public.issues (org_id, campus_id, location_id, asset_id, category_id, title, description, priority,
    source, is_anonymous, tracking_token_hash, number)
  values (v_org, v_campus, coalesce(v_location, l.id, a.location_id), a.id, p_category_id, p_title, p_description,
    p_priority, case when p_qr_token is not null then 'qr' else 'anonymous' end, true,
    app.sha256(v_token), '')
  returning id, number into v_id, v_number;
  return query select v_id, v_number, v_token;
end $$;
revoke execute on function public.submit_public_report(text, text, text, uuid, text, uuid, text, uuid) from public, anon, authenticated;
