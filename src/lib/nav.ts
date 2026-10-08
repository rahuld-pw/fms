import {
  BarChart3,
  Boxes,
  Building2,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  FileText,
  FolderKanban,
  Gauge,
  Home,
  Inbox,
  KeyRound,
  Layers,
  type LucideIcon,
  MapPin,
  MessageSquareHeart,
  PackageCheck,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Star,
  Truck,
  Users,
  Wallet,
  Webhook,
  Workflow,
  Wrench,
} from "lucide-react";

/** Modules whose documents go through approvals (Tasks has none). */
export const APPROVAL_MODULES = ["facility", "expense", "po"];
export const hasApprovals = (modules: string[]) => APPROVAL_MODULES.some((m) => modules.includes(m));

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown only when the module is enabled. */
  module?: "facility" | "expense" | "tasks" | "po" | "surveys";
  /** Shown only when the user holds ANY of these permissions (at any scope). */
  anyOf?: string[];
  /** Shown only when a module that uses approvals is enabled. */
  approvals?: boolean;
}

export interface NavSection {
  title?: string;
  module?: NavItem["module"];
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    items: [
      { label: "Home", href: "/", icon: Home },
      { label: "Analytics", href: "/analytics", icon: BarChart3 },
      { label: "Approvals", href: "/approvals", icon: Inbox, approvals: true },
    ],
  },
  {
    title: "Facilities",
    module: "facility",
    items: [
      { label: "Overview", href: "/facility", icon: Gauge, anyOf: ["issue:read"] },
      { label: "Issues", href: "/facility/issues", icon: ClipboardList, anyOf: ["issue:report", "issue:read"] },
      { label: "Work orders", href: "/facility/work-orders", icon: Wrench, anyOf: ["work_order:read"] },
      { label: "Assets", href: "/facility/assets", icon: Boxes, anyOf: ["asset:read"] },
      { label: "Locations", href: "/facility/locations", icon: MapPin, anyOf: ["location:read"] },
      { label: "Maintenance", href: "/facility/maintenance", icon: CalendarClock, anyOf: ["pm:read", "amc:read", "compliance:read"] },
      { label: "Vendors", href: "/facility/vendors", icon: Truck, anyOf: ["vendor:read"] },
      { label: "Resolution feedback", href: "/facility/feedback", icon: Star, anyOf: ["issue:read"] },
    ],
  },
  {
    title: "Expenses",
    module: "expense",
    items: [
      { label: "Overview", href: "/expense", icon: BarChart3, anyOf: ["budget:read"] },
      { label: "Claims", href: "/expense/claims", icon: Receipt, anyOf: ["expense:submit", "expense:read"] },
      { label: "Advances", href: "/expense/advances", icon: Wallet, anyOf: ["expense:submit", "expense:read"] },
      { label: "Budgets", href: "/expense/budgets", icon: Layers, anyOf: ["budget:read"] },
      { label: "Petty cash", href: "/expense/petty-cash", icon: Wallet, anyOf: ["petty_cash:read"] },
    ],
  },
  {
    title: "Tasks",
    module: "tasks",
    items: [
      { label: "Overview", href: "/tasks/overview", icon: BarChart3, anyOf: ["task:read"] },
      { label: "My tasks", href: "/tasks", icon: CheckSquare, anyOf: ["task:read", "task:create"] },
      { label: "Projects", href: "/tasks/projects", icon: FolderKanban, anyOf: ["task:read", "project:create"] },
      { label: "Teams", href: "/tasks/teams", icon: Users, anyOf: ["task:read"] },
    ],
  },
  {
    title: "Purchasing",
    module: "po",
    items: [
      { label: "Overview", href: "/po", icon: Gauge, anyOf: ["po:read"] },
      { label: "Requisitions", href: "/po/requisitions", icon: FileText, anyOf: ["requisition:submit", "requisition:read"] },
      { label: "Purchase orders", href: "/po/orders", icon: ShoppingCart, anyOf: ["po:read"] },
      { label: "Invoices", href: "/po/invoices", icon: PackageCheck, anyOf: ["invoice:read"] },
      { label: "Items", href: "/po/items", icon: Boxes, anyOf: ["po:create"] },
    ],
  },
];

NAV.push({
  title: "Feedback & NPS",
  module: "surveys",
  items: [{ label: "Surveys & NPS", href: "/surveys", icon: MessageSquareHeart, anyOf: ["survey:read", "survey:manage"] }],
});

export const SETTINGS_NAV: NavItem[] = [
  { label: "Organisation", href: "/settings", icon: Building2, anyOf: ["org:manage"] },
  { label: "Users", href: "/settings/users", icon: Users, anyOf: ["user:read", "user:manage"] },
  { label: "Roles", href: "/settings/roles", icon: ShieldCheck, anyOf: ["role:manage", "user:read"] },
  { label: "Approval policies", href: "/settings/approvals", icon: Workflow, anyOf: ["approval:manage"] },
  { label: "Configuration", href: "/settings/configuration", icon: Settings, anyOf: ["settings:manage", "issue:configure", "asset:configure", "budget:manage"] },
  { label: "API keys", href: "/settings/api-keys", icon: KeyRound, anyOf: ["api_key:manage"] },
  { label: "Webhooks", href: "/settings/webhooks", icon: Webhook, anyOf: ["webhook:manage"] },
  { label: "Audit log", href: "/settings/audit", icon: FileText, anyOf: ["audit:read"] },
];
