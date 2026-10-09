import { afterAll, describe, expect, it } from "vitest";
import { pool, withSession } from "./helpers";

afterAll(() => pool.end());

const rnd = () => Math.random().toString(36).slice(2, 8);

const actions = (s: { q: <T>(sql: string, p?: unknown[]) => Promise<T[]> }, type: string, id: string) =>
  s.q<{ action: string }>("select action from activity_log where entity_type = $1 and entity_id = $2 order by id", [type, id]).then((r) => r.map((x) => x.action));

describe("assets", () => {
  it("sub-categories, warranties, condition, AMC, transfers and audits are logged on the asset", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`, "Owner");
      const o = await s.org(owner);
      const fm = await s.user(`fm-${rnd()}@x.test`, "Farah Manager");
      const staff = await s.user(`st-${rnd()}@x.test`, "Sam Staff");
      await s.member(o.orgId, fm, "facility_manager", { campusId: o.campusA });
      await s.member(o.orgId, staff, "staff");
      await s.asAdmin();
      const it = await s.val<string>(
        "insert into asset_categories (org_id, name, code, depreciation_method, useful_life_months) values ($1, 'IT', 'IT', 'slm', 60) returning id",
        [o.orgId],
      );
      const laptops = await s.val<string>(
        "insert into asset_categories (org_id, parent_id, name, code, depreciation_method, useful_life_months) values ($1, $2, 'Laptops', 'LAP', 'slm', 36) returning id",
        [o.orgId, it],
      );
      const furniture = await s.val<string>("insert into asset_categories (org_id, name, code) values ($1, 'Furniture', 'FUR') returning id", [o.orgId]);
      const vendor = await s.val<string>("insert into vendors (org_id, name, status) values ($1, 'Acme Services', 'approved') returning id", [o.orgId]);

      await s.as(fm);
      // picking only the sub-category fills in its parent; depreciation comes from the sub-category
      const [a] = await s.q<{ id: string; category_id: string; useful_life_months: number; asset_tag: string }>(
        `insert into assets (org_id, campus_id, subcategory_id, name, asset_tag, purchase_date, purchase_cost, warranty_start, warranty_until, installed_on, custodian_id)
         values ($1, $2, $3, 'Laptop 14"', '', '2026-04-01', 60000, '2026-04-01', '2027-03-31', '2026-04-05', $4)
         returning id, category_id, useful_life_months, asset_tag`,
        [o.orgId, o.campusA, laptops, staff],
      );
      expect(a.category_id).toBe(it);
      expect(a.useful_life_months).toBe(36);
      expect(a.asset_tag).toMatch(/^IT-/);
      expect(await s.error("update assets set category_id = $2 where id = $1", [a.id, furniture])).toMatch(/does not belong/);
      expect(await s.error("update assets set warranty_until = '2026-01-01' where id = $1", [a.id])).toMatch(/warranty_dates/);

      // additional warranty with a document
      const att = await s.val<string>(
        "insert into attachments (org_id, entity_type, entity_id, path, file_name, mime_type, size_bytes, kind, uploaded_by) values ($1, 'asset', $2, $4, 'w.pdf', 'application/pdf', 10, 'warranty', $3) returning id",
        [o.orgId, a.id, fm, `${o.orgId}/w.pdf`],
      );
      await s.q(
        "insert into asset_warranties (org_id, asset_id, warranty_type, provider, vendor_id, start_date, end_date, cost, attachment_id) values ($1, $2, 'extended', 'Dell', $3, '2027-04-01', '2029-03-31', 8000, $4)",
        [o.orgId, a.id, vendor, att],
      );

      // the custodian can record a condition, and it updates the asset
      await s.as(staff);
      await s.q("insert into asset_condition_logs (org_id, asset_id, condition, notes) values ($1, $2, 'fair', 'Hinge loose')", [o.orgId, a.id]);
      expect(await s.error("update asset_condition_logs set notes = 'x' where asset_id = $1 returning id", [a.id])).toBeNull();
      expect(await s.q("select id from asset_condition_logs where asset_id = $1 and notes = 'x'", [a.id])).toHaveLength(0);
      expect(await s.error("insert into asset_warranties (org_id, asset_id, start_date, end_date) values ($1, $2, '2027-01-01', '2028-01-01')", [o.orgId, a.id])).toMatch(/row-level security/);

      await s.as(fm);
      const [cond] = await s.q<{ condition: string; previous_condition: string | null }>(
        "select l.condition, l.previous_condition from asset_condition_logs l where asset_id = $1", [a.id]);
      expect(cond).toEqual({ condition: "fair", previous_condition: null });
      expect(await s.val("select condition from assets where id = $1", [a.id])).toBe("fair");

      // AMC link, transfer, audit
      const amc = await s.val<string>(
        "insert into amc_contracts (org_id, campus_id, vendor_id, title, start_date, end_date) values ($1, $2, $3, 'IT AMC', '2026-04-01', '2027-03-31') returning id",
        [o.orgId, o.campusA, vendor],
      );
      await s.q("insert into amc_contract_assets (amc_contract_id, asset_id, org_id) values ($1, $2, $3)", [amc, a.id, o.orgId]);
      await s.q("insert into asset_transfers (org_id, asset_id, from_campus_id, to_campus_id, reason, requested_by) values ($1, $2, $3, $3, 'Moved to lab', $4)", [o.orgId, a.id, o.campusA, fm]);
      await s.q("update asset_transfers set status = 'completed' where asset_id = $1", [a.id]);
      const audit = await s.val<string>("insert into asset_verification_audits (org_id, campus_id, name) values ($1, $2, 'Term 1') returning id", [o.orgId, o.campusA]);
      await s.q("select asset_audit_populate($1)", [audit]);
      await s.q("update asset_verification_items set result = 'found', condition = 'good', verified_at = now() where audit_id = $1 and asset_id = $2", [audit, a.id]);
      expect(await s.val("select condition from assets where id = $1", [a.id])).toBe("good");

      await s.asAdmin();
      expect(await actions(s, "asset", a.id)).toEqual(expect.arrayContaining([
        "created", "warranty_added", "updated", "amc_linked", "transfer_requested", "transfer_completed", "verification_found",
      ]));

      // reminder for the extended warranty a month before it ends
      const n = await s.val<number>("select app.send_more_expiry_alerts('2029-03-10')");
      expect(n).toBeGreaterThan(0);
      expect(await s.q("select id from notifications where user_id = $1 and type = 'reminder.warranty_expiry' and body like 'Extended warranty from Dell%'", [fm])).toHaveLength(1);
    }));
});

describe("vendors", () => {
  it("captures category, campuses served, contract and SLA; documents and agreements are logged", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`, "Owner");
      const o = await s.org(owner);
      const admin = await s.user(`a-${rnd()}@x.test`, "Asha Admin");
      await s.member(o.orgId, admin, "admin");
      await s.asAdmin();
      const cat = await s.val<string>("insert into service_categories (org_id, name) values ($1, 'Electrical') returning id", [o.orgId]);
      await s.as(owner);
      const [v] = await s.q<{ id: string }>(
        `insert into vendors (org_id, name, status, category_id, campus_ids, contract_type, contract_start, contract_end, sla_response_hours, sla_resolution_hours)
         values ($1, 'Volt Co', 'approved', $2, array[$3]::uuid[], 'annual', '2026-04-01', '2026-10-20', 4, 24) returning id`,
        [o.orgId, cat, o.campusA],
      );
      expect(await s.error("update vendors set contract_end = '2026-01-01' where id = $1", [v.id])).toMatch(/contract_dates/);
      expect(await s.error("update vendors set contract_type = 'forever' where id = $1", [v.id])).toMatch(/contract_type/);
      expect(await s.q("select id from vendors where campus_ids @> array[$1]::uuid[]", [o.campusA])).toHaveLength(1);
      const doc = await s.val<string>("insert into vendor_documents (org_id, vendor_id, doc_type, doc_number) values ($1, $2, 'sla', 'SLA-1') returning id", [o.orgId, v.id]);
      await s.q("update vendor_documents set verification_status = 'verified' where id = $1", [doc]);
      await s.q("insert into vendor_agreements (org_id, vendor_id, title, start_date) values ($1, $2, 'Annual electrical', '2026-04-01')", [o.orgId, v.id]);
      await s.asAdmin();
      expect(await actions(s, "vendor", v.id)).toEqual(expect.arrayContaining(["created", "document_added", "document_verified", "agreement_added"]));
      await s.val("select app.send_more_expiry_alerts('2026-10-09')");
      expect(await s.q("select id from notifications where user_id = $1 and title = 'Vendor contract ending: Volt Co'", [admin])).toHaveLength(1);
    }));
});
