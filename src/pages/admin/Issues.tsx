import { useState } from "react";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Field, Kpi, Loading, Modal, Pager, useErrorToast, useToast } from "../../components/ui";
import { InspectionDetail } from "../../components/InspectionDetail";
import { PAGE, useDashboard, useIssueEvents, useIssues, useStaff, useUpdateIssue, useZones } from "../../lib/api";
import { useI18n, type TKey } from "../../lib/i18n";
import type { Issue, IssueStatus, Priority } from "../../lib/types";

type Act = { issue: Issue; to: IssueStatus };

export default function Issues() {
  const { t, nf, df, lang } = useI18n();
  const [f, setF] = useState({ status: "active", priority: "", zone: "", page: 0 });
  const list = useIssues(f); const staff = useStaff(); const zones = useZones(); const dash = useDashboard(null);
  const [act, setAct] = useState<Act | null>(null); const [ins, setIns] = useState<string | null>(null); const [hist, setHist] = useState<Issue | null>(null);
  const name = (id: string | null) => staff.data?.find((s) => s.id === id)?.full_name ?? "—";
  const set = (k: string, v: string) => setF({ ...f, [k]: v, page: 0 });
  const bs = dash.data?.issues_by_status ?? {};

  return (
    <Shell title={t("issues")}>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi dot="bad" label={t("is_open")} value={bs.open ?? 0} onClick={() => set("status", "open")} />
        <Kpi dot="warn" label={t("is_assigned")} value={bs.assigned ?? 0} onClick={() => set("status", "assigned")} />
        <Kpi dot="info" label={t("is_in_progress")} value={bs.in_progress ?? 0} onClick={() => set("status", "in_progress")} />
        <Kpi dot="ok" label={t("is_resolved")} value={(bs.resolved ?? 0) + (bs.closed ?? 0)} onClick={() => set("status", "resolved")} />
      </div>
      <div className="filters">
        <select className="input" value={f.status} onChange={(e) => set("status", e.target.value)} aria-label={t("status")}>
          <option value="active">{t("openIssues")}</option><option value="">{t("all")}</option>
          {(["open", "assigned", "in_progress", "resolved", "closed"] as IssueStatus[]).map((s) => <option key={s} value={s}>{t(`is_${s}` as TKey)}</option>)}
        </select>
        <select className="input" value={f.priority} onChange={(e) => set("priority", e.target.value)} aria-label={t("priority")}>
          <option value="">{t("priority")}: {t("all")}</option>
          {(["critical", "high", "medium", "low"] as Priority[]).map((p) => <option key={p} value={p}>{t(`pr_${p}` as TKey)}</option>)}
        </select>
        <select className="input" value={f.zone} onChange={(e) => set("zone", e.target.value)} aria-label={t("zone")}>
          <option value="">{t("allZones")}</option>{zones.data?.map((z) => <option key={z.id} value={z.id}>{lang === "ar" ? z.name_ar : z.name_en}</option>)}
        </select>
      </div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={() => list.refetch()} /> : !list.data?.rows.length ? <Empty /> : (
        <section className="card glass">
          {list.data.rows.map((i) => (
            <div className="issue" key={i.id}>
              <div className={`prio pr-${i.priority}`} title={t(`pr_${i.priority}` as TKey)}>{t(`pr_${i.priority}` as TKey).slice(0, 1)}</div>
              <div>
                <h4>{t(`eq_${i.equipment}` as TKey)} — {i.stores?.name} <span className="code num">({i.store_code})</span></h4>
                <p>{i.description}</p>
                <div className="meta num">{i.issue_code} · {t(`pr_${i.priority}` as TKey)} · <b>{t(`is_${i.status}` as TKey)}</b> · {t("createdAt")} {df(i.created_at)}
                  {i.assigned_to && <> · {t("assignTo")} {name(i.assigned_to)}</>}
                  {i.resolved_at && <> · {t("resolvedAt")} {df(i.resolved_at)}</>}</div>
                {i.resolution_notes && <p style={{ marginTop: 6 }}><b>{t("resolutionNotes")}:</b> {i.resolution_notes}</p>}
              </div>
              <div className="flow">
                {i.inspection_id && <button className="btn" onClick={() => setIns(i.inspection_id)}>{t("fromInspection")}</button>}
                <button className="btn" onClick={() => setHist(i)}>{t("issueHistory")}</button>
                {i.status === "open" && <button className="btn" onClick={() => setAct({ issue: i, to: "assigned" })}>{t("assign")}</button>}
                {(i.status === "open" || i.status === "assigned") && <button className="btn" onClick={() => setAct({ issue: i, to: "in_progress" })}>{t("startRepair")}</button>}
                {!["resolved", "closed"].includes(i.status) && <button className="btn wine" onClick={() => setAct({ issue: i, to: "resolved" })}>{t("resolve")}</button>}
                {i.status === "resolved" && <button className="btn" onClick={() => setAct({ issue: i, to: "closed" })}>{t("closeIssue")}</button>}
                {["resolved", "closed"].includes(i.status) && <button className="btn" onClick={() => setAct({ issue: i, to: "open" })}>{t("reopen")}</button>}
              </div>
            </div>
          ))}
          <Pager page={f.page} count={list.data.count} size={PAGE} onPage={(p) => setF({ ...f, page: p })} />
        </section>
      )}
      <p className="code" style={{ textAlign: "center" }}>{list.data ? `${nf(list.data.count)}` : ""}</p>
      {act && <ActDialog act={act} onClose={() => setAct(null)} />}
      {ins && <InspectionDetail id={ins} onClose={() => setIns(null)} />}
      {hist && <History issue={hist} onClose={() => setHist(null)} />}
    </Shell>
  );
}

function ActDialog({ act, onClose }: { act: Act; onClose: () => void }) {
  const { t } = useI18n();
  const staff = useStaff(); const upd = useUpdateIssue(); const toast = useToast(); const toastErr = useErrorToast();
  const [who, setWho] = useState(act.issue.assigned_to ?? ""); const [note, setNote] = useState(act.issue.resolution_notes ?? "");
  const needsNote = act.to === "resolved" || act.to === "closed";
  const label = { assigned: "assign", in_progress: "startRepair", resolved: "resolve", closed: "closeIssue", open: "reopen" }[act.to as string] as TKey;
  return (
    <Modal title={`${t(label)} — ${act.issue.issue_code}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri" disabled={upd.isPending || (act.to === "assigned" && !who) || (needsNote && !note.trim())}
          onClick={() => upd.mutate({ id: act.issue.id, status: act.to, assigned: who || null, note: note || null }, { onSuccess: () => { toast(t("saved"), "ok"); onClose(); }, onError: toastErr })}>{t("save")}</button></>}>
      <div style={{ display: "grid", gap: 12 }}>
        {(act.to === "assigned" || act.to === "in_progress") && (
          <Field label={t("assignTo")}>
            <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">—</option>{staff.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </Field>
        )}
        <Field label={needsNote ? t("resolutionNotes") : t("notes")}>
          <textarea className="input" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} required={needsNote} />
        </Field>
      </div>
    </Modal>
  );
}

function History({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const { t, df, dir } = useI18n();
  const ev = useIssueEvents(issue.id); const staff = useStaff();
  return (
    <Modal title={`${t("issueHistory")} — ${issue.issue_code}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>{t("close")}</button>}>
      <div className="rev">
        <div className="r"><span>{t("is_open")}</span><span>{df(issue.created_at, true)}</span></div>
        {ev.data?.map((e) => (
          <div className="r" key={e.id} style={{ flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><b>{e.from_status ? t(`is_${e.from_status}` as TKey) : ""} {dir === "rtl" ? "←" : "→"} {t(`is_${e.to_status}` as TKey)}</b><span>{df(e.at, true)}</span></div>
            <span className="code">{staff.data?.find((s) => s.id === e.actor_id)?.full_name}{e.note ? ` — ${e.note}` : ""}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
