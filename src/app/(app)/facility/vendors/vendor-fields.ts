import type { FieldSpec } from "@/components/shared/resource-form";

export const vendorFields: FieldSpec[] = [
  { name: "name", label: "Name", required: true },
  { name: "legal_name", label: "Legal name" },
  { name: "vendor_type", label: "Type", type: "select", options: [{ value: "service", label: "Service" }, { value: "supplier", label: "Supplier" }, { value: "both", label: "Both" }] },
  { name: "contact_name", label: "Contact person" },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone" },
  { name: "address", label: "Address", full: true },
  { name: "city", label: "City" },
  { name: "state", label: "State" },
  { name: "pincode", label: "PIN code" },
  { name: "gstin", label: "GSTIN", placeholder: "29ABCDE1234F1Z5" },
  { name: "pan", label: "PAN", placeholder: "ABCDE1234F" },
  { name: "msme_number", label: "MSME / Udyam number" },
  { name: "bank_account_name", label: "Bank account name" },
  { name: "bank_account_number", label: "Account number" },
  { name: "bank_ifsc", label: "IFSC" },
  { name: "bank_name", label: "Bank" },
  { name: "payment_terms_days", label: "Payment terms (days)", type: "number" },
  { name: "service_category_ids", label: "Services", type: "resources", endpoint: "/service-categories" },
  { name: "notes", label: "Notes", type: "textarea" },
];
