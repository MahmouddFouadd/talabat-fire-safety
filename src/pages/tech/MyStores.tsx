import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Loading, StatusPill, useToast } from "../../components/ui";
import { useInvalidate, useStoreEquipment, useStoreItems, useStoreStatus } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { drafts, flushOutbox, listOutbox, removeOutbox, type OutboxItem } from "../../lib/offline";
import { errorText } from "../../lib/errors";
import { PinDialog, usePinStatus } from "../../components/PinDialog";
import { EqIcon, useEq } from "../../components/EqIcon";
import type { StoreStatus } from "../../lib/types";

const ORDER: Record<StoreStatus, number> = { overdue: 0, never: 1, pending: 2, issues: 3, ok: 4 };

export default function MyStores() {
  const { t, nf, df, lang } = useI18n();
  const { staff } = useAuth(); const nav = useNavigate(); const toast = useToast(); const inv = useInvalidate();
  const st = useStoreStatus(); const eq = useStoreEquipment(); const sItems = useStoreItems(); const eqm = useEq();
  const pinStatus = usePinStatus();
  const [pinOpen, setPinOpen] = useState(false);
  const [pinLater, setPinLater] = useState(() => localStorage.getItem("fs-pin-later") === "1");
  const [filter, setFilter] = useState<"all" | "todo" | "issues" | "ok">("all");
  const [outbox, setOutbox] = useState<OutboxItem[]>([]); const [draftStores, setDraftStores] = useState<Set<string>>(new Set()); const [syncing, setSyncing] = useState(false);

  // The database (RLS) already returns exactly the stores this technician may work on —
  // assigned ones, plus the whole zone when the admin enabled "zone" scope.
  const mine = useMemo(() => (st.data ?? []).filter((s) => s.active && (staff?.role === "technician" || s.assigned_tech_id === staff?.id))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]), [st.data, staff]);
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
      {pinStatus.data && !pinStatus.data.has_pin && !pinLater && (
        <div className="banner info" style={{ justifyContent: "space-between" }}>
          <span><b>{t("pinSetup")}</b> — {t("pinSetupHint")}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => { localStorage.setItem("fs-pin-later", "1"); setPinLater(true); }}>{t("later")}</button>
            <button className="btn pri" onClick={() => setPinOpen(true)}>{t("pin")}</button>
          </span>
        </div>
      )}
      {pinOpen && <PinDialog onClose={() => setPinOpen(false)} />}
      <section className="hero-card" style={{ marginBottom: 16, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <div className="gauge" style={{ ["--p" as string]: mine.length ? Math.round(((count("ok") + count("issues")) / mine.length) * 100) : 0 }}>
          <div><b className="num">{nf(count("ok") + count("issues"))}</b><span className="code">{t("of")} {nf(mine.length)}</span></div>
        </div>
        <div style={{ flex: "1 1 180px", minWidth: 0, display: "grid", gap: 10 }}>
          <div><span className="code">{t("hello")}</span><div style={{ fontSize: 22, fontWeight: 600 }}>{staff?.full_name}</div>
            <span className="code">{t("thisWeek")} · {t("doneOf")} {nf(count("ok") + count("issues"))}/{nf(mine.length)}</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="hero-chip"><i className="dot d-overdue" /><b className="num">{nf(count("overdue") + count("never"))}</b>{t("st_overdue")}</span>
            <span className="hero-chip"><i className="dot d-pending" /><b className="num">{nf(count("pending"))}</b>{t("pendingShort")}</span>
            <span className="hero-chip"><i className="dot d-issues" /><b className="num">{nf(count("issues"))}</b>{t("st_issues")}</span>
          </div>
        </div>
      </section>
      <div className="segpills" role="group" aria-label={t("status")} style={{ marginBottom: 12 }}>
        {([["all", t("allStores"), mine.length], ["todo", t("pendingShort"), count("overdue") + count("never") + count("pending")], ["issues", t("st_issues"), count("issues")], ["ok", t("st_ok"), count("ok")]] as const).map(([k, label, n]) => (
          <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label} <b className="num">{nf(n)}</b></button>
        ))}
      </div>
      {st.isLoading ? <Loading /> : st.error ? <ErrorBox error={st.error} onRetry={() => st.refetch()} /> : mine.length === 0 ? <Empty /> : (
        <div className="storelist">
          {mine.filter((s) => filter === "all" || (filter === "todo" ? ["overdue", "never", "pending"].includes(s.status) : s.status === filter)).map((s) => {
            const b = eq.data?.find((e) => e.store_code === s.store_code);
            const done = s.status === "ok" || s.status === "issues";
            const queued = outbox.some((o) => o.payload.store_code === s.store_code);
            return (
              <article key={s.store_code} className="sc glass">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div><h3 style={{ margin: 0, fontSize: 16 }}>{s.name}</h3><div className="code num">{s.store_code} · {t("lastInspection")} {df(s.last_date)}</div></div>
                  <StatusPill s={s.status} />
                </div>
                {b ? <div className="eq num">{([["p6", b.p6_qty], ["co2", b.co2_qty], ["fs", b.fs_qty], ["hc", b.hc_total]] as const).map(([c, q]) => <span key={c} title={t(`eq_${c}`)}><EqIcon code={c} size={16} />{nf(q)}</span>)}
                  {(sItems.data ?? []).filter((i) => i.store_code === s.store_code && i.qty > 0 && eqm.types.some((x) => x.code === i.type_code && x.active)).map((i) => (
                    <span key={i.type_code} title={eqm.name(i.type_code)}><EqIcon code={i.type_code} icon={eqm.icon(i.type_code)} size={16} />{eqm.types.find((x) => x.code === i.type_code)?.kind === "check" ? "✓" : nf(i.qty)}</span>))}</div>
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
