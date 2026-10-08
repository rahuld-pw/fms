import type { FieldSpec } from "@/components/shared/resource-form";
import type { TFunction } from "@/lib/i18n/translate";

export const vendorFields = (t: TFunction): FieldSpec[] => [
  { name: "name", label: t("ui.name"), required: true },
  { name: "legal_name", label: t("facility.vendors.fields.legalName") },
  { name: "vendor_type", label: t("ui.type"), type: "select", options: [{ value: "service", label: t("facility.vendors.fields.typeService") }, { value: "supplier", label: t("facility.vendors.fields.typeSupplier") }, { value: "both", label: t("facility.vendors.fields.typeBoth") }] },
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
  { name: "service_category_ids", label: t("facility.vendors.fields.services"), type: "resources", endpoint: "/service-categories" },
  { name: "notes", label: t("ui.notes"), type: "textarea" },
];
