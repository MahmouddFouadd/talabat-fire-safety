import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import { ErrorBox, Field, Loading, useErrorToast, useToast } from "../../components/ui";
import { Icon } from "../../components/icons";
import { fetchAll, logEvent, rpc, useEquipmentTypes, useInvalidate, useSettings } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { useI18n } from "../../lib/i18n";
import { download } from "../../lib/csv";
import type { EquipmentType } from "../../lib/types";
import { EqIcon, ICON_KEYS } from "../../components/EqIcon";
import { Modal, useConfirm } from "../../components/ui";

const TEXT_KEYS = ["app_name_ar", "app_name_en", "login_message_ar", "login_message_en"] as const;

export default function Settings() {
  const { t } = useI18n();
  const settings = useSettings(); const types = useEquipmentTypes(); const inv = useInvalidate();
  const toast = useToast(); const toastErr = useErrorToast();
  const [f, setF] = useState<Record<string, unknown>>({}); const [busy, setBusy] = useState(false);
  useEffect(() => { if (settings.data) setF(settings.data); }, [settings.data]);

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
  async function backup() {
    setBusy(true);
    try {
      const tables: [string, string][] = [["zones", "id"], ["staff", "id"], ["stores", "store_code"], ["store_equipment", "store_code"],
        ["equipment_types", "code"], ["store_items", "store_code,type_code"], ["app_settings", "key"], ["inspections", "id"],
        ["inspection_items", "inspection_id,type_code"], ["issues", "id"], ["issue_events", "id"]];
      const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
      const counts: Record<string, number> = {};
      for (const [tb, key] of tables) {
        // stable order so paging never skips or repeats rows
        const rows = await fetchAll<unknown>((a, z) => key.split(",").reduce((b, k) => b.order(k), supabase.from(tb).select("*")).range(a, z));
        out[tb] = rows; counts[tb] = rows.length;
      }
      out.row_counts = counts;
      await logEvent("export_backup", counts);
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

      <EquipmentTypesCard />
      <section className="card glass" style={{ marginTop: 16 }}>
        <h3 className="ttl">{t("backup")}</h3>
        <p className="muted" style={{ marginTop: -6 }}>{t("backupHint")}</p>
        <button className="btn" disabled={busy} onClick={backup}><Icon name="download" size={16} />{t("downloadBackup")}</button>
      </section>
    </Shell>
  );
}

/* Equipment types: rename / switch off built-ins, add custom types, delete unused custom types. */
function EquipmentTypesCard() {
  const { t, lang } = useI18n(); const types = useEquipmentTypes(); const inv = useInvalidate(); const toast = useToast(); const toastErr = useErrorToast(); const { ask, node } = useConfirm();
  const [eq, setEq] = useState<EquipmentType[]>([]); const [busy, setBusy] = useState(false); const [adding, setAdding] = useState(false);
  useEffect(() => { if (types.data) setEq(types.data); }, [types.data]);
  const upd = (i: number, patch: Partial<EquipmentType>) => setEq(eq.map((y, j) => (j === i ? { ...y, ...patch } : y)));

  async function saveAll() {
    setBusy(true);
    for (const e of eq) {
      const row: Partial<EquipmentType> = { name_ar: e.name_ar.trim(), name_en: e.name_en.trim(), active: e.active, sort: e.sort };
      if (e.kind !== "builtin") Object.assign(row, { icon: e.icon, issue_priority: e.issue_priority });
      const { error } = await supabase.from("equipment_types").update(row).eq("code", e.code);
      if (error) { setBusy(false); return toastErr(error); }
    }
    setBusy(false); await inv("equipment-types"); toast(t("saved"), "ok");
  }
  async function remove(e: EquipmentType) {
    if (!(await ask(`${t("deleteConfirm")} ${lang === "ar" ? e.name_ar : e.name_en}؟`, true))) return;
    try { await rpc("admin_delete_equipment_type", { p_code: e.code }); await inv("equipment-types", "store-items"); toast(t("deleted"), "ok"); } catch (err) { toastErr(err); }
  }

  return (
    <section className="card glass" style={{ marginTop: 16 }}>
      <h3 className="ttl">{t("eqTypes")}<small><button className="btn pri" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t("addEqType")}</button></small></h3>
      <p className="muted" style={{ marginTop: -6 }}>{t("eqTypesHint")}</p>
      <div style={{ display: "grid", gap: 10 }}>
        {eq.map((e, i) => (
          <div key={e.code} className="eqtype-row">
            <span className="eqicon-badge" style={{ background: "var(--hero)" }}><EqIcon code={e.code} icon={e.icon} size={22} /></span>
            <Field label={t("nameAr")}><input className="input" value={e.name_ar} maxLength={80} onChange={(x) => upd(i, { name_ar: x.target.value })} /></Field>
            <Field label={t("nameEn")}><input className="input" dir="ltr" value={e.name_en} maxLength={80} onChange={(x) => upd(i, { name_en: x.target.value })} /></Field>
            <div className="eqtype-meta">
              <span className={`pill ${e.kind === "builtin" ? "p-none" : "p-info"}`}>{t(e.kind === "builtin" ? "builtin" : "custom")} · {e.kind === "check" ? t("kindCheck") : e.kind === "count" ? t("kindCount") : e.code}</span>
              {e.kind !== "builtin" && (
                <select className="input" style={{ minHeight: 36, width: "auto" }} value={e.issue_priority} onChange={(x) => upd(i, { issue_priority: x.target.value as EquipmentType["issue_priority"] })} aria-label={t("defaultPriority")}>
                  {(["critical", "high", "medium", "low"] as const).map((p) => <option key={p} value={p}>{t(`pr_${p}`)}</option>)}
                </select>
              )}
              {e.kind !== "builtin" && (
                <select className="input" style={{ minHeight: 36, width: "auto" }} value={e.icon ?? "box"} onChange={(x) => upd(i, { icon: x.target.value })} aria-label={t("icon")}>
                  {ICON_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              )}
              <label className="check" style={{ minHeight: 36 }}><input type="checkbox" checked={e.active} onChange={(x) => upd(i, { active: x.target.checked })} />{t("active")}</label>
              {e.kind !== "builtin" && <button className="btn danger" onClick={() => remove(e)}>{t("delete")}</button>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><button className="btn pri" disabled={busy} onClick={saveAll}>{t("save")}</button></div>
      {adding && <AddEqType onClose={() => setAdding(false)} nextSort={Math.max(0, ...eq.map((e) => e.sort)) + 1} />}
      {node}
    </section>
  );
}

function AddEqType({ onClose, nextSort }: { onClose: () => void; nextSort: number }) {
  const { t } = useI18n(); const inv = useInvalidate(); const toast = useToast(); const toastErr = useErrorToast();
  const [f, setF] = useState({ code: "", name_ar: "", name_en: "", kind: "count" as "count" | "check", icon: "light", issue_priority: "medium" as EquipmentType["issue_priority"] });
  const [busy, setBusy] = useState(false);
  const okCode = /^[a-z][a-z0-9_]{1,30}$/.test(f.code);
  async function save() {
    setBusy(true);
    const { error } = await supabase.from("equipment_types").insert({ ...f, name_ar: f.name_ar.trim(), name_en: f.name_en.trim(), has_quantity: f.kind === "count", active: true, sort: nextSort });
    setBusy(false);
    if (error) return toastErr(error);
    await inv("equipment-types"); toast(t("saved"), "ok"); onClose();
  }
  return (
    <Modal title={t("addEqType")} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t("cancel")}</button><button className="btn pri" disabled={busy || !okCode || !f.name_ar.trim() || !f.name_en.trim()} onClick={save}>{t("save")}</button></>}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="eqicon-badge" style={{ background: "var(--hero)", width: 56, height: 56 }}><EqIcon code={f.code || "box"} icon={f.icon} size={28} /></span>
          <div className="segpills" style={{ flex: 1 }}>
            {ICON_KEYS.map((k) => <button key={k} type="button" aria-pressed={f.icon === k} onClick={() => setF({ ...f, icon: k })} aria-label={k} title={k}><EqIcon code={k} size={20} /></button>)}
          </div>
        </div>
        <Field label={t("nameAr")}><input className="input" maxLength={80} value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} /></Field>
        <Field label={t("nameEn")}><input className="input" dir="ltr" maxLength={80} value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value, code: f.code || "" })} /></Field>
        <Field label={t("codeLatin")} hint="emergency_light"><input className="input" dir="ltr" maxLength={31} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} /></Field>
        <div className="q" style={{ margin: 0 }}>{t("kind")}</div>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={f.kind === "count"} onClick={() => setF({ ...f, kind: "count" })}>{t("kindCount")}</button>
          <button type="button" className="chip" aria-pressed={f.kind === "check"} onClick={() => setF({ ...f, kind: "check" })}>{t("kindCheck")}</button>
        </div>
        <Field label={t("defaultPriority")}>
          <select className="input" value={f.issue_priority} onChange={(e) => setF({ ...f, issue_priority: e.target.value as EquipmentType["issue_priority"] })}>
            {(["critical", "high", "medium", "low"] as const).map((p) => <option key={p} value={p}>{t(`pr_${p}`)}</option>)}
          </select>
        </Field>
        <p className="code" style={{ margin: 0 }}>{t("assignHint")}</p>
      </div>
    </Modal>
  );
}
