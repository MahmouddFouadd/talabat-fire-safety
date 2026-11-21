import { useState } from "react";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Loading, OverallPill, Pager, useErrorToast } from "../../components/ui";
import { InspectionDetail } from "../../components/InspectionDetail";
import { Icon } from "../../components/icons";
import { PAGE, fetchAll, logEvent, useInspections, useStaff, useZones, type InspectionFilter } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { useI18n } from "../../lib/i18n";
import { download, toCsv } from "../../lib/csv";
import type { Inspection } from "../../lib/types";

export const INS_COLUMNS: (keyof Inspection)[] = ["inspection_code", "store_code", "store_name_snapshot", "zone_snapshot", "tech_name_snapshot", "week_start", "inspection_date", "submitted_at",
  "p6_qty", "p6_good", "p6_dmg", "p6_miss", "p6_status", "p6_rmk", "co2_qty", "co2_good", "co2_dmg", "co2_miss", "co2_status", "co2_rmk",
  "fs_qty", "fs_good", "fs_dmg", "fs_miss", "fs_status", "fs_rmk", "hc_total", "hc_ok", "hc_hose", "hc_valve", "hc_glass", "hc_status", "hc_rmk",
  "al_system", "al_battery", "al_detectors", "al_mcp", "al_sounders", "al_status", "al_rmk", "fp_available", "fp_running", "fp_tested", "fp_status", "fp_rmk",
  "overall_status", "general_remarks", "duplicate_override", "override_reason"];

export default function Inspections({ techMode = false }: { techMode?: boolean }) {
  const { t, nf, df } = useI18n();
  const [f, setF] = useState<InspectionFilter>({ page: 0 });
  const list = useInspections(f); const staff = useStaff(!techMode); const zones = useZones();
  const [open, setOpen] = useState<string | null>(null); const [busy, setBusy] = useState(false); const toastErr = useErrorToast();
  const set = (k: keyof InspectionFilter, v: string) => setF({ ...f, [k]: v || undefined, page: 0 });

  async function exportCsv() {
    setBusy(true);
    try {
      const rows = await fetchAll<Record<string, unknown>>((from, to) => {
        let b = supabase.from("inspections").select(INS_COLUMNS.join(",")).order("submitted_at", { ascending: false }).order("id").range(from, to);
        if (f.store) b = b.ilike("store_code", `%${f.store}%`); if (f.tech) b = b.eq("tech_id", f.tech); if (f.zone) b = b.eq("zone_snapshot", f.zone);
        if (f.status) b = b.eq("overall_status", f.status); if (f.from) b = b.gte("inspection_date", f.from); if (f.to) b = b.lte("inspection_date", f.to);
        return b;
      });
      await logEvent("export_csv", { table: "inspections", rows: rows.length, filter: { ...f, page: undefined } });
      download("inspections.csv", toCsv([INS_COLUMNS as string[], ...rows.map((r) => INS_COLUMNS.map((c) => r[c] as string))]));
    } catch (e) { toastErr(e); }
    setBusy(false);
  }

  return (
    <Shell title={techMode ? t("history") : t("inspections")} actions={!techMode && <button className="btn" disabled={busy} onClick={exportCsv}><Icon name="download" size={16} />{t("export")}</button>}>
      <div className="filters">
        <input className="input" placeholder={t("code")} value={f.store ?? ""} onChange={(e) => set("store", e.target.value)} aria-label={t("store")} dir="ltr" />
        {!techMode && <select className="input" value={f.tech ?? ""} onChange={(e) => set("tech", e.target.value)} aria-label={t("tech")}>
          <option value="">{t("tech")}: {t("all")}</option>{staff.data?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>}
        {!techMode && <select className="input" value={f.zone ?? ""} onChange={(e) => set("zone", e.target.value)} aria-label={t("zone")}>
          <option value="">{t("allZones")}</option>{zones.data?.map((z) => <option key={z.id} value={z.code}>{z.code}</option>)}</select>}
        <select className="input" value={f.status ?? ""} onChange={(e) => set("status", e.target.value)} aria-label={t("status")}>
          <option value="">{t("status")}: {t("all")}</option><option value="ok">{t("ov_ok")}</option><option value="warn">{t("ov_warn")}</option></select>
        <input className="input" type="date" value={f.from ?? ""} onChange={(e) => set("from", e.target.value)} aria-label="from" />
        <input className="input" type="date" value={f.to ?? ""} onChange={(e) => set("to", e.target.value)} aria-label="to" />
      </div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={() => list.refetch()} /> : !list.data?.rows.length ? <Empty /> : (
        <div className="card glass" style={{ padding: "6px 16px" }}>
          <div className="tw">
            <table className="t cards">
              <thead><tr><th>{t("store")}</th><th>{t("tech")}</th><th>{t("weekOf")}</th><th>{t("date")}</th><th>{t("status")}</th></tr></thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <tr key={r.id} className="click" onClick={() => setOpen(r.id)}>
                    <td><b>{r.store_name_snapshot}</b><div className="code num">{r.store_code} · {r.inspection_code}</div></td>
                    <td className="mh">{r.tech_name_snapshot}</td>
                    <td className="mh num">{df(r.week_start)}</td>
                    <td className="num">{df(r.submitted_at, true)}</td>
                    <td><OverallPill s={r.overall_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={f.page} count={list.data.count} size={PAGE} onPage={(p) => setF({ ...f, page: p })} />
          <p className="code" style={{ textAlign: "center" }}>{nf(list.data.count)}</p>
        </div>
      )}
      {open && <InspectionDetail id={open} onClose={() => setOpen(null)} />}
    </Shell>
  );
}
