import { useState, type FormEvent, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { usePublicSettings } from "../lib/api";
import { Tools } from "../components/Shell";

export const LOGO = "./brand/talabat-mart.png";

/** Hero illustration: a glass orb with the brand's flame pin (in the spirit of the reference screens). */
function Art() {
  return (
    <svg className="art" viewBox="0 0 360 260" width="100%" aria-hidden="true">
      <defs>
        <radialGradient id="orb" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#ffffff" stopOpacity=".28" /><stop offset="1" stopColor="#ffffff" stopOpacity=".04" /></radialGradient>
        <linearGradient id="pin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FF8A4C" /><stop offset="1" stopColor="#F15A24" /></linearGradient>
      </defs>
      <ellipse cx="190" cy="140" rx="150" ry="104" fill="url(#orb)" stroke="rgba(255,255,255,.22)" />
      <path d="M40 210 C 120 150, 230 230, 330 120" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="2" strokeDasharray="5 8" />
      <g transform="translate(150 40)">
        <path d="M40 0c26 0 46 20 46 46 0 34-46 86-46 86S-6 80-6 46C-6 20 14 0 40 0z" fill="url(#pin)" />
        <path d="M40 22c4 13 18 20 18 36a18 18 0 0 1-36 0c0-7 4-13 7-16 0 7 4 11 7 11 0-11-4-18 4-31z" fill="#fff" />
      </g>
      <circle cx="78" cy="96" r="8" fill="#F15A24" /><circle cx="300" cy="200" r="5" fill="rgba(255,255,255,.6)" />
    </svg>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const { data: ps } = usePublicSettings();
  const appName = (lang === "ar" ? ps?.app_name_ar : ps?.app_name_en) || t("app");
  return (
    <div className="login">
      <div className="tools-corner"><Tools /></div>
      <section className="login-hero">
        <span className="logo-chip"><img src={LOGO} alt="talabat mart" /></span>
        <Art />
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ fontWeight: 500, color: "#FF9A66" }}>{appName}</p>
          <h1>{t("loginHero")}</h1>
        </div>
      </section>
      <div className="login-side">{children}</div>
    </div>
  );
}

export default function Login() {
  const { t, lang } = useI18n();
  const { signIn, signInWithPin, idleExpired } = useAuth();
  const { data: ps } = usePublicSettings();
  // remember the number/username and the chosen method on this device (never the secret)
  const [mode, setMode] = useState<"password" | "pin">(() => (localStorage.getItem("fs-login-mode") as "pin") === "pin" ? "pin" : "password");
  const [u, setU] = useState(() => localStorage.getItem("fs-login-id") ?? ""); const [p, setP] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const msg = (lang === "ar" ? ps?.login_message_ar : ps?.login_message_en) || t("loginSub");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!u.trim() || !p) return;
    setBusy(true); setErr("");
    localStorage.setItem("fs-login-id", u.trim()); localStorage.setItem("fs-login-mode", mode);
    try {
      if (mode === "pin") {
        const r = await signInWithPin(u, p);
        if (r !== "ok") setErr(t(r === "locked" ? "pinLocked" : r === "bad" ? "pinBad" : r === "nostaff" ? "noStaff" : "errorGeneric"));
      } else {
        const r = await signIn(u, p);
        if (r.startsWith("db:")) setErr(`${t("errorGeneric")} (${r.slice(3)})`);
        else if (r !== "ok") setErr(t(r === "rate" ? "tooMany" : r === "nostaff" ? "noStaff" : "badLogin"));
      }
    } catch { setErr(t("errorGeneric")); }
    setBusy(false);
  }

  return (
    <AuthLayout>
      <form className="box" onSubmit={submit} noValidate>
        <h2 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 600 }}>{t("signIn")}</h2>
        <p className="muted" style={{ margin: "0 0 18px" }}>{msg}</p>
        {idleExpired && <div className="banner info">{t("sessionEnded")}</div>}
        <div className="seg" role="group" aria-label={t("signIn")} style={{ marginBottom: 14 }}>
          <button type="button" aria-pressed={mode === "password"} onClick={() => { setMode("password"); setP(""); setErr(""); }}>{t("byPassword")}</button>
          <button type="button" aria-pressed={mode === "pin"} onClick={() => { setMode("pin"); setP(""); setErr(""); }}>{t("byPin")}</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <label className="field">{t("loginId")}
            <input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" inputMode="text"
              placeholder="01xxxxxxxxx" value={u} onChange={(e) => setU(e.target.value)} required />
          </label>
          {mode === "password" ? (
            <label className="field">{t("password")}
              <input className="input" type="password" autoComplete="current-password" dir="ltr" value={p} onChange={(e) => setP(e.target.value)} required />
            </label>
          ) : (
            <label className="field">{t("pinLabel")}
              <input className="input num" type="password" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} dir="ltr"
                style={{ fontSize: 26, letterSpacing: 10, textAlign: "center" }} value={p} onChange={(e) => setP(e.target.value.replace(/[^0-9\u0660-\u0669]/g, ""))} required />
            </label>
          )}
          {err && <div className="banner bad" role="alert">{err}</div>}
          <button className="btn pri lg" disabled={busy || !u.trim() || !p || (mode === "pin" && p.length < 4)}>{busy ? t("signingIn") : t("signIn")}</button>
        </div>
      </form>
    </AuthLayout>
  );
}
