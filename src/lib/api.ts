import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { reportSessionExpired } from "./auth";
import type { InspectionItem, StoreItem, AuditRow, Dashboard, EquipmentType, Inspection, Issue, IssueStatus, Staff, Store, StoreEquipment, StoreStatusRow, Zone } from "./types";

async function q<T>(p: PromiseLike<{ data: unknown; error: unknown; count?: number | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export const PAGE = 25;

export const useZones = () => useQuery({ queryKey: ["zones"], queryFn: () => q<Zone[]>(supabase.from("zones").select("*").order("sort").order("code")) });
export const useStaff = (enabled = true) => useQuery({ enabled, queryKey: ["staff"], queryFn: () => q<Staff[]>(supabase.from("staff").select("*").order("role").order("full_name")) });
export const useStoreStatus = () => useQuery({ queryKey: ["store-status"], queryFn: () => q<StoreStatusRow[]>(supabase.from("v_store_status").select("*").order("store_code")) });
export const useStores = () => useQuery({ queryKey: ["stores"], queryFn: () => q<Store[]>(supabase.from("stores").select("*").order("store_code")) });
export const useStoreEquipment = () => useQuery({ queryKey: ["store-equipment"], queryFn: () => q<StoreEquipment[]>(supabase.from("store_equipment").select("*")) });
export const useStoreItems = () => useQuery({ queryKey: ["store-items"], queryFn: () => q<StoreItem[]>(supabase.from("store_items").select("store_code,type_code,qty")) });
export const useInspectionItems = (ids: string[]) => useQuery({
  enabled: ids.length > 0, queryKey: ["inspection-items", ids.join(",")],
  queryFn: async () => {
    const out: InspectionItem[] = [];
    for (let i = 0; i < ids.length; i += 150) out.push(...await q<InspectionItem[]>(supabase.from("inspection_items").select("*").in("inspection_id", ids.slice(i, i + 150))));
    return out;
  },
});
/** Reads every row (PostgREST returns at most 1000 rows per request, so a plain .limit(50000) is silently cut). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, pageSize = 1000, max = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const page = await q<T[]>(build(from, from + pageSize - 1));
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}
/** Writes an audit row for actions that happen only in the browser (exports). Admin-only on the server. */
export async function logEvent(action: "export_csv" | "export_backup", detail: Record<string, unknown>) {
  await supabase.rpc("log_event", { p_action: action, p_detail: detail });
}
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>) { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data as T; }
export const useEquipmentTypes = () => useQuery({ queryKey: ["equipment-types"], queryFn: () => q<EquipmentType[]>(supabase.from("equipment_types").select("*").order("sort").order("code")) });
export const useSettings = () => useQuery({
  queryKey: ["settings"],
  queryFn: async () => Object.fromEntries((await q<{ key: string; value: unknown }[]>(supabase.from("app_settings").select("key,value"))).map((r) => [r.key, r.value])) as Record<string, unknown>,
});
export const usePublicSettings = () => useQuery({ queryKey: ["public-settings"], queryFn: () => q<Record<string, string>>(supabase.rpc("public_settings")), staleTime: 3_600_000 });
export const useDashboard = (zone: string | null, enabled = true) => useQuery({ enabled, queryKey: ["dashboard", zone], queryFn: () => q<Dashboard>(supabase.rpc("dashboard_summary", { p_zone: zone })) });

export interface InspectionFilter { page: number; store?: string; tech?: string; zone?: string; status?: string; from?: string; to?: string; }
export const useInspections = (f: InspectionFilter) => useQuery({
  queryKey: ["inspections", f], placeholderData: keepPreviousData,
  queryFn: async () => {
    let b = supabase.from("inspections").select("*", { count: "exact" }).order("submitted_at", { ascending: false }).range(f.page * PAGE, f.page * PAGE + PAGE - 1);
    if (f.store) b = b.ilike("store_code", `%${f.store}%`);
    if (f.tech) b = b.eq("tech_id", f.tech);
    if (f.zone) b = b.eq("zone_snapshot", f.zone);
    if (f.status) b = b.eq("overall_status", f.status);
    if (f.from) b = b.gte("inspection_date", f.from);
    if (f.to) b = b.lte("inspection_date", f.to);
    const { data, error, count } = await b;
    if (error) throw error;
    return { rows: data as Inspection[], count: count ?? 0 };
  },
});
export const useInspection = (id: string | null) => useQuery({ enabled: !!id, queryKey: ["inspection", id], queryFn: () => q<Inspection>(supabase.from("inspections").select("*").eq("id", id!).single()) });
export const useLatestPerStore = () => useQuery({
  queryKey: ["latest-per-store"],
  queryFn: async () => {
    // latest inspection per store (≤ 1 per store per week → at most stores × weeks rows in the window)
    const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
    const rows = await q<Inspection[]>(supabase.from("inspections").select("*").gte("inspection_date", since).order("submitted_at", { ascending: false }).limit(2000));
    const seen = new Map<string, Inspection>();
    rows.forEach((r) => { if (!seen.has(r.store_code)) seen.set(r.store_code, r); });
    return [...seen.values()];
  },
});

export interface IssueFilter { status?: string; priority?: string; zone?: string; store?: string; page: number; }
export const useIssues = (f: IssueFilter) => useQuery({
  queryKey: ["issues", f], placeholderData: keepPreviousData,
  queryFn: async () => {
    let b = supabase.from("issues").select("*, stores!inner(name, zone_id)", { count: "exact" })
      .order("status").order("priority").order("created_at", { ascending: false }).range(f.page * PAGE, f.page * PAGE + PAGE - 1);
    if (f.status === "active") b = b.not("status", "in", "(resolved,closed)");
    else if (f.status) b = b.eq("status", f.status);
    if (f.priority) b = b.eq("priority", f.priority);
    if (f.zone) b = b.eq("stores.zone_id", f.zone);
    if (f.store) b = b.eq("store_code", f.store);
    const { data, error, count } = await b;
    if (error) throw error;
    return { rows: data as (Issue & { stores: { name: string; zone_id: string } })[], count: count ?? 0 };
  },
});
export const useIssueEvents = (id: string | null) => useQuery({
  enabled: !!id, queryKey: ["issue-events", id],
  queryFn: () => q<{ id: number; from_status: IssueStatus | null; to_status: IssueStatus; note: string | null; actor_id: string | null; at: string }[]>(
    supabase.from("issue_events").select("*").eq("issue_id", id!).order("at")),
});

export const useAudit = (page: number, entity: string) => useQuery({
  queryKey: ["audit", page, entity], placeholderData: keepPreviousData,
  queryFn: async () => {
    let b = supabase.from("audit_logs").select("*", { count: "exact" }).order("at", { ascending: false }).range(page * 50, page * 50 + 49);
    if (entity) b = b.eq("entity", entity);
    const { data, error, count } = await b;
    if (error) throw error;
    return { rows: data as AuditRow[], count: count ?? 0 };
  },
});

/* ── mutations ── */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useSaveStore() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async ({ isNew, store, base }: { isNew: boolean; store: Partial<Store> & { store_code: string }; base?: Omit<StoreEquipment, "updated_at"> | null }) => {
      if (isNew) await q(supabase.from("stores").insert(store));
      else { const { store_code, ...rest } = store; await q(supabase.from("stores").update(rest).eq("store_code", store_code)); }
      if (base) await q(supabase.from("store_equipment").upsert(base));
    },
    onSuccess: () => inv("stores", "store-status", "store-equipment", "dashboard"),
  });
}

export function useSaveEquipment() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (rows: Omit<StoreEquipment, "updated_at">[]) => { await q(supabase.from("store_equipment").upsert(rows)); },
    onSuccess: () => inv("store-equipment", "store-status", "dashboard"),
  });
}

export function useUpdateIssue() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (a: { id: string; status: IssueStatus; assigned?: string | null; note?: string | null }) => {
      await q(supabase.rpc("update_issue", { p_issue: a.id, p_status: a.status, p_assigned: a.assigned ?? null, p_note: a.note ?? null }));
    },
    onSuccess: () => inv("issues", "issue-events", "dashboard", "store-status"),
  });
}

/** Returns a valid access token, renewing it first when it is expired or about to expire. */
async function freshAccessToken(force = false): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) return null;
  const expiresSoon = (s.expires_at ?? 0) * 1000 - Date.now() < 60_000;
  if (!force && !expiresSoon) return s.access_token;
  const { data: r, error } = await supabase.auth.refreshSession();
  if (error || !r.session) {
    // A network failure is not an expired session — only give up on a real auth rejection.
    if (error && /fetch|network|timed? ?out|abort/i.test(error.message ?? "")) throw new Error("NETWORK");
    return null;
  }
  return r.session.access_token;
}

async function readFnError(error: unknown): Promise<{ status: number; code: string; detail?: string }> {
  const res = (error as { context?: Response }).context;
  if (!(res instanceof Response)) {
    const name = (error as { name?: string }).name ?? "";
    return { status: 0, code: name === "FunctionsFetchError" ? "NETWORK" : "UNKNOWN", detail: (error as Error).message };
  }
  let body: Record<string, unknown> = {};
  try { body = await res.clone().json(); } catch { /* not JSON */ }
  // our function returns {error}; the Supabase gateway returns {code, message} / {msg} (e.g. "Invalid JWT")
  const code = typeof body.error === "string" ? body.error : "";
  const detail = [body.detail, body.message, body.msg].find((v) => typeof v === "string") as string | undefined;
  return { status: res.status, code: code || (res.status === 401 ? "NOT_AUTHENTICATED" : `HTTP_${res.status}`), detail };
}

export async function adminUsers(body: Record<string, unknown>) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await freshAccessToken(attempt > 0);
    if (!token) { reportSessionExpired(); throw new Error("SESSION_EXPIRED"); }
    const { data, error } = await supabase.functions.invoke("admin-users", { body, headers: { Authorization: `Bearer ${token}` } });
    if (!error) return data;
    const e = await readFnError(error);
    if (e.status === 401 && attempt === 0) continue;          // token rejected → renew once and retry
    if (e.status === 401) { reportSessionExpired(); throw new Error("SESSION_EXPIRED"); }
    throw Object.assign(new Error(e.code), { detail: e.detail, status: e.status });
  }
  throw new Error("SESSION_EXPIRED");
}
