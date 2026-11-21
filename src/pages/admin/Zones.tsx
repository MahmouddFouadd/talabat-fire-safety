import { useMemo, useState } from "react";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Field, Loading, Modal, useConfirm, useErrorToast, useToast } from "../../components/ui";
import { Icon } from "../../components/icons";
import { rpc, useDashboard, useInvalidate, useStaff, useStoreStatus, useZones } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { useI18n } from "../../lib/i18n";
import type { Zone } from "../../lib/types";

export default function Zones() {
  const { t, nf } = useI18n();
  const zones = useZones(); const dash = useDashboard(null); const stores = useStoreStatus();
  const [edit, setEdit] = useState<Zone | "new" | null>(null);
  const unzoned = (stores.data ?? []).filter((s) => !s.zone_id).length;
  return (
    <Shell title={t("zones")} actions={<button className="btn pri" onClick={() => setEdit("new")}><Icon name="plus" size={16} />{t("addZone")}</button>}>
      {unzoned > 0 && <div className="banner warn">{t("noZone")}: <b className="num">{nf(unzoned)}</b> {t("stores")}</div>}
      {zones.isLoading ? <Loading /> : zones.error ? <ErrorBox error={zones.error} /> : !zones.data?.length ? <Empty /> : (
        <div className="storelist">
          {zones.data.map((z) => {
            const s = dash.data?.zones.find((x) => x.id === z.id);
            const n = (stores.data ?? []).filter((x) => x.zone_id === z.id).length;
            return (
              <article key={z.id} className="sc">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div><h3 style={{ margin: 0 }}>{z.name_ar}</h3><div className="code">{z.name_en} · {z.code}</div></div>
                  {!z.active && <span className="pill p-none">{t("inactive")}</span>}
                </div>
                <div className="code num">{t("stores")}: {nf(n)}{s ? ` · ${t("doneThisWeek")}: ${nf(s.done)} · ${t("st_overdue")}: ${nf(s.overdue)}` : ""}</div>
                <button className="btn" onClick={() => setEdit(z)}>{t("edit")}</button>
              </article>
            );
          })}
        </div>
      )}
      {edit && <ZoneForm zone={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </Shell>
  );
}

function ZoneForm({ zone, onClose }: { zone: Zone | null; onClose: () => void }) {
  const { t, nf, lang } = useI18n(); const inv = useInvalidate(); const toast = useToast(); const toastErr = useErrorToast(); const { ask, node } = useConfirm();
  const zones = useZones(); const stores = useStoreStatus(); const staff = useStaff();
  const [f, setF] = useState({ code: zone?.code ?? "", name_ar: zone?.name_ar ?? "", name_en: zone?.name_en ?? "", sort: zone?.sort ?? 0, active: zone?.active ?? true });
  const [busy, setBusy] = useState(false); const [picking, setPicking] = useState(false); const [q, setQ] = useState(""); const [sel, setSel] = useState<Set<string>>(new Set());
  const valid = f.code.trim() && f.name_ar.trim() && f.name_en.trim();
  const inZone = useMemo(() => (stores.data ?? []).filter((s) => zone && s.zone_id === zone.id), [stores.data, zone]);
  const candidates = useMemo(() => (stores.data ?? []).filter((s) => !zone || s.zone_id !== zone.id)
    .filter((s) => !q || `${s.name} ${s.store_code}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.zone_id ? 1 : 0) - (b.zone_id ? 1 : 0) || a.store_code.localeCompare(b.store_code)), [stores.data, zone, q]);
  const zoneName = (id: string | null) => { if (!id) return t("noZone"); const z = zones.data?.find((x) => x.id === id); return z ? (lang === "ar" ? z.name_ar : z.name_en) : "—"; };
  const techName = (id: string | null) => staff.data?.find((s) => s.id === id)?.full_name ?? "—";
  const refresh = () => inv("zones", "dashboard", "store-status", "stores");

  async function save() {
    setBusy(true);
    const r = zone ? await supabase.from("zones").update(f).eq("id", zone.id) : await supabase.from("zones").insert(f);
    setBusy(false);
    if (r.error) return toastErr(r.error);
    await refresh(); toast(t("saved"), "ok"); onClose();
  }
  async function moveStores(codes: string[], zoneId: string | null) {
    setBusy(true);
    const { error } = await supabase.from("stores").update({ zone_id: zoneId }).in("store_code", codes);
    setBusy(false);
    if (error) return toastErr(error);
    await refresh(); toast(t("saved"), "ok"); setSel(new Set()); setPicking(false);
  }
  async function remove() {
    if (!zone || !(await ask(`${t("deleteConfirm")} ${zone.name_ar}؟ (${nf(inZone.length)} ${t("stores")} → ${t("noZone")})`, true))) return;
    try { await rpc("admin_delete_zone", { p_id: zone.id }); await refresh(); toast(t("deleted"), "ok"); onClose(); } catch (e) { toastErr(e); }
  }

  return (
    <Modal title={zone ? `${t("edit")} — ${zone.name_ar}` : t("addZone")} onClose={onClose} wide
      footer={<>
        {zone && <button className="btn danger" style={{ marginInlineEnd: "auto" }} onClick={remove}>{t("delete")}</button>}
        <button className="btn" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri" disabled={!valid || busy} onClick={save}>{t("save")}</button></>}>
      <div className="grid g2">
        <Field label={t("nameAr")}><input className="input" maxLength={80} value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} /></Field>
        <Field label={t("nameEn")}><input className="input" dir="ltr" maxLength={80} value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></Field>
        <Field label={t("code")}><input className="input" dir="ltr" maxLength={40} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label={t("sort")}><input className="input num" type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: Math.trunc(Number(e.target.value)) })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t("active")}</label>

      {zone && (
        <section style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 10px" }}>
            <h4 style={{ margin: 0 }}>{t("storesInZone")} <span className="code num">({nf(inZone.length)})</span></h4>
            <button className="btn" style={{ marginInlineStart: "auto" }} onClick={() => setPicking(!picking)}><Icon name="plus" size={16} />{t("addStores")}</button>
          </div>
          {picking && (
            <div className="zone-picker">
              <p className="code" style={{ margin: "0 0 8px" }}>{t("fromOtherZones")}</p>
              <input className="input" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
              <div className="pick-list">
                {candidates.map((s) => (
                  <label key={s.store_code} className="pick-row">
                    <input type="checkbox" checked={sel.has(s.store_code)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(s.store_code); else n.delete(s.store_code); setSel(n); }} />
                    <span style={{ minWidth: 0 }}><b>{s.name}</b> <span className="code num">{s.store_code}</span></span>
                    <span className={`pill ${s.zone_id ? "p-none" : "p-warn"}`}>{zoneName(s.zone_id)}</span>
                  </label>
                ))}
              </div>
              <button className="btn pri" style={{ marginTop: 10, width: "100%" }} disabled={!sel.size || busy} onClick={() => moveStores([...sel], zone.id)}>{t("moveHere")} ({nf(sel.size)})</button>
            </div>
          )}
          <div className="pick-list">
            {inZone.length === 0 && <p className="muted">{t("empty")}</p>}
            {inZone.map((s) => (
              <div key={s.store_code} className="pick-row">
                <span style={{ minWidth: 0 }}><b>{s.name}</b> <span className="code num">{s.store_code} · {techName(s.assigned_tech_id)}</span></span>
                <button className="btn" disabled={busy} onClick={() => moveStores([s.store_code], null)}>{t("removeFromZone")}</button>
              </div>
            ))}
          </div>
        </section>
      )}
      {node}
    </Modal>
  );
}
