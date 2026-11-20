import { useMemo, useState } from "react";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Loading, useConfirm } from "../../components/ui";
import { InspectionDetail } from "../../components/InspectionDetail";
import { useLatestPerStore } from "../../lib/api";
import { useI18n, type TKey } from "../../lib/i18n";
import type { EqCode, Inspection } from "../../lib/types";

const TABS: EqCode[] = ["p6", "co2", "fs", "hc", "al", "fp"];

export default function Reports() {
  const { t, nf, df } = useI18n();
  const latest = useLatestPerStore();
  const [tab, setTab] = useState<EqCode>("p6"); const [onlyIssues, setOnlyIssues] = useState(true); const [open, setOpen] = useState<string | null>(null);
  const { node } = useConfirm();
  const v = (x: string | null) => (x ? t(`v_${x}` as TKey) : "—");
  const rows = useMemo(() => (latest.data ?? []).filter((r) => {
    const s = r[`${tab}_status` as keyof Inspection] as string;
    return s !== "na" && (!onlyIssues || s === "issue");
  }), [latest.data, tab, onlyIssues]);
  const tot = useMemo(() => {
    if (tab === "hc") return rows.reduce((a, r) => ({ total: a.total + r.hc_total, bad: a.bad + (r.hc_total - r.hc_ok) }), { total: 0, bad: 0 });
    if (tab === "p6" || tab === "co2" || tab === "fs") return rows.reduce((a, r) => ({ total: a.total + (r[`${tab}_qty`] as number), bad: a.bad + (r[`${tab}_dmg`] as number) + (r[`${tab}_miss`] as number) }), { total: 0, bad: 0 });
    return null;
  }, [rows, tab]);

  function detail(r: Inspection) {
    switch (tab) {
      case "p6": case "co2": case "fs": return `${nf(r[`${tab}_good`])} ${t("good")} · ${nf(r[`${tab}_dmg`])} ${t("dmg")} · ${nf(r[`${tab}_miss`])} ${t("miss")} / ${nf(r[`${tab}_qty`])}`;
      case "hc": return `${nf(r.hc_ok)}/${nf(r.hc_total)} · ${t("hose")}: ${v(r.hc_hose)} · ${t("valve")}: ${v(r.hc_valve)} · ${t("glass")}: ${v(r.hc_glass)}`;
      case "al": return `${v(r.al_system)} · ${t("battery")}: ${v(r.al_battery)} · ${t("detectors")}: ${v(r.al_detectors)} · MCP: ${v(r.al_mcp)} · ${t("sounders")}: ${v(r.al_sounders)}`;
      case "fp": return `${v(r.fp_running)} · ${v(r.fp_tested)}`;
    }
  }

  return (
    <Shell title={t("reports")}>
      <div className="filters">
        <div className="seg" role="tablist" style={{ flexWrap: "wrap" }}>
          {TABS.map((k) => <button key={k} role="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{t(`eq_${k}` as TKey)}</button>)}
        </div>
        <label className="check"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />{t("ov_warn")}</label>
      </div>
      {tot && <div className="banner info">{t(`eq_${tab}` as TKey)}: <b className="num">{nf(tot.total)}</b> · {t("dmg")}/{t("miss")}: <b className="num">{nf(tot.bad)}</b></div>}
      {latest.isLoading ? <Loading /> : latest.error ? <ErrorBox error={latest.error} /> : rows.length === 0 ? <Empty /> : (
        <div className="card glass" style={{ padding: "6px 16px" }}>
          <div className="tw"><table className="t cards">
            <thead><tr><th>{t("store")}</th><th>{t("details")}</th><th>{t("lastInspection")}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => setOpen(r.id)}>
                <td><b>{r.store_name_snapshot}</b><div className="code num">{r.store_code} · {r.tech_name_snapshot}</div></td>
                <td style={{ fontSize: 13 }}>{detail(r)}{(r[`${tab}_rmk` as keyof Inspection] as string) ? <div className="code">{r[`${tab}_rmk` as keyof Inspection] as string}</div> : null}</td>
                <td className="mh num">{df(r.inspection_date)}</td>
              </tr>))}</tbody>
          </table></div>
        </div>
      )}
      {open && <InspectionDetail id={open} onClose={() => setOpen(null)} />}
      {node}
    </Shell>
  );
}
