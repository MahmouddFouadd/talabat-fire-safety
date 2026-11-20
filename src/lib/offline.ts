import { get, set, del, keys } from "idb-keyval";
import { supabase } from "./supabase";

/** Inspection payload sent to public.submit_inspection(). Never contains tokens. */
export interface InspectionPayload {
  client_id: string;
  store_code: string;
  p6: { good: number; dmg: number; miss: number; rmk?: string };
  co2: { good: number; dmg: number; miss: number; rmk?: string };
  fs: { good: number; dmg: number; miss: number; rmk?: string };
  hc: { ok: number; hose: string; valve: string; glass: string; rmk?: string };
  al: { system: string; battery: string; detectors: string; mcp: string; sounders: string; rmk?: string };
  fp: { available: boolean; running: string; tested: string; rmk?: string };
  general_remarks?: string;
  override?: boolean;
  override_reason?: string;
}
export interface Draft { payload: InspectionPayload; step: number; owner: string; updatedAt: number; }
export interface OutboxItem { payload: InspectionPayload; owner: string; queuedAt: number; attempts: number; lastError?: string; storeName: string; }

const DRAFT = (owner: string, store: string) => `draft:${owner}:${store}`;
const OUT = (id: string) => `outbox:${id}`;

export const drafts = {
  get: (owner: string, store: string) => get<Draft>(DRAFT(owner, store)),
  save: (d: Draft) => set(DRAFT(d.owner, d.payload.store_code), { ...d, updatedAt: Date.now() }),
  remove: (owner: string, store: string) => del(DRAFT(owner, store)),
};

export async function listOutbox(owner: string): Promise<OutboxItem[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith("outbox:"));
  const items = await Promise.all(ks.map((k) => get<OutboxItem>(k)));
  return items.filter((i): i is OutboxItem => !!i && i.owner === owner).sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function enqueue(item: OutboxItem) { await set(OUT(item.payload.client_id), item); }

export type SubmitResult = { id: string; code: string; overall: "ok" | "warn"; issues: { equipment: string; priority: string }[]; replayed: boolean };

/** Submit once. Network failures keep the item queued; business errors are returned so the user can fix them. */
export async function submitPayload(payload: InspectionPayload): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc("submit_inspection", { p: payload });
  if (error) throw error;
  return data as SubmitResult;
}

export async function flushOutbox(owner: string): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  if (!navigator.onLine) return { sent, failed };
  for (const item of await listOutbox(owner)) {
    try {
      await submitPayload(item.payload);          // idempotent by client_id
      await del(OUT(item.payload.client_id));
      await drafts.remove(owner, item.payload.store_code);
      sent++;
    } catch (e) {
      failed++;
      const msg = (e as Error)?.message ?? "error";
      await set(OUT(item.payload.client_id), { ...item, attempts: item.attempts + 1, lastError: msg });
    }
  }
  return { sent, failed };
}

export async function removeOutbox(clientId: string) { await del(OUT(clientId)); }
