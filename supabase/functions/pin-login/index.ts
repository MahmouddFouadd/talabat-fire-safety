// pin-login — sign in with mobile number/username + PIN.
// The PIN is checked in the database (bcrypt, lockout after 5 wrong tries).
// On success a one-time sign-in link is generated server-side and exchanged at once for a session,
// so no e-mail or SMS is ever sent and no password is needed.
import { createClient } from "jsr:@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim());
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes("*") ? "*" : (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (b: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  let body: { identifier?: unknown; pin?: unknown };
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" }, 400, origin); }
  const identifier = String(body.identifier ?? "").trim().slice(0, 64);
  const pin = String(body.pin ?? "").trim();
  if (!identifier || !/^[0-9]{4,6}$/.test(pin)) return json({ error: "BAD" }, 401, origin);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: check, error: checkErr } = await service.rpc("pin_check", { p_identifier: identifier, p_pin: pin });
  if (checkErr) return json({ error: "SERVER_ERROR" }, 500, origin);
  const r = check as { ok?: boolean; email?: string; error?: string; until?: string };
  if (!r?.ok || !r.email) return json({ error: r?.error ?? "BAD", until: r?.until }, r?.error === "LOCKED" ? 423 : 401, origin);

  // one-time link → session (nothing is sent to the user)
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: "magiclink", email: r.email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return json({ error: "SERVER_ERROR" }, 500, origin);

  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  let { data: v, error: vErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  if (vErr || !v?.session) ({ data: v, error: vErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" }));
  if (vErr || !v?.session) return json({ error: "SERVER_ERROR" }, 500, origin);

  return json({ access_token: v.session.access_token, refresh_token: v.session.refresh_token }, 200, origin);
});
