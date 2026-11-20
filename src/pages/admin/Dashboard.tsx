import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { ErrorBox, Kpi, Loading } from "../../components/ui";
import { useDashboard, useStoreStatus, useZones } from "../../lib/api";
import { useI18n, type TKey } from "../../lib/i18n";
import type { StoreStatus, StoreStatusRow, Zone } from "../../lib/types";

const ORDER: StoreStatus[] = ["overdue", "never", "pending", "issues", "ok"];

export default function Dashboard() {
  const { t, nf, df, lang } = useI18n();
  const nav = useNavigate();
  const [zone, setZone] = useState<string>("");
  const zones = useZones();
  const d = useDashboard(zone || null);
  const stores = useStoreStatus();
  const zn = (z: { name_ar: string; name_en: string }) => (lang === "ar" ? z.name_ar : z.name_en);

  const actions = (
    <select className="input" style={{ width: "auto", minHeight: 40 }} value={zone} onChange={(e) => setZone(e.target.value)} aria-label={t("zone")}>
      <option value="">{t("allZones")}</option>
      {zones.data?.map((z) => <option key={z.id} value={z.id}>{zn(z)}</option>)}
    </select>
  );

  if (d.isLoading) return <Shell title={t("dashboard")} actions={actions}><Loading /></Shell>;
  if (d.error || !d.data) return <Shell title={t("dashboard")} actions={actions}><ErrorBox error={d.error} onRetry={() => d.refetch()} /></Shell>;
  const s = d.data;
  const bs = (k: StoreStatus) => s.by_status[k] ?? 0;
  const done = bs("ok") + bs("issues");
  const pct = s.stores ? Math.round((done / s.stores) * 100) : 0;
  const maxTrend = Math.max(1, ...s.trend.map((w) => w.inspections));
  const pctFmt = new Intl.NumberFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { style: "percent" });
  const tiles = (stores.data ?? []).filter((x) => x.active && (!zone || x.zone_id === zone));

  return (
    <Shell title={t("dashboard")} actions={actions}>
      <p className="muted" style={{ marginTop: -10, marginBottom: 16 }}>{t("weekOf")} {df(s.week_start)}</p>
      <section className="grid hero">
        <div className="hero-card" style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div className="gauge" style={{ ["--p" as string]: pct }}><div><b className="num">{pctFmt.format(pct / 100)}</b><span className="code">{t("completion")}</span></div></div>
          <div>
            <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{nf(done)} {t("of")} {nf(s.stores)}</div>
            <p className="muted2" style={{ margin: "4px 0" }}>{t("doneThisWeek")}</p>
            {s.no_base > 0 && <button className="hero-chip" onClick={() => nav("/admin/equipment?missing=1")}>{nf(s.no_base)} {t("noBase")}</button>}
          </div>
        </div>
        <div className="grid g2">
          <Kpi dot="issues" label={t("st_issues")} value={bs("issues")} hint={t("doneThisWeek")} onClick={() => nav("/admin/stores?status=issues")} />
          <Kpi dot="overdue" label={t("st_overdue")} value={bs("overdue")} hint={t("overdueHint")} onClick={() => nav("/admin/stores?status=overdue")} />
          <Kpi dot="pending" label={t("st_pending")} value={bs("pending") + bs("never")} hint={`${nf(bs("never"))} ${t("st_never")}`} onClick={() => nav("/admin/stores?status=pending")} />
          <Kpi dot="bad" label={t("openIssues")} value={s.open_issues} hint={`${nf(s.issues_by_priority.critical ?? 0)} ${t("criticalIssues")}`} onClick={() => nav("/admin/issues")} />
        </div>
      </section>

      <section className="grid g2" style={{ marginTop: 16 }}>
        <div className="card glass bars">
          <h3 className="ttl">{t("byZone")}</h3>
          {s.zones.map((z) => (
            <div className="row" key={z.id}>
              <span>{zn(z)}</span>
              <div className="track"><i style={{ width: `${z.stores ? Math.max(2, (z.done / z.stores) * 100) : 0}%` }} /></div>
              <span className="num" style={{ textAlign: "end" }}>{nf(z.done)}/{nf(z.stores)}</span>
            </div>
          ))}
        </div>
        <div className="card glass">
          <h3 className="ttl">{t("trend")}<small><i className="dot d-warn" /> {t("withIssues")}</small></h3>
          <div className="trend">
            {s.trend.map((w) => (
              <div className="b" key={w.week_start} title={`${df(w.week_start)} — ${w.inspections}`}>
                <b className="num" style={{ color: "var(--ink)" }}>{w.inspections ? nf(w.inspections) : ""}</b>
                <div className="stack" style={{ height: `${(w.inspections / maxTrend) * 100}%` }}>
                  <i className="w" style={{ height: `${w.inspections ? (w.with_issues / w.inspections) * 100 : 0}%` }} />
                  <i style={{ flex: 1 }} />
                </div>
                <span className="num">{new Date(w.week_start + "T00:00:00").toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "numeric" })}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid g2" style={{ marginTop: 16 }}>
        <div className="card glass bars">
          <h3 className="ttl">{t("byTech")}</h3>
          {s.techs.length === 0 && <p className="muted">{t("empty")}</p>}
          {s.techs.map((x) => (
            <div className="row" key={x.id}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</span>
              <div className="track"><i style={{ width: `${x.stores ? Math.max(2, (x.done / x.stores) * 100) : 0}%` }} /></div>
              <span className="num" style={{ textAlign: "end" }}>{nf(x.done)}/{nf(x.stores)}</span>
            </div>
          ))}
        </div>
        <div className="card glass">
          <h3 className="ttl">{t("byEquipment")}</h3>
          <div className="rev">
            {(["p6", "co2", "fs", "hc", "al", "fp"] as const).map((k) => (
              <div className="r" key={k}><span>{t(`eq_${k}` as TKey)}</span><b className="num">{nf(s.issues_by_equipment[k] ?? 0)}</b></div>
            ))}
          </div>
        </div>
      </section>

      <StoreMap stores={tiles} zones={zones.data ?? []} />
    </Shell>
  );
}

/* Store map: one compact dot per store, grouped by zone, plus a filter that lists the stores behind a colour. */
function StoreMap({ stores, zones }: { stores: StoreStatusRow[]; zones: Zone[] }) {
  const { t, nf, df, lang } = useI18n();
  const nav = useNavigate();
  const [f, setF] = useState<StoreStatus | "">("");
  const count = (k: StoreStatus) => stores.filter((x) => x.status === k).length;
  const groups = zones.map((z) => ({ z, list: stores.filter((x) => x.zone_id === z.id).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)) })).filter((g) => g.list.length);
  const picked = f ? stores.filter((x) => x.status === f) : [];
  return (
    <section className="card glass" style={{ marginTop: 16 }}>
      <h3 className="ttl">{t("storeMap")}<small>{nf(stores.length)} {t("stores")}</small></h3>
      <div className="segpills" role="group" aria-label={t("status")} style={{ marginBottom: 14 }}>
        <button aria-pressed={f === ""} onClick={() => setF("")}>{t("allStores")} <b className="num">{nf(stores.length)}</b></button>
        {ORDER.map((k) => (
          <button key={k} aria-pressed={f === k} onClick={() => setF(f === k ? "" : k)}><i className={`dot d-${k}`} />{t(`st_${k}` as TKey)} <b className="num">{nf(count(k))}</b></button>
        ))}
      </div>
      <div className="zonemap">
        {groups.map(({ z, list }) => {
          const done = list.filter((x) => x.status === "ok" || x.status === "issues").length;
          return (
            <div key={z.id} className="zone-block">
              <div className="zone-head"><b>{lang === "ar" ? z.name_ar : z.name_en}</b><span className="code num">{nf(done)}/{nf(list.length)}</span></div>
              <div className="dots">
                {list.map((x) => (
                  <button key={x.store_code} className={`sq s-${x.status} ${f && f !== x.status ? "dim" : ""}`} title={`${x.name} · ${x.store_code} · ${t(`st_${x.status}` as TKey)}`}
                    aria-label={`${x.name} ${t(`st_${x.status}` as TKey)}`} onClick={() => nav(`/admin/stores?q=${encodeURIComponent(x.store_code)}`)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {f && (
        <div className="storechips">
          {picked.length === 0 && <p className="muted">{t("empty")}</p>}
          {picked.map((x) => (
            <button key={x.store_code} className="storechip" onClick={() => nav(`/admin/stores?q=${encodeURIComponent(x.store_code)}`)}>
              <i className={`dot d-${x.status}`} />
              <span className="nm">{x.name}</span>
              <span className="code num">{x.store_code}{x.last_date ? ` · ${df(x.last_date)}` : ""}</span>
            </button>
          ))}
        </div>
      )}
      <div className="legend" style={{ marginTop: 12, marginBottom: 0 }}>{ORDER.map((k) => <span key={k}><i className={`sq s-${k} mini`} />{t(`st_${k}` as TKey)}</span>)}</div>
    </section>
  );
}
