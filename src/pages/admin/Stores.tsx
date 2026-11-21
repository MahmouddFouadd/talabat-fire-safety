import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Field, Loading, Modal, StatusPill, useConfirm, useErrorToast, useToast } from "../../components/ui";
import { rpc, useInvalidate, useSaveStore, useStaff, useStoreEquipment, useStoreStatus, useStores, useZones, logEvent } from "../../lib/api";
import { useI18n, type TKey } from "../../lib/i18n";
import { toCsv, download } from "../../lib/csv";
import { Icon } from "../../components/icons";
import type { Store, StoreStatus } from "../../lib/types";

const schema = z.object({
  store_code: z.string().trim().regex(/^[A-Za-z0-9_-]{1,30}$/),
  name: z.string().trim().min(1).max(120),
  zone_id: z.string().uuid().nullable(),
  assigned_tech_id: z.string().uuid().nullable(),
  notes: z.string().max(500).nullable(),
});
const qty = z.number().int().min(0).max(9999);

export default function Stores() {
  const { t, nf, df, lang } = useI18n();
  const [sp, setSp] = useSearchParams();
  const status = useStoreStatus(); const stores = useStores(); const zones = useZones(); const staff = useStaff(); const eq = useStoreEquipment();
  const [edit, setEdit] = useState<Store | "new" | null>(null);
  const save = useSaveStore(); const toastErr = useErrorToast(); const toast = useToast(); const { ask, node } = useConfirm();
  const q = sp.get("q") ?? ""; const zf = sp.get("zone") ?? ""; const sf = sp.get("status") ?? ""; const flagged = sp.get("flagged") === "1"; const showInactive = sp.get("inactive") === "1";
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };

  const techName = (id: string | null) => staff.data?.find((s) => s.id === id)?.full_name ?? t("unassigned");
  const zoneName = (id: string | null) => { if (!id) return t("noZone"); const z = zones.data?.find((x) => x.id === id); return z ? (lang === "ar" ? z.name_ar : z.name_en) : "—"; };

  const rows = useMemo(() => (status.data ?? []).filter((s) =>
    (showInactive || s.active) && (!zf || (zf === "none" ? !s.zone_id : s.zone_id === zf)) && (!flagged || s.flagged) &&
    (!sf || s.status === sf || (sf === "pending" && s.status === "never")) &&
    (!q || `${s.name} ${s.store_code}`.toLowerCase().includes(q.toLowerCase()))), [status.data, q, zf, sf, flagged, showInactive]);

  async function toggleActive(s: Store) {
    if (!(await ask(`${t(s.active ? "deactivate" : "activate")}: ${s.name} (${s.store_code})?`, s.active))) return;
    save.mutate({ isNew: false, store: { store_code: s.store_code, active: !s.active } }, { onSuccess: () => toast(t("saved"), "ok"), onError: toastErr });
  }

  function exportCsv() {
    download("stores.csv", toCsv([[t("code"), t("name"), t("zone"), t("tech"), t("status"), t("lastInspection"), t("openIssues")],
      ...rows.map((s) => [s.store_code, s.name, zoneName(s.zone_id), techName(s.assigned_tech_id), t(`st_${s.status}` as TKey), s.last_date ?? "", s.open_issues])]));
    void logEvent("export_csv", { table: "stores", rows: rows.length });
  }

  const loading = status.isLoading || stores.isLoading || zones.isLoading || staff.isLoading;
  return (
    <Shell title={`${t("stores")} (${nf(rows.length)})`} actions={<><button className="btn" onClick={exportCsv}><Icon name="download" size={16} />{t("export")}</button><button className="btn pri" onClick={() => setEdit("new")}><Icon name="plus" size={16} />{t("addStore")}</button></>}>
      <div className="filters">
        <input className="input" placeholder={t("search")} value={q} onChange={(e) => setParam("q", e.target.value)} aria-label={t("search")} />
        <select className="input" value={zf} onChange={(e) => setParam("zone", e.target.value)} aria-label={t("zone")}>
          <option value="">{t("allZones")}</option>{zones.data?.map((z) => <option key={z.id} value={z.id}>{lang === "ar" ? z.name_ar : z.name_en}</option>)}
          <option value="none">{t("noZone")}</option>
        </select>
        <select className="input" value={sf} onChange={(e) => setParam("status", e.target.value)} aria-label={t("status")}>
          <option value="">{t("all")}</option>{(["ok", "issues", "pending", "overdue", "never"] as StoreStatus[]).map((k) => <option key={k} value={k}>{t(`st_${k}` as TKey)}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={flagged} onChange={(e) => setParam("flagged", e.target.checked ? "1" : "")} />{t("flaggedOnly")}</label>
        <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setParam("inactive", e.target.checked ? "1" : "")} />{t("inactive")}</label>
      </div>
      {loading ? <Loading /> : status.error ? <ErrorBox error={status.error} onRetry={() => status.refetch()} /> : rows.length === 0 ? <Empty /> : (
        <div className="card glass" style={{ padding: "6px 16px" }}>
          <div className="tw">
            <table className="t cards">
              <thead><tr><th>{t("store")}</th><th>{t("zone")}</th><th>{t("tech")}</th><th>{t("lastInspection")}</th><th>{t("openIssues")}</th><th>{t("status")}</th><th /></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const full = stores.data?.find((x) => x.store_code === s.store_code);
                  return (
                    <tr key={s.store_code} className="click" onClick={() => full && setEdit(full)}>
                      <td><b>{s.name}</b> {s.flagged && <span className="pill p-warn">{t("flagged")}</span>} {!s.active && <span className="pill p-none">{t("inactive")}</span>}
                        <div className="code num">{s.store_code}{!s.has_base && <span style={{ color: "var(--alarm)" }}> · {t("noBase")}</span>}</div></td>
                      <td className="mh">{zoneName(s.zone_id)}</td>
                      <td className="mh">{techName(s.assigned_tech_id)}</td>
                      <td className="mh num">{df(s.last_date)}</td>
                      <td className="mh num">{s.open_issues ? nf(s.open_issues) : "—"}</td>
                      <td><StatusPill s={s.status} /></td>
                      <td className="mh" onClick={(e) => e.stopPropagation()}>{full && <button className="btn" onClick={() => toggleActive(full)}>{t(full.active ? "deactivate" : "activate")}</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {edit && <StoreForm store={edit === "new" ? null : edit} base={edit === "new" ? undefined : eq.data?.find((e) => e.store_code === edit.store_code)} onClose={() => setEdit(null)} />}
      {node}
    </Shell>
  );
}

function StoreForm({ store, base, onClose }: { store: Store | null; base?: { p6_qty: number; co2_qty: number; fs_qty: number; hc_total: number }; onClose: () => void }) {
    const { t, lang } = useI18n();
    const inv = useInvalidate(); const [delStep, setDelStep] = useState<null | { inspections: number; issues: number }>(null); const [typed, setTyped] = useState("");
    async function del(force: boolean) {
      if (!store) return;
      try {
        const r = await rpc<{ needs_force?: boolean; inspections?: number; issues?: number }>("admin_delete_store", { p_code: store.store_code, p_force: force });
        if (r?.needs_force) { setDelStep({ inspections: r.inspections ?? 0, issues: r.issues ?? 0 }); return; }
        await inv("stores", "store-status", "store-equipment", "store-items", "dashboard", "issues", "inspections"); toast(t("deleted"), "ok"); onClose();
      } catch (e) { toastErr(e); }
    }
    const status = useStoreStatus(); const zones = useZones(); const staff = useStaff();
    const save = useSaveStore(); const toastErr = useErrorToast(); const toast = useToast();
    const [f, setF] = useState({ store_code: store?.store_code ?? "", name: store?.name ?? "", zone_id: store?.zone_id ?? "", assigned_tech_id: store?.assigned_tech_id ?? "", notes: store?.notes ?? "", flagged: store?.flagged ?? false });
    const [b, setB] = useState({ p6_qty: base?.p6_qty ?? 0, co2_qty: base?.co2_qty ?? 0, fs_qty: base?.fs_qty ?? 0, hc_total: base?.hc_total ?? 0 });
    const [setBase, setSetBase] = useState(!!base || !store);
    const [errs, setErrs] = useState<Record<string, string>>({});
    const techs = (staff.data ?? []).filter((s) => s.active && s.role === "technician");

    function submit() {
      const parsed = schema.safeParse({ ...f, zone_id: f.zone_id || null, assigned_tech_id: f.assigned_tech_id || null, notes: f.notes || null });
      const e: Record<string, string> = {};
      if (!parsed.success) parsed.error.issues.forEach((i) => (e[String(i.path[0])] = t("errorGeneric")));
      if (!store && status.data?.some((s) => s.store_code.toLowerCase() === f.store_code.trim().toLowerCase())) e.store_code = "23505";
      if (setBase) Object.entries(b).forEach(([k, v]) => { if (!qty.safeParse(v).success) e[k] = "0–9999"; });
      setErrs(e);
      if (Object.keys(e).length || !parsed.success) return;
      save.mutate({ isNew: !store, store: { ...parsed.data, flagged: f.flagged, ...(store ? {} : { active: true }) }, base: setBase ? { store_code: parsed.data.store_code, ...b } : null },
        { onSuccess: () => { toast(t("saved"), "ok"); onClose(); }, onError: toastErr });
    }
    return (
      <Modal title={store ? `${t("editStore")} — ${store.store_code}` : t("addStore")} onClose={onClose} wide
        footer={<>
          {store && <button className="btn danger" style={{ marginInlineEnd: "auto" }} onClick={() => { if (confirm(`${t("deleteConfirm")} ${store.name} (${store.store_code})؟`)) del(false); }}>{t("delete")}</button>}
          <button className="btn" onClick={onClose}>{t("cancel")}</button><button className="btn pri" disabled={save.isPending} onClick={submit}>{t("save")}</button></>}>
        {delStep && store && (
          <div className="banner bad" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <span>{t("deleteForce")} ({delStep.inspections} / {delStep.issues})</span>
            <input className="input" dir="ltr" placeholder={store.store_code} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={t("typeToConfirm")} />
            <button className="btn danger" disabled={typed.trim() !== store.store_code} onClick={() => del(true)}>{t("delete")}</button>
          </div>
        )}
        <div className="grid g2">
          <Field label={t("storeCode")} hint={t("storeCodeHint")} error={errs.store_code === "23505" ? t("errorGeneric") : errs.store_code}>
            <input className="input" dir="ltr" value={f.store_code} disabled={!!store} onChange={(e) => setF({ ...f, store_code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={t("storeName")} error={errs.name}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t("zone")} error={errs.zone_id}>
            <select className="input" value={f.zone_id} onChange={(e) => setF({ ...f, zone_id: e.target.value })}>
              <option value="">{t("noZone")}</option>{zones.data?.filter((z) => z.active || z.id === f.zone_id).map((z) => <option key={z.id} value={z.id}>{lang === "ar" ? z.name_ar : z.name_en}</option>)}
            </select>
          </Field>
          <Field label={t("assignedTech")}>
            <select className="input" value={f.assigned_tech_id} onChange={(e) => setF({ ...f, assigned_tech_id: e.target.value })}>
              <option value="">{t("unassigned")}</option>{techs.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 14 }}><Field label={t("notes")}><textarea className="input" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        <label className="check"><input type="checkbox" checked={f.flagged} onChange={(e) => setF({ ...f, flagged: e.target.checked })} />{t("flagged")}</label>
        <h4 style={{ margin: "14px 0 8px" }}>{t("baseQty")}</h4>
        {store && !base && <label className="check"><input type="checkbox" checked={setBase} onChange={(e) => setSetBase(e.target.checked)} />{t("noBase")} — {t("add")}</label>}
        {setBase && (
          <div className="grid g4">
            {(["p6_qty", "co2_qty", "fs_qty", "hc_total"] as const).map((k) => (
              <Field key={k} label={t(`eq_${k.split("_")[0]}` as TKey)} error={errs[k]}>
                <input className="input num" type="number" inputMode="numeric" min={0} max={9999} value={b[k]} onChange={(e) => setB({ ...b, [k]: Math.trunc(Number(e.target.value)) })} />
              </Field>
            ))}
          </div>
        )}
      </Modal>
    );
  }
