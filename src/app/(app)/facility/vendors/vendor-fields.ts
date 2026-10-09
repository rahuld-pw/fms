import type { FieldSpec } from "@/components/shared/resource-form";
import type { TFunction } from "@/lib/i18n/translate";

export const CONTRACT_TYPES = ["amc", "rate_contract", "annual", "retainer", "on_call", "one_time", "other"];

export const vendorFields = (t: TFunction): FieldSpec[] => [
  { name: "name", label: t("ui.name"), required: true },
  { name: "legal_name", label: t("facility.vendors.fields.legalName") },
  { name: "vendor_type", label: t("ui.type"), type: "select", options: [{ value: "service", label: t("facility.vendors.fields.typeService") }, { value: "supplier", label: t("facility.vendors.fields.typeSupplier") }, { value: "both", label: t("facility.vendors.fields.typeBoth") }] },
  { name: "category_id", label: t("ui.category"), type: "resource", endpoint: "/service-categories", hint: t("facility.vendors.fields.categoryHint") },
  { name: "service_category_ids", label: t("facility.vendors.fields.services"), type: "resources", endpoint: "/service-categories" },
  { name: "campus_ids", label: t("facility.vendors.fields.campusesServed"), type: "resources", endpoint: "/campuses", hint: t("facility.vendors.fields.campusesServedHint") },
  { name: "service_area", label: t("facility.vendors.fields.serviceArea"), placeholder: t("facility.vendors.fields.serviceAreaHint") },
  { name: "contact_name", label: t("facility.vendors.fields.contactPerson") },
  { name: "email", label: t("ui.email"), type: "email" },
  { name: "phone", label: t("ui.phone") },
  { name: "address", label: t("facility.vendors.fields.address"), full: true },
  { name: "city", label: t("facility.vendors.fields.city") },
  { name: "state", label: t("facility.vendors.fields.state") },
  { name: "pincode", label: t("facility.vendors.fields.pincode") },
  { name: "gstin", label: t("facility.vendors.fields.gstin"), placeholder: "29ABCDE1234F1Z5" },
  { name: "pan", label: t("facility.vendors.fields.pan"), placeholder: "ABCDE1234F" },
  { name: "msme_number", label: t("facility.vendors.fields.msme") },
  { name: "bank_account_name", label: t("facility.vendors.fields.bankAccountName") },
  { name: "bank_account_number", label: t("facility.vendors.fields.accountNumber") },
  { name: "bank_ifsc", label: t("facility.vendors.fields.ifsc") },
  { name: "bank_name", label: t("facility.vendors.fields.bank") },
  { name: "payment_terms_days", label: t("facility.vendors.fields.paymentTerms"), type: "number" },
  { name: "contract_type", label: t("facility.vendors.fields.contractType"), type: "select", options: CONTRACT_TYPES.map((c) => ({ value: c, label: t(`enum.vendorContractType.${c}`, undefined, c) })) },
  { name: "contract_value", label: t("facility.vendors.fields.contractValue"), type: "money" },
  { name: "contract_start", label: t("facility.vendors.fields.contractStart"), type: "date" },
  { name: "contract_end", label: t("facility.vendors.fields.contractEnd"), type: "date", hint: t("facility.vendors.fields.contractEndHint") },
  { name: "sla_response_hours", label: t("facility.vendors.fields.slaResponse"), type: "number", hint: t("facility.vendors.fields.hours") },
  { name: "sla_resolution_hours", label: t("facility.vendors.fields.slaResolution"), type: "number", hint: t("facility.vendors.fields.hours") },
  { name: "sla_terms", label: t("facility.vendors.fields.slaTerms"), type: "textarea" },
  { name: "penalty_terms", label: t("facility.vendors.fields.penaltyTerms"), type: "textarea" },
  { name: "notes", label: t("ui.notes"), type: "textarea" },
];
