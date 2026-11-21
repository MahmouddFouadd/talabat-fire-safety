import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { LOGIN_DOMAIN } from "./config";
import type { Staff } from "./types";

interface AuthState {
  session: Session | null;
  staff: Staff | null;
  loading: boolean;
  mustChangePassword: boolean;
  idleExpired: boolean;
  signIn: (username: string, password: string) => Promise<"ok" | "bad" | "rate" | "nostaff" | `db:${string}`>;
  signInWithPin: (identifier: string, pin: string) => Promise<"ok" | "bad" | "locked" | "nostaff" | "error">;
  signOut: () => Promise<void>;
  changePassword: (pw: string) => Promise<boolean>;
}

const Ctx = createContext<AuthState | null>(null);

export const toEmail = (username: string) => `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`;

/** Arabic-Indic / Persian digits → 0-9 so "٠١٠…" typed on an Arabic keyboard works. */
export const latinDigits = (v: string) => v.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (c) => String((c.charCodeAt(0) & 0xf) % 10));
export const looksLikePhone = (v: string) => /^[+0-9 ()-]{8,20}$/.test(latinDigits(v).trim());

/** A mobile number is resolved to its login e-mail by the database; anything else is a username. */
async function resolveEmail(identifier: string): Promise<string> {
  const id = latinDigits(identifier).trim();
  if (looksLikePhone(id)) {
    const { data, error } = await supabase.rpc("login_email", { p_identifier: id });
    if (!error && typeof data === "string" && data) return data;
  }
  return toEmail(id);
}

let lastStaffError = "";
async function loadStaff(uid: string): Promise<Staff | null> {
  const { data, error } = await supabase.from("staff").select("*").eq("auth_user_id", uid).eq("active", true).maybeSingle();
  lastStaffError = error ? `${error.code ?? ""} ${error.message ?? ""}`.trim() : "";
  return (data as Staff) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [idleExpired, setIdleExpired] = useState(false);
  const idleMinutes = useRef(480);

  useEffect(() => {
    let alive = true;
    supabase.rpc("public_settings").then(({ data }) => {
      const m = Number((data as Record<string, unknown> | null)?.session_idle_minutes);
      if (m > 0) idleMinutes.current = m;
    });
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setStaff(data.session ? await loadStaff(data.session.user.id) : null);
      setLoading(false);
    });
    // Never await Supabase calls inside this callback: supabase-js holds its auth lock while the
    // callback runs, so a query here deadlocks every later request (endless "Loading…").
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setTimeout(async () => { setStaff(s ? await loadStaff(s.user.id) : null); }, 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  // Manual sign-out ends the session on every device (refresh tokens revoked server-side).
  const signOut = useCallback(async () => {
    await supabase.auth.signOut({ scope: "global" });
    setStaff(null);
  }, []);
  // Idle timeout only closes this device, so a phone left idle does not log the user out of the office PC.
  const signOutLocal = useCallback(async () => {
    await supabase.auth.signOut({ scope: "local" });
    setStaff(null);
  }, []);

  // idle timeout — tracked across reloads
  useEffect(() => {
    if (!session) return;
    const KEY = "fs-last-activity";
    const last = Number(localStorage.getItem(KEY) || Date.now());
    if (Date.now() - last > idleMinutes.current * 60_000) { setIdleExpired(true); signOutLocal(); return; }
    const bump = () => localStorage.setItem(KEY, String(Date.now()));
    bump();
    const events = ["pointerdown", "keydown", "visibilitychange"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = window.setInterval(() => {
      const l = Number(localStorage.getItem(KEY) || Date.now());
      if (Date.now() - l > idleMinutes.current * 60_000) { setIdleExpired(true); signOutLocal(); }
    }, 60_000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump)); window.clearInterval(iv); };
  }, [session, signOutLocal]);

  const signIn: AuthState["signIn"] = async (username, password) => {
    setIdleExpired(false);
    sessionStorage.setItem("fs-login-method", "password");
    const { data, error } = await supabase.auth.signInWithPassword({ email: await resolveEmail(username), password });
    if (error) return error.status === 429 ? "rate" : "bad";
    const s = await loadStaff(data.user.id);
    if (!s) { const e = lastStaffError; await supabase.auth.signOut(); return e ? `db:${e}` : "nostaff"; }
    setStaff(s);
    localStorage.setItem("fs-last-activity", String(Date.now()));
    return "ok";
  };

  const signInWithPin: AuthState["signInWithPin"] = async (identifier, pin) => {
    setIdleExpired(false);
    const { data, error } = await supabase.functions.invoke("pin-login", { body: { identifier: latinDigits(identifier).trim(), pin: latinDigits(pin) } });
    if (error) {
      let code = "";
      try { code = (await (error as { context?: Response }).context?.json())?.error ?? ""; } catch { /* ignore */ }
      return code === "LOCKED" ? "locked" : code === "BAD" ? "bad" : "error";
    }
    const tokens = data as { access_token?: string; refresh_token?: string };
    if (!tokens?.access_token || !tokens.refresh_token) return "error";
    sessionStorage.setItem("fs-login-method", "pin");
    const { data: sd, error: se } = await supabase.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
    if (se || !sd.user) return "error";
    const s = await loadStaff(sd.user.id);
    if (!s) { await supabase.auth.signOut(); return "nostaff"; }
    setStaff(s);
    localStorage.setItem("fs-last-activity", String(Date.now()));
    return "ok";
  };

  const changePassword = async (pw: string) => {
    const { error } = await supabase.auth.updateUser({ password: pw, data: { must_change_password: false } });
    if (!error) {
      await supabase.auth.signOut({ scope: "others" });   // a changed password must not leave old sessions alive elsewhere
      const { data } = await supabase.auth.getSession(); setSession(data.session);
    }
    return !error;
  };

  // someone who signed in with a PIN is not forced to set a password (PIN-only use is allowed)
  const mustChangePassword = !!session?.user.user_metadata?.must_change_password && sessionStorage.getItem("fs-login-method") !== "pin";

  return <Ctx.Provider value={{ session, staff, loading, mustChangePassword, idleExpired, signIn, signInWithPin, signOut, changePassword }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
