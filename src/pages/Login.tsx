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
      <section className="login-hero">
        <div className="login-top">
          <span className="logo-chip"><img src={LOGO} alt="talabat mart" /></span>
          <div style={{ display: "flex", gap: 8 }}><Tools /></div>
        </div>
        <Art />
        <div>
          <p className="kick">{appName}</p>
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
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const msg = (lang === "ar" ? ps?.login_message_ar : ps?.login_message_en) || t("loginSub");
  const idErr = touched && !u.trim() ? t("required") : "";
  const secretErr = touched && (!p ? t("required") : mode === "pin" && p.length < 4 ? t("pinShort") : "");

  function switchMode(m: "password" | "pin") { setMode(m); setP(""); setErr(""); setShow(false); setTouched(false); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!u.trim() || !p || (mode === "pin" && p.length < 4)) return;
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

  const eye = (
    <button type="button" className="lf-eye" onClick={() => setShow(!show)} aria-label={show ? t("hide") : t("show")} aria-pressed={show}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {show ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.3 3.5M6.6 6.6C4.6 7.9 3.1 10 2 12c1 2.5 5 7 10 7 1.6 0 3.1-.4 4.4-1.1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>
          : <><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></>}
      </svg>
    </button>
  );

  return (
    <AuthLayout>
      <form className="box" onSubmit={submit} noValidate>
        <h2>{t("signIn")}</h2>
        <p className="sub">{msg}</p>
        {idleExpired && <div className="banner info">{t("sessionEnded")}</div>}
        <div className="lseg" role="tablist" aria-label={t("signIn")}>
          <button type="button" role="tab" aria-selected={mode === "password"} onClick={() => switchMode("password")}>{t("byPassword")}</button>
          <button type="button" role="tab" aria-selected={mode === "pin"} onClick={() => switchMode("pin")}>{t("byPin")}</button>
        </div>
        <div className="lf">
          <label htmlFor="login-id">{t("loginId")}</label>
          <div className={`lf-box ${idErr ? "bad" : ""}`}>
            <input id="login-id" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" inputMode="text"
              placeholder="01xxxxxxxxx" value={u} onChange={(e) => setU(e.target.value)} aria-invalid={!!idErr} aria-describedby={idErr ? "login-id-err" : undefined} />
          </div>
          {idErr && <span className="lf-err" id="login-id-err">{idErr}</span>}
        </div>
        <div className="lf">
          <label htmlFor="login-secret">{mode === "pin" ? t("pinLabel") : t("password")}</label>
          <div className={`lf-box ${secretErr ? "bad" : ""}`}>
            {mode === "password"
              ? <input id="login-secret" type={show ? "text" : "password"} autoComplete="current-password" dir="ltr" value={p}
                  onChange={(e) => setP(e.target.value)} aria-invalid={!!secretErr} aria-describedby={secretErr ? "login-secret-err" : undefined} />
              : <input id="login-secret" className="num pin" type={show ? "text" : "password"} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} dir="ltr"
                  placeholder="••••" value={p} onChange={(e) => setP(e.target.value.replace(/[^0-9\u0660-\u0669]/g, ""))}
                  aria-invalid={!!secretErr} aria-describedby={secretErr ? "login-secret-err" : undefined} />}
            {eye}
          </div>
          {secretErr && <span className="lf-err" id="login-secret-err">{secretErr}</span>}
        </div>
        {err && <div className="banner bad" role="alert">{err}</div>}
        <button className="lbtn" disabled={busy}>{busy ? t("signingIn") : t("signIn")}</button>
      </form>
    </AuthLayout>
  );
}
