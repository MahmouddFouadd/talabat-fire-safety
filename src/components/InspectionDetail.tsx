import { useInspection } from "../lib/api";
import { useI18n, type TKey } from "../lib/i18n";
import { ErrorBox, Loading, Modal, OverallPill } from "./ui";
import type { Inspection } from "../lib/types";

export function InspectionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, nf, df } = useI18n();
  const { data: r, isLoading, error } = useInspection(id);
  const v = (x: string | null) => (x ? t(`v_${x}` as TKey) : "—");
  const st = (s: string) => s === "na" ? <span className="pill p-none">{t("v_na")}</span> : <span className={`pill ${s === "ok" ? "p-ok" : "p-warn"}`}>{t(s === "ok" ? "ov_ok" : "ov_warn")}</span>;
  const counted = (r: Inspection, k: "p6" | "co2" | "fs") => (
    <div className="r" key={k}><span>{t(`eq_${k}` as TKey)}</span>
      <span className="num">{nf(r[`${k}_good`])} {t("good")} · {nf(r[`${k}_dmg`])} {t("dmg")} · {nf(r[`${k}_miss`])} {t("miss")} / {nf(r[`${k}_qty`])} {st(r[`${k}_status`])}</span></div>
  );
  return (
    <Modal title={r ? `${r.store_name_snapshot} — ${r.inspection_code}` : t("loading")} onClose={onClose} wide footer={<button className="btn" onClick={onClose}>{t("close")}</button>}>
      {isLoading ? <Loading /> : error || !r ? <ErrorBox error={error} /> : (
        <>
          <div className="banner info" style={{ justifyContent: "space-between" }}>
            <span>{r.store_code} · {r.zone_snapshot} · {r.tech_name_snapshot}</span><span>{df(r.submitted_at, true)}</span><OverallPill s={r.overall_status} />
          </div>
          <div className="rev">
            {(["p6", "co2", "fs"] as const).map((k) => counted(r, k))}
            <div className="r"><span>{t("eq_hc")}</span><span>{nf(r.hc_ok)}/{nf(r.hc_total)} · {t("hose")}: {v(r.hc_hose)} · {t("valve")}: {v(r.hc_valve)} · {t("glass")}: {v(r.hc_glass)} {st(r.hc_status)}</span></div>
            <div className="r"><span>{t("eq_al")}</span><span>{v(r.al_system)} · {t("battery")}: {v(r.al_battery)} · {t("detectors")}: {v(r.al_detectors)} · MCP: {v(r.al_mcp)} · {t("sounders")}: {v(r.al_sounders)} {st(r.al_status)}</span></div>
            <div className="r"><span>{t("eq_fp")}</span><span>{r.fp_available ? `${v(r.fp_running)} · ${v(r.fp_tested)}` : t("v_na")} {st(r.fp_status)}</span></div>
          </div>
          {[["p6", r.p6_rmk], ["co2", r.co2_rmk], ["fs", r.fs_rmk], ["hc", r.hc_rmk], ["al", r.al_rmk], ["fp", r.fp_rmk]].filter(([, x]) => x).map(([k, x]) => (
            <p key={k} style={{ margin: "10px 0 0" }}><b>{t(`eq_${k}` as TKey)}:</b> {x}</p>
          ))}
          {r.general_remarks && <p><b>{t("generalRemarks")}:</b> {r.general_remarks}</p>}
          {r.duplicate_override && <div className="banner warn" style={{ marginTop: 10 }}>{t("override")}: {r.override_reason}</div>}
        </>
      )}
    </Modal>
  );
}
