import { useState, type FormEvent } from "react";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { usePublicSettings } from "../lib/api";
import { Icon } from "../components/icons";
import { Tools } from "../components/Shell";

export default function Login() {
  const { t, lang } = useI18n();
  const { signIn, idleExpired } = useAuth();
  const { data: ps } = usePublicSettings();
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const appName = (lang === "ar" ? ps?.app_name_ar : ps?.app_name_en) || t("app");
  const msg = lang === "ar" ? ps?.login_message_ar : ps?.login_message_en;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!u.trim() || !p) return;
    setBusy(true); setErr("");
    try {
      const r = await signIn(u, p);
      if (r.startsWith("db:")) setErr(`${t("errorGeneric")} (${r.slice(3)})`);
      else if (r !== "ok") setErr(t(r === "rate" ? "tooMany" : r === "nostaff" ? "noStaff" : "badLogin"));
    } catch { setErr(t("errorGeneric")); }
    setBusy(false);
  }

  return (
    <div className="login">
      <div style={{ position: "fixed", insetInlineEnd: 16, top: "calc(16px + env(safe-area-inset-top,0px))", display: "flex", gap: 8 }}><Tools /></div>
      <form className="box glass" onSubmit={submit} noValidate>
        <div className="mark" style={{ width: 56, height: 56, borderRadius: 18, marginBottom: 16 }}><Icon name="flame" size={28} /></div>
        <h1 style={{ margin: "0 0 4px", fontSize: 24 }}>{appName}</h1>
        <p className="muted" style={{ margin: "0 0 22px" }}>{msg || t("brand")}</p>
        {idleExpired && <div className="banner info">{t("sessionEnded")}</div>}
        <div style={{ display: "grid", gap: 14 }}>
          <label className="field">{t("username")}
            <input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" value={u} onChange={(e) => setU(e.target.value)} required />
          </label>
          <label className="field">{t("password")}
            <input className="input" type="password" autoComplete="current-password" dir="ltr" value={p} onChange={(e) => setP(e.target.value)} required />
          </label>
          {err && <div className="banner bad" role="alert">{err}</div>}
          <button className="btn pri lg" disabled={busy || !u.trim() || !p}>{busy ? t("signingIn") : t("signIn")}</button>
        </div>
      </form>
    </div>
  );
}
