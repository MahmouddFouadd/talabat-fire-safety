import { useMemo, useState } from "react";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Loading } from "../../components/ui";
import { InspectionDetail } from "../../components/InspectionDetail";
import { EqIcon, useEq } from "../../components/EqIcon";
import { useEquipmentTypes, useInspectionItems, useLatestPerStore } from "../../lib/api";
import { useI18n, type TKey } from "../../lib/i18n";
import type { EqCode, Inspection } from "../../lib/types";

const TABS: EqCode[] = ["p6", "co2", "fs", "hc", "al", "fp"];

export default function Reports() {
  const { t, nf, df, lang } = useI18n();
  const latest = useLatestPerStore(); const types = useEquipmentTypes();
  const eqm = useEq();
  const customTypes = (types.data ?? []).filter((x) => (x.kind === "count" || x.kind === "check") && x.active);
  const ids = useMemo(() => (latest.data ?? []).map((r) => r.id), [latest.data]);
  const itemsQ = useInspectionItems(ids);
  const [tab, setTab] = useState<string>("p6");
  const isCustom = !TABS.includes(tab as EqCode); const [onlyIssues, setOnlyIssues] = useState(true); const [open, setOpen] = useState<string | null>(null);
  const name = (c: string) => { const x = types.data?.find((y) => y.code === c); return x ? (lang === "ar" ? x.name_ar : x.name_en) : t(`eq_${c}` as TKey); };
  const v = (x: string | null) => (x ? t(`v_${x}` as TKey) : "—");
  const itemOf = (r: Inspection) => itemsQ.data?.find((i) => i.inspection_id === r.id && i.type_code === tab);
  const st = (r: Inspection) => isCustom ? (itemOf(r)?.status ?? "na") : r[`${tab}_status` as keyof Inspection] as string;
  const all = useMemo(() => (latest.data ?? []).filter((r) => st(r) !== "na"), [latest.data, tab, itemsQ.data]);
  const rows = useMemo(() => all.filter((r) => !onlyIssues || st(r) === "issue"), [all, onlyIssues]);
  const issuesCount = all.filter((r) => st(r) === "issue").length;
  const qty = (r: Inspection) => {
    if (isCustom) { const it = itemOf(r); return it && it.kind === "count" ? { total: it.qty, dmg: it.dmg ?? 0, miss: it.miss ?? 0 } : null; }
    return (tab === "p6" || tab === "co2" || tab === "fs") ? { total: r[`${tab}_qty`] as number, dmg: r[`${tab}_dmg`] as number, miss: r[`${tab}_miss`] as number } : null;
  };
  const tot = useMemo(() => {
    if (tab === "hc") return rows.reduce((a, r) => ({ total: a.total + r.hc_total, bad: a.bad + (r.hc_total - r.hc_ok) }), { total: 0, bad: 0 });
    if (tab === "p6" || tab === "co2" || tab === "fs" || (isCustom && customTypes.find((c) => c.code === tab)?.kind === "count")) return rows.reduce((a, r) => { const q = qty(r) ?? { total: 0, dmg: 0, miss: 0 }; return { total: a.total + q.total, bad: a.bad + q.dmg + q.miss }; }, { total: 0, bad: 0 });
    return null;
  }, [rows, tab]);

  function chips(r: Inspection): [string, "ok" | "warn" | "bad"][] {
    const g = (x: string | null, okv = "good"): "ok" | "warn" | "bad" => (!x || x === okv ? "ok" : x === "missing" || x === "fault" || x === "failed" || x === "not_running" || x === "not_tested" ? "bad" : "warn");
    if (isCustom) {
      const q = qty(r);
      return q ? [[`${nf(q.total - q.dmg - q.miss)} ${t("good")}`, "ok"], [`${nf(q.dmg)} ${t("dmg")}`, q.dmg ? "warn" : "ok"], [`${nf(q.miss)} ${t("miss")}`, q.miss ? "bad" : "ok"]]
               : [[t(itemOf(r)?.ok === false ? "hasProblem" : "isOk"), itemOf(r)?.ok === false ? "bad" : "ok"]];
    }
    switch (tab) {
      case "p6": case "co2": case "fs": { const q = qty(r)!; return [[`${nf(q.total - q.dmg - q.miss)} ${t("good")}`, "ok"], [`${nf(q.dmg)} ${t("dmg")}`, q.dmg ? "warn" : "ok"], [`${nf(q.miss)} ${t("miss")}`, q.miss ? "bad" : "ok"]]; }
      case "hc": return [[`${nf(r.hc_ok)}/${nf(r.hc_total)} ${t("good")}`, r.hc_ok < r.hc_total ? "warn" : "ok"], [`${t("hose")}: ${v(r.hc_hose)}`, g(r.hc_hose)], [`${t("valve")}: ${v(r.hc_valve)}`, g(r.hc_valve)], [`${t("glass")}: ${v(r.hc_glass)}`, g(r.hc_glass)]];
      case "al": return [[v(r.al_system), g(r.al_system, "ok")], [`${t("battery")}: ${v(r.al_battery)}`, g(r.al_battery)], [`${t("detectors")}: ${v(r.al_detectors)}`, g(r.al_detectors)], [`MCP: ${v(r.al_mcp)}`, g(r.al_mcp)], [`${t("sounders")}: ${v(r.al_sounders)}`, g(r.al_sounders, "working")]];
      case "fp": return [[v(r.fp_running), g(r.fp_running, "running")], [v(r.fp_tested), g(r.fp_tested, "tested")]];
    }
    return [];
  }

  return (
    <Shell title={t("reports")}>
      <div className="segpills" role="tablist" style={{ marginBottom: 12 }}>
        {[...TABS, ...customTypes.map((c) => c.code)].map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}><EqIcon code={k} icon={eqm.icon(k)} size={20} />{name(k)}</button>
        ))}
      </div>
      <section className="hero-card eq-hero">
        <div className="eq-ic"><EqIcon code={tab} icon={eqm.icon(tab)} size={34} /></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 600 }}>{name(tab)}</div>
          <div className="code">{t("lastInspection")} · {nf(all.length)} {t("stores")}</div>
        </div>
        <div className="eq-stats">
          {tot && <span className="hero-chip"><b className="num">{nf(tot.total)}</b>{t("installed")}</span>}
          {tot && <span className="hero-chip"><i className="dot d-bad" /><b className="num">{nf(tot.bad)}</b>{t("dmg")}/{t("miss")}</span>}
          <span className="hero-chip"><i className="dot d-warn" /><b className="num">{nf(issuesCount)}</b>{t("ov_warn")}</span>
        </div>
      </section>
      <div className="segpills" style={{ margin: "14px 0 12px" }}>
        <button aria-pressed={onlyIssues} onClick={() => setOnlyIssues(true)}>{t("ov_warn")} <b className="num">{nf(issuesCount)}</b></button>
        <button aria-pressed={!onlyIssues} onClick={() => setOnlyIssues(false)}>{t("allStores")} <b className="num">{nf(all.length)}</b></button>
      </div>
      {latest.isLoading ? <Loading /> : latest.error ? <ErrorBox error={latest.error} /> : rows.length === 0 ? <Empty /> : (
        <div className="eqlist">
          {rows.map((r) => {
            const rmk = isCustom ? itemOf(r)?.rmk ?? null : r[`${tab}_rmk` as keyof Inspection] as string | null;
            return (
              <button key={r.id} className="eqrow" onClick={() => setOpen(r.id)}>
                <div className="eqrow-head">
                  <div style={{ minWidth: 0 }}><b>{r.store_name_snapshot}</b><div className="code num">{r.store_code} · {r.tech_name_snapshot} · {df(r.inspection_date)}</div></div>
                  <span className={`pill ${st(r) === "issue" ? "p-warn" : "p-ok"}`}>{t(st(r) === "issue" ? "ov_warn" : "ov_ok")}</span>
                </div>
                <div className="eqchips">{chips(r).map(([txt, c], i) => <span key={i} className={`eqchip e-${c}`}>{txt}</span>)}</div>
                {rmk && <p className="code" style={{ margin: 0 }}>“{rmk}”</p>}
              </button>
            );
          })}
        </div>
      )}
      {open && <InspectionDetail id={open} onClose={() => setOpen(null)} />}
    </Shell>
  );
}
