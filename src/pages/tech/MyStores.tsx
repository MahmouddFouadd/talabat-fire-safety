import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Kpi, Loading, StatusPill, useToast } from "../../components/ui";
import { useInvalidate, useStoreEquipment, useStoreStatus } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { drafts, flushOutbox, listOutbox, removeOutbox, type OutboxItem } from "../../lib/offline";
import { errorText } from "../../lib/errors";
import type { StoreStatus } from "../../lib/types";

const ORDER: Record<StoreStatus, number> = { overdue: 0, never: 1, pending: 2, issues: 3, ok: 4 };

export default function MyStores() {
  const { t, nf, df, lang } = useI18n();
  const { staff } = useAuth(); const nav = useNavigate(); const toast = useToast(); const inv = useInvalidate();
  const st = useStoreStatus(); const eq = useStoreEquipment();
  const [outbox, setOutbox] = useState<OutboxItem[]>([]); const [draftStores, setDraftStores] = useState<Set<string>>(new Set()); const [syncing, setSyncing] = useState(false);

  const mine = useMemo(() => (st.data ?? []).filter((s) => s.active && s.assigned_tech_id === staff?.id).sort((a, b) => ORDER[a.status] - ORDER[b.status]), [st.data, staff]);
  const count = (k: StoreStatus) => mine.filter((s) => s.status === k).length;

  async function refreshLocal() {
    if (!staff) return;
    setOutbox(await listOutbox(staff.id));
    const ds = new Set<string>();
    for (const s of mine) if (await drafts.get(staff.id, s.store_code)) ds.add(s.store_code);
    setDraftStores(ds);
  }
  async function sync() {
    if (!staff) return;
    setSyncing(true);
    const r = await flushOutbox(staff.id);
    setSyncing(false);
    if (r.sent) { toast(`${t("submitted")} (${nf(r.sent)})`, "ok"); inv("store-status", "inspections", "issues"); }
    if (r.failed) toast(t("syncFailed"), "bad");
    refreshLocal();
  }
  useEffect(() => { refreshLocal(); }, [staff, mine.length]);
  useEffect(() => { const on = () => sync(); window.addEventListener("online", on); if (navigator.onLine) sync(); return () => window.removeEventListener("online", on); }, [staff]);

  return (
    <Shell title={`${t("myStores")} (${nf(mine.length)})`}>
      {!navigator.onLine && <div className="banner warn">{t("offline")}</div>}
      {outbox.length > 0 && (
        <div className="card glass" style={{ marginBottom: 16 }}>
          <h3 className="ttl">{t("pendingSync")} ({nf(outbox.length)})<small><button className="btn pri" disabled={syncing || !navigator.onLine} onClick={sync}>{t("syncNow")}</button></small></h3>
          {outbox.map((o) => (
            <div key={o.payload.client_id} className="issue" style={{ gridTemplateColumns: "1fr auto" }}>
              <div><h4>{o.storeName}</h4><div className="meta">{df(new Date(o.queuedAt).toISOString(), true)}{o.lastError && <span style={{ color: "var(--alarm)" }}> · {errorText(new Error(o.lastError), lang)}</span>}</div></div>
              {o.lastError && !/fetch|network/i.test(o.lastError) && <button className="btn danger" onClick={async () => { await removeOutbox(o.payload.client_id); refreshLocal(); }}>{t("discardDraft")}</button>}
            </div>
          ))}
        </div>
      )}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi dot="overdue" label={t("st_overdue")} value={count("overdue") + count("never")} />
        <Kpi dot="pending" label={t("st_pending")} value={count("pending")} />
        <Kpi dot="issues" label={t("st_issues")} value={count("issues")} />
        <Kpi dot="ok" label={t("st_ok")} value={count("ok")} />
      </div>
      {st.isLoading ? <Loading /> : st.error ? <ErrorBox error={st.error} onRetry={() => st.refetch()} /> : mine.length === 0 ? <Empty /> : (
        <div className="storelist">
          {mine.map((s) => {
            const b = eq.data?.find((e) => e.store_code === s.store_code);
            const done = s.status === "ok" || s.status === "issues";
            const queued = outbox.some((o) => o.payload.store_code === s.store_code);
            return (
              <article key={s.store_code} className="sc glass">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div><h3 style={{ margin: 0, fontSize: 16 }}>{s.name}</h3><div className="code num">{s.store_code} · {t("lastInspection")} {df(s.last_date)}</div></div>
                  <StatusPill s={s.status} />
                </div>
                {b ? <div className="eq num"><span>6kg ×{nf(b.p6_qty)}</span><span>CO2 ×{nf(b.co2_qty)}</span><span>FS ×{nf(b.fs_qty)}</span><span>HC ×{nf(b.hc_total)}</span></div>
                  : <div className="code" style={{ color: "var(--alarm)" }}>{t("noBaseTech")}</div>}
                {s.open_issues > 0 && <div className="code">{t("openIssues")}: {nf(s.open_issues)}</div>}
                <button className={`btn lg ${done || queued ? "" : "pri"}`} disabled={done || queued || !b} onClick={() => nav(`/tech/inspect/${encodeURIComponent(s.store_code)}`)}>
                  {queued ? t("pendingSync") : done ? t("doneWeek") : draftStores.has(s.store_code) ? t("continueDraft") : t("startInspection")}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
