import { useState } from "react";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Field, Loading, Modal, useErrorToast, useToast } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useDashboard, useInvalidate, useZones } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { useI18n } from "../../lib/i18n";
import type { Zone } from "../../lib/types";

export default function Zones() {
  const { t, nf } = useI18n();
  const zones = useZones(); const dash = useDashboard(null);
  const [edit, setEdit] = useState<Zone | "new" | null>(null);
  return (
    <Shell title={t("zones")} actions={<button className="btn pri" onClick={() => setEdit("new")}><Icon name="plus" size={16} />{t("addZone")}</button>}>
      {zones.isLoading ? <Loading /> : zones.error ? <ErrorBox error={zones.error} /> : !zones.data?.length ? <Empty /> : (
        <div className="storelist">
          {zones.data.map((z) => {
            const s = dash.data?.zones.find((x) => x.id === z.id);
            return (
              <article key={z.id} className="sc glass">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div><h3 style={{ margin: 0 }}>{z.name_ar}</h3><div className="code">{z.name_en} · {z.code}</div></div>
                  {!z.active && <span className="pill p-none">{t("inactive")}</span>}
                </div>
                {s && <div className="code num">{t("stores")}: {nf(s.stores)} · {t("doneThisWeek")}: {nf(s.done)} · {t("st_overdue")}: {nf(s.overdue)}</div>}
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
  const { t } = useI18n(); const inv = useInvalidate(); const toast = useToast(); const toastErr = useErrorToast();
  const [f, setF] = useState({ code: zone?.code ?? "", name_ar: zone?.name_ar ?? "", name_en: zone?.name_en ?? "", sort: zone?.sort ?? 0, active: zone?.active ?? true });
  const [busy, setBusy] = useState(false);
  const valid = f.code.trim() && f.name_ar.trim() && f.name_en.trim();
  async function save() {
    setBusy(true);
    const r = zone ? await supabase.from("zones").update(f).eq("id", zone.id) : await supabase.from("zones").insert(f);
    setBusy(false);
    if (r.error) return toastErr(r.error);
    await inv("zones", "dashboard"); toast(t("saved"), "ok"); onClose();
  }
  return (
    <Modal title={zone ? t("edit") : t("addZone")} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t("cancel")}</button><button className="btn pri" disabled={!valid || busy} onClick={save}>{t("save")}</button></>}>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label={t("code")}><input className="input" dir="ltr" maxLength={40} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label={t("nameAr")}><input className="input" maxLength={80} value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} /></Field>
        <Field label={t("nameEn")}><input className="input" dir="ltr" maxLength={80} value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></Field>
        <Field label={t("sort")}><input className="input num" type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: Math.trunc(Number(e.target.value)) })} /></Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t("active")}</label>
      </div>
    </Modal>
  );
}
