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
  /** true when the session could not be renewed (refresh token revoked/expired) and the user was signed out */
  sessionExpired: boolean;
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

/** Listeners outside React (api.ts) report a session that can no longer be renewed. */
const expiredListeners = new Set<() => void>();
export function reportSessionExpired() { expiredListeners.forEach((f) => f()); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [idleExpired, setIdleExpired] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const idleMinutes = useRef(480);
  const staffRef = useRef<Staff | null>(null);
  staffRef.current = staff;

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
    //
    // A token refresh (every ~hour, and on app resume) must NOT reload or clear the staff row:
    // before, one failed/timed-out query during a refresh set staff=null and the app dropped to
    // the login screen in the middle of work. Staff is cleared only when the session is gone, and
    // a failed lookup keeps the staff we already have.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (!s) { setStaff(null); return; }
      setSessionExpired(false);
      const current = staffRef.current;
      if (event === "TOKEN_REFRESHED" && current?.auth_user_id === s.user.id) return;
      setTimeout(async () => {
        const next = await loadStaff(s.user.id);
        if (next) setStaff(next);
        else if (!lastStaffError) setStaff(null);          // row really missing / deactivated
        else if (staffRef.current?.auth_user_id !== s.user.id) setStaff(null); // different user, nothing to keep
        // otherwise: transient error → keep the current staff
      }, 0);
    });
    const onExpired = () => {
      setSessionExpired(true);
      supabase.auth.signOut({ scope: "local" }).finally(() => setStaff(null));
    };
    expiredListeners.add(onExpired);
    return () => { alive = false; sub.subscription.unsubscribe(); expiredListeners.delete(onExpired); };
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
    // throttled: touch, scroll and typing all count as activity (scrolling a long list is still "using" the app)
    let lastBump = 0;
    const bump = () => { const n = Date.now(); if (n - lastBump > 5_000) { lastBump = n; localStorage.setItem(KEY, String(n)); } };
    bump();
    const events = ["pointerdown", "touchstart", "keydown", "input", "wheel", "scroll", "visibilitychange"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true, capture: true }));
    const iv = window.setInterval(() => {
      const l = Number(localStorage.getItem(KEY) || Date.now());
      if (Date.now() - l > idleMinutes.current * 60_000) { setIdleExpired(true); signOutLocal(); }
    }, 60_000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump, { capture: true })); window.clearInterval(iv); };
  }, [session, signOutLocal]);

  const signIn: AuthState["signIn"] = async (username, password) => {
    setIdleExpired(false); setSessionExpired(false);
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
    setIdleExpired(false); setSessionExpired(false);
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

  return <Ctx.Provider value={{ session, staff, loading, mustChangePassword, idleExpired, sessionExpired, signIn, signInWithPin, signOut, changePassword }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
