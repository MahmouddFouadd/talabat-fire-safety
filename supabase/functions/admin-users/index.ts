// admin-users — the only place the service-role key is used.
// Actions (admin only): create_login, reset_password, set_active.
// The service-role key is injected by Supabase at runtime (SUPABASE_SERVICE_ROLE_KEY); it never reaches the app.
import { createClient } from "jsr:@supabase/supabase-js@2.45.4";

const LOGIN_DOMAIN = Deno.env.get("LOGIN_DOMAIN") ?? "fs.local";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim());

function cors(origin: string | null) {
  const allow = ALLOWED_ORIGINS.includes("*") ? "*" : (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}

const USERNAME = /^[a-z0-9._-]{3,32}$/;
function strongPassword(p: unknown): p is string {
  return typeof p === "string" && p.length >= 10 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // 1. who is calling?
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await service.auth.getUser(jwt);
  if (whoErr || !who?.user) return json({ error: "NOT_AUTHENTICATED" }, 401, origin);
  const { data: caller } = await service.from("staff").select("id, role, active").eq("auth_user_id", who.user.id).maybeSingle();
  if (!caller || !caller.active || caller.role !== "admin") return json({ error: "NOT_AUTHORIZED" }, 403, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" }, 400, origin); }
  const action = String(body.action ?? "");
  const staffId = String(body.staff_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(staffId)) return json({ error: "INVALID_STAFF_ID" }, 400, origin);

  const { data: target } = await service.from("staff").select("id, username, full_name, role, active, auth_user_id").eq("id", staffId).maybeSingle();
  if (!target) return json({ error: "STAFF_NOT_FOUND" }, 404, origin);

  const audit = (act: string, detail: Record<string, unknown>) =>
    service.from("audit_logs").insert({ actor_auth: who.user.id, actor_staff: caller.id, action: act, entity: "auth", entity_id: target.id, detail });

  try {
    if (action === "create_login") {
      const username = String(body.username ?? target.username ?? "").toLowerCase().trim();
      if (!USERNAME.test(username)) return json({ error: "INVALID_USERNAME" }, 400, origin);
      if (!strongPassword(body.password)) return json({ error: "WEAK_PASSWORD" }, 400, origin);
      if (target.auth_user_id) return json({ error: "LOGIN_EXISTS" }, 409, origin);
      const { data: dup } = await service.from("staff").select("id").eq("username", username).neq("id", target.id).maybeSingle();
      if (dup) return json({ error: "USERNAME_TAKEN" }, 409, origin);
      const { data: created, error } = await service.auth.admin.createUser({
        email: `${username}@${LOGIN_DOMAIN}`, password: body.password, email_confirm: true,
        user_metadata: { staff_id: target.id, must_change_password: true },
      });
      if (error || !created.user) return json({ error: "CREATE_FAILED", detail: error?.message }, 400, origin);
      const { error: linkErr } = await service.from("staff").update({ auth_user_id: created.user.id, username }).eq("id", target.id);
      if (linkErr) { await service.auth.admin.deleteUser(created.user.id); return json({ error: "LINK_FAILED" }, 500, origin); }
      await audit("create_login", { username });
      return json({ ok: true, username }, 200, origin);
    }

    if (action === "reset_password") {
      if (!target.auth_user_id) return json({ error: "NO_LOGIN" }, 400, origin);
      if (!strongPassword(body.password)) return json({ error: "WEAK_PASSWORD" }, 400, origin);
      const { error } = await service.auth.admin.updateUserById(target.auth_user_id, {
        password: body.password, user_metadata: { staff_id: target.id, must_change_password: true },
      });
      if (error) return json({ error: "RESET_FAILED" }, 400, origin);
      await audit("reset_password", {});
      return json({ ok: true }, 200, origin);
    }

    if (action === "set_active") {
      const active = body.active === true;
      if (target.id === caller.id && !active) return json({ error: "CANNOT_DISABLE_SELF" }, 400, origin);
      const { error } = await service.from("staff").update({ active }).eq("id", target.id);
      if (error) return json({ error: error.message.includes("LAST_ADMIN") ? "LAST_ADMIN" : "UPDATE_FAILED" }, 400, origin);
      if (target.auth_user_id) {
        await service.auth.admin.updateUserById(target.auth_user_id, { ban_duration: active ? "none" : "876000h" });
      }
      await audit(active ? "activate_user" : "deactivate_user", {});
      return json({ ok: true }, 200, origin);
    }

    if (action === "delete") {
      if (target.id === caller.id) return json({ error: "CANNOT_DELETE_SELF" }, 400, origin);
      const { count } = await service.from("inspections").select("id", { count: "exact", head: true }).eq("tech_id", target.id);
      if ((count ?? 0) > 0) return json({ error: "HAS_HISTORY" }, 409, origin);
      if (target.role === "admin") {
        const { count: admins } = await service.from("staff").select("id", { count: "exact", head: true }).eq("role", "admin").eq("active", true).neq("id", target.id);
        if ((admins ?? 0) === 0) return json({ error: "LAST_ADMIN" }, 400, origin);
      }
      await service.from("stores").update({ assigned_tech_id: null }).eq("assigned_tech_id", target.id);
      const { error } = await service.from("staff").delete().eq("id", target.id);
      if (error) return json({ error: "DELETE_FAILED" }, 400, origin);
      if (target.auth_user_id) await service.auth.admin.deleteUser(target.auth_user_id).catch(() => undefined);
      await audit("delete_user", { name: target.full_name });
      return json({ ok: true }, 200, origin);
    }

    return json({ error: "UNKNOWN_ACTION" }, 400, origin);
  } catch (_e) {
    return json({ error: "SERVER_ERROR" }, 500, origin);
  }
});
