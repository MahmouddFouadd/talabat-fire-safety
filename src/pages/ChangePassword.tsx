import { useState, type FormEvent } from "react";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { AuthLayout } from "./Login";

export const strong = (p: string) => p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);

export default function ChangePassword() {
  const { t } = useI18n();
  const { changePassword, signOut } = useAuth();
  const [a, setA] = useState(""); const [b, setB] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!strong(a)) return setErr(t("pwRule"));
    if (a !== b) return setErr(t("pwMismatch"));
    setBusy(true);
    const ok = await changePassword(a);
    setBusy(false);
    if (!ok) setErr(t("errorGeneric"));
  }
  return (
    <AuthLayout>
      <form className="box" onSubmit={submit}>
        <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>{t("newPassword")}</h1>
        <p className="muted" style={{ marginTop: 0 }}>{t("mustChange")}</p>
        <div style={{ display: "grid", gap: 14 }}>
          <label className="field">{t("newPassword")}<input className="input" type="password" dir="ltr" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} /><small>{t("pwRule")}</small></label>
          <label className="field">{t("confirmPassword")}<input className="input" type="password" dir="ltr" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></label>
          {err && <div className="banner bad" role="alert">{err}</div>}
          <button className="btn pri lg" disabled={busy}>{t("setPassword")}</button>
          <button type="button" className="btn" onClick={signOut}>{t("signOut")}</button>
        </div>
      </form>
    </AuthLayout>
  );
}
