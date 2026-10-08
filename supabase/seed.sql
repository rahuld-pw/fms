-- =============================================================================
-- Demo data: "Greenfield International School" with two campuses.
-- All demo users share the password: Password123!
--
--   owner@greenfield.test        Owner (superuser)
--   facilities@greenfield.test   Facility Manager (Main campus)
--   tech@greenfield.test         Technician (Main campus)
--   finance@greenfield.test      Finance Manager (org)
--   procurement@greenfield.test  Procurement Officer (org)
--   hod.science@greenfield.test  Department Head (Science, Main)
--   teacher@greenfield.test      Staff (reports to HOD Science)
--   auditor@greenfield.test      Auditor (read-only)
--   admin@platform.test          Platform super admin (no organisation)
-- =============================================================================

do $seed$
declare
  v_org uuid := '00000000-0000-4000-8000-000000000001';
  v_main uuid := '00000000-0000-4000-8000-000000000011';
  v_city uuid := '00000000-0000-4000-8000-000000000012';
  v_owner uuid := '00000000-0000-4000-8000-000000000101';
  v_fm uuid := '00000000-0000-4000-8000-000000000102';
  v_tech uuid := '00000000-0000-4000-8000-000000000103';
  v_fin uuid := '00000000-0000-4000-8000-000000000104';
  v_proc uuid := '00000000-0000-4000-8000-000000000105';
  v_hod uuid := '00000000-0000-4000-8000-000000000106';
  v_teacher uuid := '00000000-0000-4000-8000-000000000107';
  v_auditor uuid := '00000000-0000-4000-8000-000000000108';
  v_platform uuid := '00000000-0000-4000-8000-000000000109';
  d_admin uuid; d_sci uuid; d_sports uuid; d_it uuid; d_fac uuid; d_city_admin uuid;
  b_main uuid; b_lab uuid; f_g uuid; f_1 uuid; r_chem uuid; r_phy uuid; r_101 uuid; r_staff uuid; r_server uuid; a_ground uuid;
  b_city uuid; r_city_hall uuid;
  ic_elec uuid; ic_plumb uuid; ic_house uuid; ic_it uuid; ic_furn uuid; ic_hvac uuid; ic_civil uuid;
  ac_it uuid; ac_fur uuid; ac_ele uuid; ac_lab uuid; ac_veh uuid;
  v_cool uuid; v_spark uuid; v_lab uuid; v_clean uuid; v_lift uuid;
  sc_hvac uuid; sc_elec uuid; sc_lab uuid; sc_clean uuid; sc_lift uuid;
  a_dg uuid; a_ac1 uuid; a_lift uuid; a_proj uuid; a_bus uuid;
  amc_lift uuid; ct_dg uuid; ct_ac uuid;
  fy uuid;
  ec_travel uuid; ec_lab uuid; ec_maint uuid; ec_events uuid; ec_it uuid; ec_office uuid;
  t_ops uuid; p_annual uuid; p_audit uuid; s1 uuid; s2 uuid; s3 uuid; t1 uuid; t2 uuid;
  i_micro uuid; i_chair uuid;
  r_id uuid;
  v_po uuid;
  v_claim uuid;
  u record;
begin
  -- Users ------------------------------------------------------------------
  insert into public.platform_admin_emails (email) values ('admin@platform.test') on conflict do nothing;
  for u in select * from (values
    (v_owner, 'owner@greenfield.test', 'Anita Sharma'),
    (v_fm, 'facilities@greenfield.test', 'Rakesh Verma'),
    (v_tech, 'tech@greenfield.test', 'Suresh Kumar'),
    (v_fin, 'finance@greenfield.test', 'Meera Iyer'),
    (v_proc, 'procurement@greenfield.test', 'Vikram Singh'),
    (v_hod, 'hod.science@greenfield.test', 'Dr. Kavita Rao'),
    (v_teacher, 'teacher@greenfield.test', 'Arjun Mehta'),
    (v_auditor, 'auditor@greenfield.test', 'Priya Nair'),
    (v_platform, 'admin@platform.test', 'Platform Admin')
  ) as x(id, email, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(), '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      'email', now(), now(), now())
    on conflict do nothing;
  end loop;
  update public.profiles set phone = '+91 98450 00001' where id = v_fm;
  update public.profiles set phone = '+91 98450 00002' where id = v_tech;

  -- Organisation -----------------------------------------------------------
  insert into public.organisations (id, name, slug, timezone, currency, settings, created_by)
  values (v_org, 'Greenfield International School', 'greenfield', 'Asia/Kolkata', 'INR',
    '{"three_way_match_price_tolerance_pct": 1, "three_way_match_qty_tolerance_pct": 0, "public_issue_reporting": true}', v_owner);
  insert into public.campuses (id, org_id, name, code, address, city, state, pincode, gstin) values
    (v_main, v_org, 'Main Campus', 'MAIN', '12 Lake View Road, Whitefield', 'Bengaluru', 'Karnataka', '560066', '29AAACG1234F1Z5'),
    (v_city, v_org, 'City Campus', 'CITY', '45 MG Road', 'Bengaluru', 'Karnataka', '560001', '29AAACG1234F2Z4');
  perform app.bootstrap_org(v_org, v_owner);

  insert into public.departments (org_id, campus_id, name, code) values (v_org, v_main, 'Administration', 'ADM') returning id into d_admin;
  insert into public.departments (org_id, campus_id, name, code, head_user_id) values (v_org, v_main, 'Science', 'SCI', v_hod) returning id into d_sci;
  insert into public.departments (org_id, campus_id, name, code) values (v_org, v_main, 'Sports', 'SPO') returning id into d_sports;
  insert into public.departments (org_id, campus_id, name, code) values (v_org, v_main, 'IT', 'IT') returning id into d_it;
  insert into public.departments (org_id, campus_id, name, code) values (v_org, v_main, 'Facilities', 'FAC') returning id into d_fac;
  insert into public.departments (org_id, campus_id, name, code) values (v_org, v_city, 'Administration', 'ADM') returning id into d_city_admin;

  insert into public.academic_years (org_id, label, start_date, end_date) values
    (v_org, 'AY 2026-27', '2026-06-01', '2027-03-31');

  -- Members & roles ----------------------------------------------------------
  insert into public.org_members (org_id, user_id, status, title, campus_id, department_id, manager_id) values
    (v_org, v_fm, 'active', 'Facility Manager', v_main, d_fac, v_owner),
    (v_org, v_tech, 'active', 'Senior Technician', v_main, d_fac, v_fm),
    (v_org, v_fin, 'active', 'Finance Manager', v_main, d_admin, v_owner),
    (v_org, v_proc, 'active', 'Procurement Officer', v_main, d_admin, v_fin),
    (v_org, v_hod, 'active', 'HOD Science', v_main, d_sci, v_owner),
    (v_org, v_teacher, 'active', 'Physics Teacher', v_main, d_sci, v_hod),
    (v_org, v_auditor, 'active', 'Internal Auditor', v_main, d_admin, v_owner)
  on conflict (org_id, user_id) do nothing;
  update public.org_members set title = 'Principal', campus_id = v_main, department_id = d_admin where org_id = v_org and user_id = v_owner;

  insert into public.user_role_assignments (org_id, user_id, role_id, scope_type, campus_id, department_id)
  select v_org, x.u, r.id, x.scope, x.campus, x.dept
  from (values
    (v_fm, 'facility_manager', 'campus', v_main, null::uuid),
    (v_tech, 'technician', 'campus', v_main, null),
    (v_fin, 'finance_manager', 'org', null, null),
    (v_proc, 'procurement_officer', 'org', null, null),
    (v_hod, 'department_head', 'department', null, d_sci),
    (v_auditor, 'auditor', 'org', null, null),
    (v_fm, 'staff', 'org', null, null), (v_tech, 'staff', 'org', null, null), (v_fin, 'staff', 'org', null, null),
    (v_proc, 'staff', 'org', null, null), (v_hod, 'staff', 'org', null, null), (v_teacher, 'staff', 'org', null, null)
  ) as x(u, role_key, scope, campus, dept)
  join public.roles r on r.org_id = v_org and r.key = x.role_key
  on conflict do nothing;

  -- Locations -----------------------------------------------------------------
  insert into public.locations (org_id, campus_id, type, name, code, qr_token) values (v_org, v_main, 'building', 'Academic Block A', 'A', 'demo-block-a') returning id into b_main;
  insert into public.locations (org_id, campus_id, parent_id, type, name, code, qr_token) values (v_org, v_main, b_main, 'floor', 'Ground Floor', 'A-G', 'demo-a-g') returning id into f_g;
  insert into public.locations (org_id, campus_id, parent_id, type, name, code, qr_token) values (v_org, v_main, b_main, 'floor', 'First Floor', 'A-1', 'demo-a-1') returning id into f_1;
  insert into public.locations (org_id, campus_id, parent_id, type, name, code, capacity, qr_token) values (v_org, v_main, f_g, 'room', 'Room 101', 'A-101', 40, 'demo-room-101') returning id into r_101;
  insert into public.locations (org_id, campus_id, parent_id, type, name, code, capacity, qr_token) values (v_org, v_main, f_g, 'room', 'Staff Room', 'A-STF', 25, 'demo-staff-room') returning id into r_staff;
  insert into public.locations (org_id, campus_id, parent_id, type, name, code, qr_token) values (v_org, v_main, f_1, 'room', 'Server Room', 'A-SRV', 'demo-server-room') returning id into r_server;
  insert into public.locations (org_id, campus_id, type, name, code, qr_token) values (v_org, v_main, 'building', 'Science Block', 'S', 'demo-science-block') returning id into b_lab;
  insert into public.locations (org_id, campus_id, parent_id, type, name, code, capacity, qr_token) values (v_org, v_main, b_lab, 'room', 'Chemistry Lab', 'S-CHEM', 30, 'demo-chem-lab') returning id into r_chem;
  insert into public.locations (org_id, campus_id, parent_id, type, name, code, capacity, qr_token) values (v_org, v_main, b_lab, 'room', 'Physics Lab', 'S-PHY', 30, 'demo-physics-lab') returning id into r_phy;
  insert into public.locations (org_id, campus_id, type, name, code, qr_token) values (v_org, v_main, 'area', 'Sports Ground', 'GRD', 'demo-ground') returning id into a_ground;
  insert into public.locations (org_id, campus_id, type, name, code, qr_token) values (v_org, v_city, 'building', 'City Block', 'C', 'demo-city-block') returning id into b_city;
  insert into public.locations (org_id, campus_id, parent_id, type, name, code, qr_token) values (v_org, v_city, b_city, 'room', 'Assembly Hall', 'C-HALL', 'demo-city-hall') returning id into r_city_hall;

  -- Service & issue categories ---------------------------------------------------
  insert into public.service_categories (org_id, name) values (v_org, 'HVAC') returning id into sc_hvac;
  insert into public.service_categories (org_id, name) values (v_org, 'Electrical') returning id into sc_elec;
  insert into public.service_categories (org_id, name) values (v_org, 'Lab supplies') returning id into sc_lab;
  insert into public.service_categories (org_id, name) values (v_org, 'Housekeeping') returning id into sc_clean;
  insert into public.service_categories (org_id, name) values (v_org, 'Lifts') returning id into sc_lift;

  insert into public.issue_categories (org_id, name, icon, default_priority, default_assignee_id, auto_create, position) values (v_org, 'Electrical', 'zap', 'high', v_tech, 'work_order', 1) returning id into ic_elec;
  insert into public.issue_categories (org_id, name, icon, default_priority, default_assignee_id, auto_create, position) values (v_org, 'Plumbing', 'droplet', 'high', v_tech, 'work_order', 2) returning id into ic_plumb;
  insert into public.issue_categories (org_id, name, icon, default_priority, position, response_minutes, resolution_minutes) values (v_org, 'Housekeeping', 'sparkles', 'low', 3, 120, 480) returning id into ic_house;
  insert into public.issue_categories (org_id, name, icon, default_priority, position) values (v_org, 'IT & AV', 'monitor', 'medium', 4) returning id into ic_it;
  insert into public.issue_categories (org_id, name, icon, default_priority, position) values (v_org, 'Furniture', 'armchair', 'low', 5) returning id into ic_furn;
  insert into public.issue_categories (org_id, name, icon, default_priority, default_assignee_id, position) values (v_org, 'AC / HVAC', 'wind', 'medium', v_tech, 6) returning id into ic_hvac;
  insert into public.issue_categories (org_id, name, icon, default_priority, position) values (v_org, 'Civil / Building', 'building', 'medium', 7) returning id into ic_civil;

  -- Vendors -------------------------------------------------------------------------
  insert into public.vendors (org_id, vendor_code, name, legal_name, status, vendor_type, contact_name, email, phone, city, state, gstin, pan,
    bank_account_name, bank_account_number, bank_ifsc, bank_name, service_category_ids, created_by)
  values (v_org, app.next_number(v_org, 'vendor'), 'CoolAir Services', 'CoolAir Services Pvt Ltd', 'approved', 'service', 'Mahesh', 'service@coolair.test', '+91 99000 11111',
    'Bengaluru', 'Karnataka', '29AABCC1234D1Z5', 'AABCC1234D', 'CoolAir Services Pvt Ltd', '50100012345678', 'HDFC0000123', 'HDFC Bank', array[sc_hvac], v_fm)
  returning id into v_cool;
  insert into public.vendors (org_id, vendor_code, name, legal_name, status, vendor_type, contact_name, email, phone, city, state, gstin, pan,
    bank_account_name, bank_account_number, bank_ifsc, bank_name, service_category_ids, created_by)
  values (v_org, app.next_number(v_org, 'vendor'), 'Spark Electricals', 'Spark Electricals', 'approved', 'both', 'Ramesh', 'hello@spark.test', '+91 99000 22222',
    'Bengaluru', 'Karnataka', '29AAFFS5678K1Z1', 'AAFFS5678K', 'Spark Electricals', '1234567890', 'ICIC0000456', 'ICICI Bank', array[sc_elec], v_fm)
  returning id into v_spark;
  insert into public.vendors (org_id, vendor_code, name, legal_name, status, vendor_type, contact_name, email, phone, city, state, gstin, pan,
    bank_account_name, bank_account_number, bank_ifsc, bank_name, service_category_ids, created_by)
  values (v_org, app.next_number(v_org, 'vendor'), 'LabLine Scientific', 'LabLine Scientific LLP', 'approved', 'supplier', 'Neha', 'sales@labline.test', '+91 99000 33333',
    'Mumbai', 'Maharashtra', '27AAKFL9012M1Z8', 'AAKFL9012M', 'LabLine Scientific LLP', '0012345000999', 'SBIN0001234', 'State Bank of India', array[sc_lab], v_proc)
  returning id into v_lab;
  insert into public.vendors (org_id, vendor_code, name, status, vendor_type, contact_name, email, phone, city, service_category_ids, created_by)
  values (v_org, app.next_number(v_org, 'vendor'), 'Sparkle Housekeeping', 'approved', 'service', 'Lakshmi', 'ops@sparkle.test', '+91 99000 44444', 'Bengaluru', array[sc_clean], v_fm)
  returning id into v_clean;
  insert into public.vendors (org_id, name, status, vendor_type, contact_name, email, phone, city, service_category_ids, created_by)
  values (v_org, 'UpLift Elevators', 'submitted', 'service', 'Imran', 'support@uplift.test', '+91 99000 55555', 'Bengaluru', array[sc_lift], v_fm)
  returning id into v_lift;

  insert into public.vendor_documents (org_id, vendor_id, doc_type, doc_number, expires_on, verification_status, verified_by, verified_at) values
    (v_org, v_cool, 'pan_card', 'AABCC1234D', null, 'verified', v_fm, now()),
    (v_org, v_cool, 'cancelled_cheque', null, null, 'verified', v_fm, now()),
    (v_org, v_cool, 'insurance', 'POL-778812', current_date + 20, 'verified', v_fm, now()),
    (v_org, v_spark, 'license', 'EL/KA/2211', current_date + 75, 'verified', v_fm, now()),
    (v_org, v_lift, 'pan_card', null, null, 'pending', null, null);
  insert into public.vendor_agreements (org_id, vendor_id, title, agreement_type, start_date, end_date, value, renewal_reminder_days) values
    (v_org, v_clean, 'Housekeeping services 2026', 'service', '2026-04-01', '2027-03-31', 1800000, 45),
    (v_org, v_cool, 'HVAC rate contract', 'rate_contract', '2025-11-01', current_date + 25, 450000, 30);
  insert into public.vendor_ratings (org_id, vendor_id, rating, quality, timeliness, comment, rated_by) values
    (v_org, v_cool, 4, 4, 3, 'Good work, sometimes late', v_fm),
    (v_org, v_spark, 5, 5, 5, 'Very responsive', v_fm),
    (v_org, v_clean, 3, 3, 4, null, v_owner);

  -- Assets ----------------------------------------------------------------------------
  insert into public.asset_categories (org_id, name, code, depreciation_method, useful_life_months, wdv_rate_percent, salvage_percent, verification_frequency_months) values
    (v_org, 'IT Equipment', 'IT', 'slm', 36, null, 5, 6) returning id into ac_it;
  insert into public.asset_categories (org_id, name, code, depreciation_method, useful_life_months, salvage_percent) values (v_org, 'Furniture', 'FUR', 'slm', 120, 5) returning id into ac_fur;
  insert into public.asset_categories (org_id, name, code, depreciation_method, wdv_rate_percent, salvage_percent) values (v_org, 'Electrical & Plant', 'ELE', 'wdv', 15, 5) returning id into ac_ele;
  insert into public.asset_categories (org_id, name, code, depreciation_method, useful_life_months, salvage_percent) values (v_org, 'Lab Equipment', 'LAB', 'slm', 96, 5) returning id into ac_lab;
  insert into public.asset_categories (org_id, name, code, depreciation_method, wdv_rate_percent, salvage_percent) values (v_org, 'Vehicles', 'VEH', 'wdv', 15, 10) returning id into ac_veh;

  insert into public.amc_contracts (org_id, campus_id, vendor_id, title, contract_number, contract_type, coverage, start_date, end_date, value, visits_included, visit_frequency, renewal_reminder_days)
  values (v_org, v_main, v_cool, 'Split AC comprehensive AMC', 'CA/AMC/2026/14', 'comprehensive', 'All split ACs in Academic Block A', '2026-04-01', '2027-03-31', 240000, 4, 'quarterly', 45)
  returning id into amc_lift;

  insert into public.assets (org_id, campus_id, location_id, category_id, department_id, asset_tag, qr_token, name, make, model, serial_number, status, purchase_date, purchase_cost, vendor_id, warranty_until, usage_meter, usage_unit)
  values (v_org, v_main, a_ground, ac_ele, d_fac, '', 'demo-dg-set', 'Diesel Generator 125 kVA', 'Kirloskar', 'KG1-125', 'KG125-88231', 'in_use', '2022-07-15', 1450000, v_spark, '2025-07-14', 1180, 'hours')
  returning id into a_dg;
  insert into public.assets (org_id, campus_id, location_id, category_id, department_id, asset_tag, qr_token, name, make, model, serial_number, status, purchase_date, purchase_cost, vendor_id, warranty_until, amc_contract_id)
  values (v_org, v_main, r_101, ac_ele, d_fac, '', 'demo-ac-101', 'Split AC 2T - Room 101', 'Daikin', 'FTKF60', 'DK60-11902', 'in_use', '2024-03-10', 68000, v_cool, current_date + 21, amc_lift)
  returning id into a_ac1;
  insert into public.assets (org_id, campus_id, location_id, category_id, asset_tag, qr_token, name, make, model, serial_number, status, purchase_date, purchase_cost, warranty_until)
  values (v_org, v_main, b_main, ac_ele, '', 'demo-lift-a', 'Passenger Lift - Block A', 'Otis', 'Gen2', 'OT-55120', 'in_use', '2019-06-01', 2200000, '2021-06-01')
  returning id into a_lift;
  insert into public.assets (org_id, campus_id, location_id, category_id, department_id, asset_tag, qr_token, name, make, model, serial_number, status, purchase_date, purchase_cost, custodian_id, warranty_until)
  values (v_org, v_main, r_phy, ac_it, d_sci, '', 'demo-projector-phy', 'Projector - Physics Lab', 'Epson', 'EB-X51', 'EPX51-0042', 'in_use', '2025-01-20', 54000, v_teacher, '2027-01-19')
  returning id into a_proj;
  insert into public.assets (org_id, campus_id, category_id, asset_tag, qr_token, name, make, model, serial_number, status, purchase_date, purchase_cost)
  values (v_org, v_main, ac_veh, '', 'demo-bus-1', 'School Bus KA-01-AB-1234', 'Tata', 'Starbus 40', 'MAT4401234', 'in_use', '2021-05-01', 2800000)
  returning id into a_bus;
  insert into public.assets (org_id, campus_id, location_id, category_id, department_id, asset_tag, name, make, model, status, purchase_date, purchase_cost, custodian_id)
  select v_org, v_main, r_staff, ac_it, d_admin, '', 'Laptop ' || g, 'Dell', 'Latitude 5440', case when g <= 6 then 'in_use' else 'in_stock' end,
    '2025-06-10', 72000, case when g <= 2 then v_teacher when g <= 4 then v_hod else null end
  from generate_series(1, 8) g;
  insert into public.assets (org_id, campus_id, location_id, category_id, asset_tag, name, status, purchase_date, purchase_cost)
  select v_org, v_main, r_101, ac_fur, '', 'Student desk ' || g, 'in_use', '2023-05-01', 4500 from generate_series(1, 12) g;
  insert into public.amc_contract_assets (amc_contract_id, asset_id, org_id) values (amc_lift, a_ac1, v_org);

  -- Checklists & PM -------------------------------------------------------------------
  insert into public.checklist_templates (org_id, name, items) values (v_org, 'DG monthly service', '[
    {"key":"oil","label":"Check engine oil level","type":"check","required":true},
    {"key":"coolant","label":"Check coolant level","type":"check","required":true},
    {"key":"battery","label":"Battery voltage (V)","type":"number","required":true},
    {"key":"run","label":"Run on load for 15 minutes","type":"check","required":true},
    {"key":"remarks","label":"Remarks","type":"text","required":false}]') returning id into ct_dg;
  insert into public.checklist_templates (org_id, name, items) values (v_org, 'AC quarterly service', '[
    {"key":"filter","label":"Clean filters","type":"check","required":true},
    {"key":"gas","label":"Gas pressure (psi)","type":"number","required":true},
    {"key":"drain","label":"Clear drain line","type":"check","required":false}]') returning id into ct_ac;

  insert into public.pm_schedules (org_id, campus_id, asset_id, title, trigger_type, frequency, next_due_date, lead_days, checklist_template_id, assignee_id, priority)
  values (v_org, v_main, a_dg, 'DG monthly service', 'time', 'monthly', current_date + 2, 3, ct_dg, v_tech, 'high');
  insert into public.pm_schedules (org_id, campus_id, asset_id, title, trigger_type, usage_interval, last_usage_reading, checklist_template_id, vendor_id, priority)
  values (v_org, v_main, a_dg, 'DG oil change (every 250 h)', 'usage', 250, 1000, ct_dg, v_spark, 'medium');
  insert into public.pm_schedules (org_id, campus_id, asset_id, title, trigger_type, frequency, next_due_date, lead_days, checklist_template_id, vendor_id, amc_contract_id, requires_vendor_booking)
  values (v_org, v_main, a_ac1, 'AC quarterly service (AMC)', 'time', 'quarterly', current_date + 10, 7, ct_ac, v_cool, amc_lift, true);

  insert into public.compliance_items (org_id, campus_id, location_id, title, compliance_type, authority, frequency_months, last_done_on, next_due_on, reminder_days, responsible_user_id) values
    (v_org, v_main, b_main, 'Fire NOC renewal', 'fire_safety', 'Karnataka State Fire & Emergency Services', 12, current_date - 340, current_date + 25, 45, v_fm),
    (v_org, v_main, b_main, 'Lift safety inspection', 'lift', 'Department of Electrical Inspectorate', 12, current_date - 380, current_date - 15, 30, v_fm),
    (v_org, v_main, null, 'Overhead water tank cleaning', 'water_tank', null, 6, current_date - 150, current_date + 30, 15, v_tech),
    (v_org, v_main, null, 'Pest control', 'pest_control', null, 3, current_date - 60, current_date + 30, 7, v_fm),
    (v_org, v_city, null, 'Fire extinguisher refilling', 'fire_safety', null, 12, current_date - 100, current_date + 265, 30, null);

  -- Issues ------------------------------------------------------------------------------
  insert into public.issues (org_id, campus_id, location_id, category_id, title, description, reporter_id, number, priority, created_at)
  values (v_org, v_main, r_101, ic_hvac, 'AC not cooling in Room 101', 'Room is very warm after 11am', v_teacher, '', null, now() - interval '3 hours');
  insert into public.issues (org_id, campus_id, location_id, category_id, title, description, reporter_id, number, priority, created_at)
  values (v_org, v_main, r_chem, ic_plumb, 'Sink tap leaking in Chemistry Lab', 'Continuous drip from tap 3', v_hod, '', null, now() - interval '2 days');
  insert into public.issues (org_id, campus_id, location_id, category_id, title, reporter_id, number, priority, created_at)
  values (v_org, v_main, r_phy, ic_it, 'Projector flickering', v_teacher, '', 'medium', now() - interval '5 days');
  insert into public.issues (org_id, campus_id, location_id, category_id, title, number, priority, source, is_anonymous, created_at)
  values (v_org, v_main, a_ground, ic_house, 'Litter near the sports ground', '', null, 'qr', true, now() - interval '1 day');
  insert into public.issues (org_id, campus_id, location_id, category_id, title, reporter_id, number, priority, created_at)
  values (v_org, v_city, r_city_hall, ic_furn, 'Broken chairs in assembly hall', v_owner, '', null, now() - interval '10 days');
  update public.issues set status = 'in_progress', first_response_at = created_at + interval '20 minutes'
    where org_id = v_org and title = 'Projector flickering';
  update public.issues set status = 'resolved', resolution_notes = 'Replaced 6 chairs', assignee_id = v_fm
    where org_id = v_org and title = 'Broken chairs in assembly hall';

  -- Expense ----------------------------------------------------------------------------
  fy := app.fiscal_year_for(v_org, current_date);
  perform app.fiscal_year_for(v_org, (current_date + interval '1 year')::date);
  insert into public.expense_categories (org_id, name, code, per_claim_limit, limit_mode, receipt_required_above) values (v_org, 'Travel & Conveyance', 'TRV', 15000, 'soft', 500) returning id into ec_travel;
  insert into public.expense_categories (org_id, name, code, receipt_required_above) values (v_org, 'Lab Consumables', 'LAB', 0) returning id into ec_lab;
  insert into public.expense_categories (org_id, name, code) values (v_org, 'Repairs & Maintenance', 'RNM') returning id into ec_maint;
  insert into public.expense_categories (org_id, name, code, per_claim_limit, limit_mode) values (v_org, 'Events & Functions', 'EVT', 50000, 'hard') returning id into ec_events;
  insert into public.expense_categories (org_id, name, code) values (v_org, 'IT & Software', 'ITS') returning id into ec_it;
  insert into public.expense_categories (org_id, name, code, receipt_required_above) values (v_org, 'Office Supplies', 'OFF', 200) returning id into ec_office;

  insert into public.budgets (org_id, fiscal_year_id, campus_id, department_id, category_id, allocated_amount, control_mode) values
    (v_org, fy, v_main, d_sci, ec_lab, 600000, 'hard'),
    (v_org, fy, v_main, d_sci, ec_travel, 150000, 'soft'),
    (v_org, fy, v_main, d_fac, ec_maint, 1200000, 'soft'),
    (v_org, fy, v_main, d_it, ec_it, 900000, 'soft'),
    (v_org, fy, v_main, d_sports, ec_events, 300000, 'hard'),
    (v_org, fy, v_main, d_admin, ec_office, 200000, 'soft'),
    (v_org, fy, v_city, null, ec_maint, 400000, 'soft');

  insert into public.petty_cash_funds (org_id, campus_id, department_id, name, custodian_id, float_amount, balance, low_balance_threshold)
  values (v_org, v_main, d_fac, 'Facilities petty cash', v_fm, 20000, 0, 3000);
  insert into public.petty_cash_transactions (org_id, fund_id, txn_type, amount, description, created_by)
  select v_org, id, 'topup', 20000, 'Opening float', v_fin from public.petty_cash_funds where org_id = v_org;
  insert into public.petty_cash_transactions (org_id, fund_id, txn_type, amount, category_id, description, created_by)
  select v_org, id, 'expense', 850, ec_maint, 'Plumbing fittings', v_fm from public.petty_cash_funds where org_id = v_org;

  insert into public.recurring_expenses (org_id, owner_id, campus_id, department_id, category_id, title, amount, frequency, next_run_date)
  values (v_org, v_fin, v_main, d_it, ec_it, 'Google Workspace subscription', 42000, 'monthly', (date_trunc('month', current_date) + interval '1 month')::date);

  -- claims: one approved (auto), one pending HOD approval, one draft
  perform set_config('request.jwt.claim.sub', v_teacher::text, true);
  insert into public.expense_claims (org_id, campus_id, department_id, claimant_id, title, number, created_by)
  values (v_org, v_main, d_sci, v_teacher, 'Auto fare - science fair supplies run', '', v_teacher) returning id into v_claim;
  insert into public.expense_items (org_id, claim_id, category_id, expense_date, description, merchant, amount)
  values (v_org, v_claim, ec_travel, current_date - 4, 'Auto rickshaw to Avenue Road and back', 'Auto', 380);
  perform public.expense_claim_submit(v_claim);

  insert into public.expense_claims (org_id, campus_id, department_id, claimant_id, title, number, created_by)
  values (v_org, v_main, d_sci, v_teacher, 'Chemicals for Class 12 practicals', '', v_teacher) returning id into v_claim;
  insert into public.expense_items (org_id, claim_id, category_id, expense_date, description, merchant, amount, tax_amount)
  values (v_org, v_claim, ec_lab, current_date - 2, 'Reagents & indicators', 'Bharat Scientific', 7400, 1332);
  insert into public.attachments (org_id, entity_type, entity_id, path, file_name, mime_type, size_bytes, kind, uploaded_by)
  values (v_org, 'expense_claim', v_claim, v_org || '/expense_claim/' || v_claim || '/receipt.pdf', 'receipt.pdf', 'application/pdf', 120000, 'receipt', v_teacher);
  perform public.expense_claim_submit(v_claim);

  insert into public.expense_claims (org_id, campus_id, department_id, claimant_id, title, number, created_by)
  values (v_org, v_main, d_sci, v_teacher, 'Workshop registration - NSTA', '', v_teacher) returning id into v_claim;
  insert into public.expense_items (org_id, claim_id, category_id, expense_date, description, amount)
  values (v_org, v_claim, ec_travel, current_date, 'Registration fee', 3500);
  perform set_config('request.jwt.claim.sub', '', true);

  -- Procurement ---------------------------------------------------------------------
  insert into public.items (org_id, name, sku, unit, hsn_sac, gst_rate, expense_category_id, is_asset, asset_category_id, last_price)
  values (v_org, 'Compound microscope', 'LAB-MIC-01', 'nos', '90118000', 18, ec_lab, true, ac_lab, 14500) returning id into i_micro;
  insert into public.items (org_id, name, sku, unit, hsn_sac, gst_rate, expense_category_id, is_asset, asset_category_id, last_price)
  values (v_org, 'Ergonomic staff chair', 'FUR-CHR-02', 'nos', '94013000', 18, ec_maint, true, ac_fur, 6800) returning id into i_chair;
  insert into public.items (org_id, name, sku, unit, hsn_sac, gst_rate, expense_category_id, last_price)
  values (v_org, 'Beakers 250ml (pack of 12)', 'LAB-BKR-250', 'pack', '70179010', 12, ec_lab, 950);

  perform set_config('request.jwt.claim.sub', v_hod::text, true);
  insert into public.requisitions (org_id, number, campus_id, department_id, category_id, requested_by, title, justification, needed_by, created_by)
  values (v_org, '', v_main, d_sci, ec_lab, v_hod, 'Microscopes for Biology lab', 'Replace 10 old microscopes before practical exams', current_date + 30, v_hod)
  returning id into r_id;
  insert into public.requisition_lines (org_id, requisition_id, item_id, description, quantity, unit, estimated_unit_price)
  values (v_org, r_id, i_micro, 'Compound microscope, 40x-1000x, LED', 10, 'nos', 14500);
  perform public.requisition_submit(r_id);
  perform set_config('request.jwt.claim.sub', '', true);

  -- An approved PO with a partial receipt, so the budget shows commitments
  perform set_config('request.jwt.claim.sub', v_proc::text, true);
  insert into public.purchase_orders (org_id, number, campus_id, department_id, category_id, vendor_id, payment_terms, terms_and_conditions, expected_delivery, created_by)
  values (v_org, '', v_main, d_sci, ec_lab, v_lab, '30 days from invoice', 'Delivery to Science Block stores. Warranty 1 year on all items.', current_date + 10, v_proc)
  returning id into v_po;
  insert into public.po_lines (org_id, po_id, line_no, item_id, description, hsn_sac, quantity, unit, unit_price, tax_rate, is_asset, asset_category_id)
  values (v_org, v_po, 1, i_micro, 'Compound microscope, 40x-1000x, LED', '90118000', 6, 'nos', 14200, 18, true, ac_lab),
         (v_org, v_po, 2, null, 'Beakers 250ml (pack of 12)', '70179010', 10, 'pack', 900, 12, false, null);
  perform public.po_submit(v_po);
  perform set_config('request.jwt.claim.sub', v_hod::text, true);
  perform public.approval_act((select id from public.approval_requests where entity_id = v_po and status = 'pending'), 'approve', 'Approved for lab upgrade');
  perform set_config('request.jwt.claim.sub', v_fin::text, true);
  perform public.approval_act((select id from public.approval_requests where entity_id = v_po and status = 'pending'), 'approve', 'Within budget');
  perform set_config('request.jwt.claim.sub', v_proc::text, true);
  perform public.po_send(v_po);
  perform set_config('request.jwt.claim.sub', '', true);

  -- Tasks ---------------------------------------------------------------------------
  insert into public.teams (org_id, campus_id, name, description, color, created_by) values (v_org, v_main, 'Operations', 'Campus operations team', 'green', v_owner) returning id into t_ops;
  insert into public.team_members (team_id, user_id, org_id, role) values (t_ops, v_owner, v_org, 'lead'), (t_ops, v_fm, v_org, 'member'),
    (t_ops, v_tech, v_org, 'member'), (t_ops, v_fin, v_org, 'member'), (t_ops, v_proc, v_org, 'member');
  insert into public.projects (org_id, team_id, name, description, color, visibility, default_view, owner_id, start_date, due_date, created_by)
  values (v_org, t_ops, 'Annual Day 2026', 'Logistics for the annual day celebration', 'violet', 'org', 'board', v_owner, current_date - 10, current_date + 45, v_owner)
  returning id into p_annual;
  insert into public.project_members (project_id, user_id, org_id, role) values (p_annual, v_owner, v_org, 'admin'), (p_annual, v_fm, v_org, 'editor'), (p_annual, v_teacher, v_org, 'editor');
  insert into public.sections (org_id, project_id, name, position) values (v_org, p_annual, 'To do', 1024) returning id into s1;
  insert into public.sections (org_id, project_id, name, position) values (v_org, p_annual, 'In progress', 2048) returning id into s2;
  insert into public.sections (org_id, project_id, name, position) values (v_org, p_annual, 'Done', 3072) returning id into s3;
  insert into public.tasks (org_id, project_id, section_id, title, priority, due_date, status, created_by) values (v_org, p_annual, s1, 'Book sound & lighting vendor', 'high', current_date + 7, 'todo', v_owner) returning id into t1;
  insert into public.tasks (org_id, project_id, section_id, title, priority, due_date, status, created_by) values (v_org, p_annual, s2, 'Stage design approval', 'medium', current_date + 3, 'in_progress', v_owner) returning id into t2;
  insert into public.tasks (org_id, project_id, section_id, title, priority, due_date, status, created_by) values (v_org, p_annual, s3, 'Fix date with principal', 'low', current_date - 5, 'done', v_owner);
  insert into public.tasks (org_id, project_id, section_id, title, priority, due_date, start_date, created_by) values (v_org, p_annual, s1, 'Seating plan for 1200 guests', 'medium', current_date + 20, current_date + 5, v_owner);
  insert into public.tasks (org_id, project_id, parent_task_id, title, due_date, created_by) values (v_org, p_annual, t1, 'Collect 3 quotes', current_date + 4, v_owner), (v_org, p_annual, t1, 'Raise requisition', current_date + 6, v_owner);
  insert into public.task_assignees (task_id, user_id, org_id) values (t1, v_fm, v_org), (t2, v_teacher, v_org);
  insert into public.task_dependencies (task_id, depends_on_task_id, org_id) values (t1, t2, v_org);

  insert into public.projects (org_id, team_id, name, color, visibility, owner_id, start_date, due_date, created_by)
  values (v_org, t_ops, 'Fire safety audit readiness', 'red', 'team', v_fm, current_date, current_date + 25, v_fm) returning id into p_audit;
  insert into public.project_members (project_id, user_id, org_id, role) values (p_audit, v_fm, v_org, 'admin');
  insert into public.sections (org_id, project_id, name, position) values (v_org, p_audit, 'Checklist', 1024) returning id into s1;
  insert into public.tasks (org_id, project_id, section_id, title, priority, due_date, created_by) values
    (v_org, p_audit, s1, 'Refill expired extinguishers', 'urgent', current_date + 5, v_fm),
    (v_org, p_audit, s1, 'Test fire alarm panel', 'high', current_date + 8, v_fm),
    (v_org, p_audit, s1, 'Update evacuation maps', 'medium', current_date + 12, v_fm);
  insert into public.tasks (org_id, project_id, section_id, title, recurrence, due_date, created_by, priority)
  values (v_org, p_audit, s1, 'Weekly fire exit walkthrough', '{"freq":"weekly","interval":1}', current_date + 2, v_fm, 'medium')
  returning id into t1;
  insert into public.task_assignees (task_id, user_id, org_id) values (t1, v_tech, v_org);

  -- Module settings: issue-to-task target project
  update public.org_modules set settings = jsonb_build_object('issue_task_project_id', p_audit) where org_id = v_org and module = 'tasks';
end
$seed$;

-- A demo API key (read-only facility scope) for trying the API:
--   Authorization: Bearer co_live_demo0000000_seedkey-only-for-local-dev-000000
insert into public.api_keys (org_id, name, prefix, key_hash, scopes, created_by)
values ('00000000-0000-4000-8000-000000000001', 'Local demo (read only)', 'demo0000000',
  encode(extensions.digest('co_live_demo0000000_seedkey-only-for-local-dev-000000', 'sha256'), 'hex'),
  '{issue:read,asset:read,location:read,work_order:read,vendor:read,po:read,expense:read,budget:read,task:read}',
  '00000000-0000-4000-8000-000000000101')
on conflict do nothing;

-- Feedback & NPS demo: a staff pulse (answered in the app) and a parent survey (public link)
do $surveys$
declare
  v_org uuid := '00000000-0000-4000-8000-000000000001';
  v_staff_survey uuid;
  v_parent_survey uuid;
  r record;
begin
  insert into public.surveys (org_id, title, kind, question, follow_up, audience, status, anonymous, created_by)
  values (v_org, 'Staff pulse — October', 'nps', 'How likely are you to recommend Greenfield as a place to work?',
          'What is the main reason for your score?', 'members', 'active', true, '00000000-0000-4000-8000-000000000101')
  returning id into v_staff_survey;
  insert into public.surveys (org_id, title, kind, question, follow_up, audience, status, created_by, public_token)
  values (v_org, 'Parent feedback — Term 1', 'nps', 'How likely are you to recommend Greenfield International School to a friend?',
          'What should we keep doing, or do better?', 'both', 'active', '00000000-0000-4000-8000-000000000101', 'demo-parent-survey')
  returning id into v_parent_survey;

  for r in select * from (values
    ('00000000-0000-4000-8000-000000000102'::uuid, 9, 'Good team, quick decisions.'),
    ('00000000-0000-4000-8000-000000000103'::uuid, 6, 'Too many urgent calls after hours.'),
    ('00000000-0000-4000-8000-000000000104'::uuid, 10, null),
    ('00000000-0000-4000-8000-000000000107'::uuid, 8, 'Projectors in the old block need replacing.')
  ) x(uid, score, comment) loop
    insert into public.survey_responses (org_id, survey_id, score, comment, segment, respondent_id, source, created_at)
    values (v_org, v_staff_survey, r.score, r.comment, 'staff', r.uid, 'in_app', now() - (random() * interval '20 days'));
  end loop;

  for r in select * from (values
    (10, 'Teachers are caring and communicate well.', 'parent', 'Kavya R.'),
    (9, 'Great sports facilities.', 'parent', null),
    (7, 'Bus timings could be better.', 'parent', 'Imran S.'),
    (4, 'Fee reminders are confusing.', 'parent', null),
    (9, null, 'alumni', null),
    (8, 'Library is excellent.', 'student', null)
  ) x(score, comment, segment, name) loop
    insert into public.survey_responses (org_id, survey_id, score, comment, segment, respondent_name, source, created_at)
    values (v_org, v_parent_survey, r.score, r.comment, r.segment, r.name, 'link', now() - (random() * interval '40 days'));
  end loop;

  -- the resolved demo issue was fixed by the technician and rated by its reporter
  update public.issues set resolved_by = coalesce(resolved_by, assignee_id, '00000000-0000-4000-8000-000000000103'),
    rating = 4, feedback = 'Fixed the same day, thank you.'
  where org_id = v_org and status in ('resolved', 'closed') and rating is null;
end
$surveys$;
