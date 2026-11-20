import type { Page, Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/* Deterministic Supabase stand-in for UI tests. Fixtures are exported from a database
   built with the real migrations (see docs/TEST_REPORT.md). RLS itself is tested in tests/sql. */
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures");
const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), "utf8"));

export const USERS = {
  admin: "00000000-0000-0000-0000-00000000000a",
  tech: "00000000-0000-0000-0000-000000000002",
};

function b64(o: object) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
function session(uid: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: uid, aud: "authenticated", role: "authenticated", email: "x@fs.local", user_metadata: {}, app_metadata: {} };
  return { access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: uid, exp, role: "authenticated" })}.sig`, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user };
}

function applyFilters(rows: Record<string, unknown>[], params: URLSearchParams, uid: string, table: string) {
  let out = rows;
  // emulate RLS for the technician on the tables the tech UI reads
  if (uid === USERS.tech) {
    const me = (fx("staff") as { id: string; auth_user_id: string }[]).find((s) => s.auth_user_id === uid)!.id;
    if (table === "stores" || table === "v_store_status") out = out.filter((r) => r.assigned_tech_id === me);
    if (table === "staff") out = out.filter((r) => r.auth_user_id === uid);
  }
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset"].includes(k) || k.includes(".")) continue;
    const [op, ...restParts] = v.split("."); const rest = restParts.join(".");
    out = out.filter((r) => {
      const x = r[k];
      switch (op) {
        case "eq": return String(x) === rest;
        case "neq": return String(x) !== rest;
        case "gte": return String(x) >= rest;
        case "lte": return String(x) <= rest;
        case "ilike": return String(x ?? "").toLowerCase().includes(rest.replace(/\*/g, "").toLowerCase());
        case "in": return rest.replace(/[()]/g, "").split(",").includes(String(x));
        case "not": return !rest.replace(/^in\.|[()]/g, "").split(",").includes(String(x));
        default: return true;
      }
    });
  }
  return out;
}

export async function mockSupabase(page: Page, who: keyof typeof USERS) {
  const uid = USERS[who];
  await page.route(/supabase\.co\//, async (route: Route) => {
    const req = route.request(); const url = new URL(req.url());
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (url.pathname.startsWith("/functions/v1/pin-login")) {
      const b = JSON.parse(req.postData() ?? "{}");
      if (b.pin === "2580") { const s = session(uid); return json({ access_token: s.access_token, refresh_token: s.refresh_token }); }
      return json({ error: "BAD" }, 401);
    }
    if (url.pathname.startsWith("/auth/v1/token")) return json(session(uid));
    if (url.pathname.startsWith("/auth/v1/user")) return json(session(uid).user);
    if (url.pathname.startsWith("/auth/v1/logout")) return route.fulfill({ status: 204 });
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop()!;
      if (fn === "submit_inspection") return json({ id: "11111111-1111-1111-1111-111111111111", code: "INS-TEST-0001", overall: "warn", issues: [{ equipment: "p6", priority: "medium" }], replayed: false });
      if (fn === "update_issue") return json(null, 204);
      return json(fx(fn));
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").pop()!;
      if (req.method() !== "GET") return json(null, 201);
      let rows: Record<string, unknown>[] = [];
      try { rows = fx(table); } catch { rows = []; }
      rows = applyFilters(rows, url.searchParams, uid, table);
      const total = rows.length;
      const offset = Number(url.searchParams.get("offset") ?? 0); const limit = Number(url.searchParams.get("limit") ?? 100000);
      rows = rows.slice(offset, offset + limit);
      const headers: Record<string, string> = { "content-range": `${offset}-${offset + rows.length - 1}/${total}` };
      if ((req.headers()["accept"] ?? "").includes("vnd.pgrst.object")) return rows[0] ? json(rows[0], 200, headers) : json({ code: "PGRST116", message: "none" }, 406);
      return json(rows, 200, headers);
    }
    return route.fulfill({ status: 404 });
  });
}

export async function login(page: Page, who: keyof typeof USERS) {
  await mockSupabase(page, who);
  await page.goto("./");
  await page.getByLabel(/اسم المستخدم|Username/).fill(who === "admin" ? "admin01" : "tech002");
  await page.getByLabel(/كلمة المرور|Password/).fill("Test-password-123");
  await page.getByRole("button", { name: /تسجيل الدخول|Sign in/ }).click();
}
