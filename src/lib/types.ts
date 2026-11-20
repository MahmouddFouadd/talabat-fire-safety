export type Role = "admin" | "technician";
export type StoreStatus = "ok" | "issues" | "pending" | "overdue" | "never";
export type IssueStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed";
export type Priority = "critical" | "high" | "medium" | "low";
export type EqCode = "p6" | "co2" | "fs" | "hc" | "al" | "fp";

export interface Staff { id: string; legacy_code: string | null; full_name: string; username: string | null; role: Role; zone_id: string | null; phone: string | null; auth_user_id: string | null; active: boolean; }
export interface Zone { id: string; code: string; name_ar: string; name_en: string; sort: number; active: boolean; }
export interface Store { store_code: string; name: string; zone_id: string; assigned_tech_id: string | null; active: boolean; flagged: boolean; notes: string | null; }
export interface StoreEquipment { store_code: string; p6_qty: number; co2_qty: number; fs_qty: number; hc_total: number; updated_at: string; }
export interface EquipmentType { code: EqCode; name_ar: string; name_en: string; has_quantity: boolean; active: boolean; sort: number; }
export interface StoreStatusRow { store_code: string; name: string; zone_id: string; assigned_tech_id: string | null; active: boolean; flagged: boolean; last_date: string | null; last_overall: string | null; last_code: string | null; has_base: boolean; status: StoreStatus; open_issues: number; }
export interface Inspection {
  id: string; inspection_code: string; store_code: string; tech_id: string; week_start: string; inspection_date: string; submitted_at: string;
  store_name_snapshot: string; zone_snapshot: string; tech_name_snapshot: string;
  p6_qty: number; p6_good: number; p6_dmg: number; p6_miss: number; p6_status: string; p6_rmk: string | null;
  co2_qty: number; co2_good: number; co2_dmg: number; co2_miss: number; co2_status: string; co2_rmk: string | null;
  fs_qty: number; fs_good: number; fs_dmg: number; fs_miss: number; fs_status: string; fs_rmk: string | null;
  hc_total: number; hc_ok: number; hc_hose: string | null; hc_valve: string | null; hc_glass: string | null; hc_status: string; hc_rmk: string | null;
  al_system: string | null; al_battery: string | null; al_detectors: string | null; al_mcp: string | null; al_sounders: string | null; al_status: string; al_rmk: string | null;
  fp_available: boolean | null; fp_running: string | null; fp_tested: string | null; fp_status: string; fp_rmk: string | null;
  overall_status: "ok" | "warn"; general_remarks: string | null; duplicate_override: boolean; override_reason: string | null;
}
export interface Issue { id: string; issue_code: string; inspection_id: string | null; store_code: string; equipment: EqCode; description: string; priority: Priority; status: IssueStatus; assigned_to: string | null; created_at: string; resolved_at: string | null; resolution_notes: string | null; }
export interface AuditRow { id: number; at: string; actor_staff: string | null; action: string; entity: string; entity_id: string | null; detail: unknown; }
export interface Dashboard {
  week_start: string; today: string; stores: number; by_status: Partial<Record<StoreStatus, number>>; no_base: number; flagged: number;
  open_issues: number; issues_by_priority: Partial<Record<Priority, number>>; issues_by_equipment: Partial<Record<EqCode, number>>; issues_by_status: Partial<Record<IssueStatus, number>>;
  zones: { id: string; code: string; name_ar: string; name_en: string; stores: number; done: number; overdue: number }[];
  techs: { id: string; name: string; stores: number; done: number; overdue: number }[];
  trend: { week_start: string; inspections: number; with_issues: number }[];
}
