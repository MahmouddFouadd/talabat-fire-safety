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
  signIn: (username: string, password: string) => Promise<"ok" | "bad" | "rate" | "nostaff">;
  signOut: () => Promise<void>;
  changePassword: (pw: string) => Promise<boolean>;
}

const Ctx = createContext<AuthState | null>(null);

export const toEmail = (username: string) => `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`;

async function loadStaff(uid: string): Promise<Staff | null> {
  const { data } = await supabase.from("staff").select("*").eq("auth_user_id", uid).eq("active", true).maybeSingle();
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
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      setStaff(s ? await loadStaff(s.user.id) : null);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setStaff(null);
  }, []);

  // idle timeout — tracked across reloads
  useEffect(() => {
    if (!session) return;
    const KEY = "fs-last-activity";
    const last = Number(localStorage.getItem(KEY) || Date.now());
    if (Date.now() - last > idleMinutes.current * 60_000) { setIdleExpired(true); signOut(); return; }
    const bump = () => localStorage.setItem(KEY, String(Date.now()));
    bump();
    const events = ["pointerdown", "keydown", "visibilitychange"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = window.setInterval(() => {
      const l = Number(localStorage.getItem(KEY) || Date.now());
      if (Date.now() - l > idleMinutes.current * 60_000) { setIdleExpired(true); signOut(); }
    }, 60_000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump)); window.clearInterval(iv); };
  }, [session, signOut]);

  const signIn: AuthState["signIn"] = async (username, password) => {
    setIdleExpired(false);
    const { data, error } = await supabase.auth.signInWithPassword({ email: toEmail(username), password });
    if (error) return error.status === 429 ? "rate" : "bad";
    const s = await loadStaff(data.user.id);
    if (!s) { await supabase.auth.signOut(); return "nostaff"; }
    setStaff(s);
    localStorage.setItem("fs-last-activity", String(Date.now()));
    return "ok";
  };

  const changePassword = async (pw: string) => {
    const { error } = await supabase.auth.updateUser({ password: pw, data: { must_change_password: false } });
    if (!error) { const { data } = await supabase.auth.getSession(); setSession(data.session); }
    return !error;
  };

  const mustChangePassword = !!session?.user.user_metadata?.must_change_password;

  return <Ctx.Provider value={{ session, staff, loading, mustChangePassword, idleExpired, signIn, signOut, changePassword }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
