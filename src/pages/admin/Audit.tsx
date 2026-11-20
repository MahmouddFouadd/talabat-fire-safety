import { useState } from "react";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Loading, Pager } from "../../components/ui";
import { useAudit, useStaff } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

const ENTITIES = ["", "stores", "store_equipment", "staff", "zones", "inspections", "issues", "app_settings", "equipment_types", "auth"];

export default function Audit() {
  const { t, df } = useI18n();
  const [page, setPage] = useState(0); const [entity, setEntity] = useState("");
  const a = useAudit(page, entity); const staff = useStaff();
  const who = (id: string | null) => staff.data?.find((s) => s.id === id)?.full_name ?? "system";
  const summary = (d: unknown) => {
    if (!d || typeof d !== "object") return "";
    const o = d as Record<string, unknown>;
    return Object.entries(o).slice(0, 6).map(([k, v]) => {
      if (v && typeof v === "object" && "from" in (v as object)) { const x = v as { from: unknown; to: unknown }; return `${k}: ${JSON.stringify(x.from)} → ${JSON.stringify(x.to)}`; }
      return `${k}: ${typeof v === "object" ? "…" : String(v)}`;
    }).join(" · ");
  };
  return (
    <Shell title={t("audit")}>
      <div className="filters">
        <select className="input" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(0); }} aria-label={t("entity")}>
          {ENTITIES.map((e) => <option key={e} value={e}>{e || `${t("entity")}: ${t("all")}`}</option>)}
        </select>
      </div>
      {a.isLoading ? <Loading /> : a.error ? <ErrorBox error={a.error} /> : !a.data?.rows.length ? <Empty /> : (
        <div className="card glass" style={{ padding: "6px 16px" }}>
          <div className="tw"><table className="t cards">
            <thead><tr><th>{t("date")}</th><th>{t("actor")}</th><th>{t("action")}</th><th>{t("details")}</th></tr></thead>
            <tbody>{a.data.rows.map((r) => (
              <tr key={r.id}>
                <td className="num" style={{ whiteSpace: "nowrap" }}>{df(r.at, true)}</td>
                <td>{who(r.actor_staff)}</td>
                <td className="mh"><b>{r.action}</b> <span className="code">{r.entity} {r.entity_id ?? ""}</span></td>
                <td className="mh" style={{ fontSize: 12, maxWidth: 420, overflowWrap: "anywhere" }} dir="ltr">{summary(r.detail)}</td>
              </tr>))}</tbody>
          </table></div>
          <Pager page={page} count={a.data.count} size={50} onPage={setPage} />
        </div>
      )}
    </Shell>
  );
}
