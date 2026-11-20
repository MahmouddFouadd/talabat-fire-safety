import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import { ErrorBox, Field, Loading, useErrorToast, useToast } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useEquipmentTypes, useInvalidate, useSettings } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { useI18n } from "../../lib/i18n";
import { download } from "../../lib/csv";
import type { EquipmentType } from "../../lib/types";
import { EqIcon } from "../../components/EqIcon";

const TEXT_KEYS = ["app_name_ar", "app_name_en", "login_message_ar", "login_message_en"] as const;

export default function Settings() {
  const { t } = useI18n();
  const settings = useSettings(); const types = useEquipmentTypes(); const inv = useInvalidate();
  const toast = useToast(); const toastErr = useErrorToast();
  const [f, setF] = useState<Record<string, unknown>>({}); const [eq, setEq] = useState<EquipmentType[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { if (settings.data) setF(settings.data); }, [settings.data]);
  useEffect(() => { if (types.data) setEq(types.data); }, [types.data]);

  async function saveSettings() {
    const overdue = Number(f.overdue_days), idle = Number(f.session_idle_minutes);
    if (!(overdue >= 1 && overdue <= 60) || !(idle >= 5 && idle <= 1440)) return toastErr(new Error("23514"));
    setBusy(true);
    const rows = [...TEXT_KEYS.map((k) => ({ key: k, value: String(f[k] ?? "").slice(0, 200) })),
      { key: "overdue_days", value: Math.trunc(overdue) }, { key: "session_idle_minutes", value: Math.trunc(idle) },
      { key: "require_remarks_on_issue", value: f.require_remarks_on_issue === true },
      { key: "tech_store_scope", value: f.tech_store_scope === "zone" ? "zone" : "assigned" }];
    const { error } = await supabase.from("app_settings").upsert(rows);
    setBusy(false);
    if (error) return toastErr(error);
    await inv("settings", "public-settings", "store-status", "dashboard", "stores"); toast(t("saved"), "ok");
  }
  async function saveTypes() {
    setBusy(true);
    for (const e of eq) {
      const { error } = await supabase.from("equipment_types").update({ name_ar: e.name_ar.trim(), name_en: e.name_en.trim(), active: e.active }).eq("code", e.code);
      if (error) { setBusy(false); return toastErr(error); }
    }
    setBusy(false); await inv("equipment-types"); toast(t("saved"), "ok");
  }
  async function backup() {
    setBusy(true);
    try {
      const tables = ["zones", "staff", "stores", "store_equipment", "equipment_types", "app_settings", "inspections", "issues", "issue_events"];
      const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
      for (const tb of tables) {
        const { data, error } = await supabase.from(tb).select("*").limit(50000);
        if (error) throw error;
        out[tb] = data;
      }
      download(`fire-safety-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 1), "application/json");
    } catch (e) { toastErr(e); }
    setBusy(false);
  }

  if (settings.isLoading || types.isLoading) return <Shell title={t("settings")}><Loading /></Shell>;
  if (settings.error) return <Shell title={t("settings")}><ErrorBox error={settings.error} /></Shell>;
  const labels: Record<string, Parameters<typeof t>[0]> = { app_name_ar: "appNameAr", app_name_en: "appNameEn", login_message_ar: "loginMsgAr", login_message_en: "loginMsgEn" };

  return (
    <Shell title={t("settings")}>
      <section className="card glass">
        <h3 className="ttl">{t("general")}</h3>
        <div className="grid g2">
          {TEXT_KEYS.map((k) => <Field key={k} label={t(labels[k])}><input className="input" dir={k.endsWith("_en") ? "ltr" : "rtl"} maxLength={200} value={String(f[k] ?? "")} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
          <Field label={t("overdueDays")}><input className="input num" type="number" min={1} max={60} value={String(f.overdue_days ?? 7)} onChange={(e) => setF({ ...f, overdue_days: e.target.value })} /></Field>
          <Field label={t("idleMinutes")}><input className="input num" type="number" min={5} max={1440} value={String(f.session_idle_minutes ?? 480)} onChange={(e) => setF({ ...f, session_idle_minutes: e.target.value })} /></Field>
        </div>
        <div className="q">{t("techScope")}</div>
        <div className="chips" role="radiogroup" aria-label={t("techScope")}>
          {(["assigned", "zone"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={(f.tech_store_scope ?? "assigned") === v} aria-pressed={(f.tech_store_scope ?? "assigned") === v}
              className="chip c-ok" onClick={() => setF({ ...f, tech_store_scope: v })}>{t(v === "zone" ? "scopeZone" : "scopeAssigned")}</button>
          ))}
        </div>
        <p className="code" style={{ margin: "6px 0 10px" }}>{t("techScopeHint")}</p>
        <label className="check"><input type="checkbox" checked={f.require_remarks_on_issue === true} onChange={(e) => setF({ ...f, require_remarks_on_issue: e.target.checked })} />{t("requireRemarks")}</label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}><button className="btn pri" disabled={busy} onClick={saveSettings}>{t("save")}</button></div>
      </section>

      <section className="card glass" style={{ marginTop: 16 }}>
        <h3 className="ttl">{t("eqTypes")}</h3>
        <p className="muted" style={{ marginTop: -6 }}>{t("eqTypesHint")}</p>
        <div style={{ display: "grid", gap: 10 }}>
          {eq.map((e, i) => (
            <div key={e.code} className="grid" style={{ gridTemplateColumns: "auto minmax(0,1fr) minmax(0,1fr) auto", alignItems: "center", gap: 10 }}>
              <span className="eqicon-badge" style={{ background: "var(--hero)" }}><EqIcon code={e.code} size={22} /></span>
              <Field label={t("nameAr")}><input className="input" value={e.name_ar} maxLength={80} onChange={(x) => setEq(eq.map((y, j) => (j === i ? { ...y, name_ar: x.target.value } : y)))} /></Field>
              <Field label={t("nameEn")}><input className="input" dir="ltr" value={e.name_en} maxLength={80} onChange={(x) => setEq(eq.map((y, j) => (j === i ? { ...y, name_en: x.target.value } : y)))} /></Field>
              <label className="check"><input type="checkbox" checked={e.active} onChange={(x) => setEq(eq.map((y, j) => (j === i ? { ...y, active: x.target.checked } : y)))} />{t("active")}</label>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><button className="btn pri" disabled={busy} onClick={saveTypes}>{t("save")}</button></div>
      </section>

      <section className="card glass" style={{ marginTop: 16 }}>
        <h3 className="ttl">{t("backup")}</h3>
        <p className="muted" style={{ marginTop: -6 }}>{t("backupHint")}</p>
        <button className="btn" disabled={busy} onClick={backup}><Icon name="download" size={16} />{t("downloadBackup")}</button>
      </section>
    </Shell>
  );
}
