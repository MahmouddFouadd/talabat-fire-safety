import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { ErrorBox, Loading } from "../../components/ui";
import { useEquipmentTypes, useInvalidate, useSettings, useStoreEquipment, useStoreItems, useStoreStatus } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useI18n, type TKey } from "../../lib/i18n";
import { drafts, enqueue, submitPayload, type InspectionPayload, type SubmitResult } from "../../lib/offline";
import { errorCode, errorText } from "../../lib/errors";
import type { EqCode } from "../../lib/types";
import { EqIcon } from "../../components/EqIcon";

type Opt = [string, "ok" | "warn" | "bad"];
const OPTS: Record<string, Opt[]> = {
  hose: [["good", "ok"], ["damaged", "warn"], ["missing", "bad"]],
  valve: [["good", "ok"], ["stiff", "warn"], ["damaged", "warn"]],
  glass: [["good", "ok"], ["broken", "warn"], ["missing", "bad"]],
  system: [["ok", "ok"], ["fault", "bad"]],
  battery: [["good", "ok"], ["low", "warn"], ["failed", "bad"]],
  detectors: [["good", "ok"], ["dirty", "warn"], ["missing", "bad"]],
  mcp: [["good", "ok"], ["damaged", "warn"], ["missing", "bad"]],
  sounders: [["working", "ok"], ["faulty", "warn"], ["missing", "bad"]],
  running: [["running", "ok"], ["not_running", "bad"]],
  tested: [["tested", "ok"], ["not_tested", "bad"]],
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)));

export default function Inspect() {
  const { code = "" } = useParams();
  const { t, nf, lang } = useI18n();
  const { staff } = useAuth();
  const nav = useNavigate(); const inv = useInvalidate();
  const st = useStoreStatus(); const eq = useStoreEquipment(); const types = useEquipmentTypes(); const settings = useSettings();
  const store = st.data?.find((s) => s.store_code === code);
  const base = eq.data?.find((e) => e.store_code === code);
  const active = useMemo(() => new Set((types.data ?? []).filter((x) => x.active).map((x) => x.code)), [types.data]);
  const storeItems = useStoreItems();
  // custom equipment (added by admins) present at this store, in admin-defined order
  const customs = useMemo(() => (types.data ?? []).filter((x) => x.active && (x.kind === "count" || x.kind === "check"))
    .map((x) => ({ type: x, qty: storeItems.data?.find((i) => i.store_code === code && i.type_code === x.code)?.qty ?? 0 }))
    .filter((c) => c.qty > 0), [types.data, storeItems.data, code]);
  const customOf = (c: string) => customs.find((x) => x.type.code === c);
  const typeName = (c: string) => { const x = types.data?.find((y) => y.code === c); return x ? (lang === "ar" ? x.name_ar : x.name_en) : t(`eq_${c}` as TKey); };
  const steps = useMemo<string[]>(() => [...(["p6", "co2", "fs", "hc", "al", "fp"] as EqCode[]).filter((c) => active.has(c)), ...customs.map((c) => c.type.code), "rev"], [active, customs]);
  const requireRemarks = settings.data?.require_remarks_on_issue === true;
  const isAdmin = staff?.role === "admin";
  const doneThisWeek = store?.status === "ok" || store?.status === "issues";

  const [p, setP] = useState<InspectionPayload | null>(null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | "queued" | null>(null);
  const loaded = useRef(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (loaded.current || !staff || !base || !storeItems.data || !types.data) return;
    loaded.current = true;
    drafts.get(staff.id, code).then((d) => {
      if (d) { setP(d.payload); setStep(Math.min(d.step, 6)); return; }
      setP({
        client_id: uuid(), store_code: code,
        p6: { good: base.p6_qty, dmg: 0, miss: 0 }, co2: { good: base.co2_qty, dmg: 0, miss: 0 }, fs: { good: base.fs_qty, dmg: 0, miss: 0 },
        hc: { ok: base.hc_total, hose: "good", valve: "good", glass: "good" },
        al: { system: "ok", battery: "good", detectors: "good", mcp: "good", sounders: "working" },
        fp: { available: false, running: "na", tested: "na" },
        items: Object.fromEntries(customs.map((c) => [c.type.code, c.type.kind === "count" ? { good: c.qty, dmg: 0, miss: 0 } : { ok: true }])),
      });
    });
  }, [staff, base, code, storeItems.data, types.data]);

  // autosave draft on every change
  useEffect(() => { if (p && staff && !result) drafts.save({ payload: p, step, owner: staff.id, updatedAt: Date.now() }); }, [p, step]);

  if (st.isLoading || eq.isLoading || types.isLoading) return <Shell title={t("startInspection")}><Loading /></Shell>;
  if (st.error) return <Shell title={t("startInspection")}><ErrorBox error={st.error} /></Shell>;
  if (!store) return <Shell title={t("startInspection")}><div className="banner bad">{errorText(new Error("STORE_NOT_FOUND"), lang)}</div></Shell>;
  if (!base) return <Shell title={store.name}><div className="banner bad">{t("noBaseTech")}</div></Shell>;
  if (!p) return <Shell title={store.name}><Loading /></Shell>;

  const qtyOf = (k: "p6" | "co2" | "fs") => ({ p6: base.p6_qty, co2: base.co2_qty, fs: base.fs_qty })[k];
  const cur = steps[step];
  const upd = (patch: Partial<InspectionPayload>) => { setErr(""); setP({ ...p, ...patch }); };
  const sumBad = (k: "p6" | "co2" | "fs") => p[k].good + p[k].dmg + p[k].miss !== qtyOf(k);
  const item = (c: string) => p.items?.[c] ?? {};
  const setItem = (c: string, patch: Record<string, unknown>) => upd({ items: { ...(p.items ?? {}), [c]: { ...item(c), ...patch } } });
  const customBad = (c: string) => { const x = customOf(c); const v = item(c); return !!x && x.type.kind === "count" && (v.good ?? 0) + (v.dmg ?? 0) + (v.miss ?? 0) !== x.qty; };
  const hasIssue = (k: string): boolean => {
    const cu = customOf(k);
    if (cu) { const v = item(k); return cu.type.kind === "count" ? (v.dmg ?? 0) + (v.miss ?? 0) > 0 : v.ok === false; }
    return builtinIssue(k as EqCode);
  };
  const builtinIssue = (k: EqCode): boolean => {
    switch (k) {
      case "p6": case "co2": case "fs": return p[k].dmg + p[k].miss > 0;
      case "hc": return base.hc_total > 0 && (p.hc.ok < base.hc_total || p.hc.hose !== "good" || p.hc.valve !== "good" || p.hc.glass !== "good");
      case "al": return p.al.system !== "ok" || p.al.battery !== "good" || p.al.detectors !== "good" || p.al.mcp !== "good" || p.al.sounders !== "working";
      case "fp": return p.fp.available && (p.fp.running === "not_running" || p.fp.tested === "not_tested");
    }
  };
  const issues = steps.filter((s) => s !== "rev" && hasIssue(s));

  function validate(k: string): string {
    if (customOf(k)) {
      if (customBad(k)) return `${t("tallyBad")} ${nf(customOf(k)!.qty)}`;
      if (requireRemarks && hasIssue(k) && !(item(k).rmk ?? "").trim()) return t("remarksRequired");
      return "";
    }
    if (k === "p6" || k === "co2" || k === "fs") { if (sumBad(k)) return `${t("tallyBad")} ${nf(qtyOf(k))}`; }
    if (k === "fp" && p!.fp.available && (p!.fp.running === "na" || p!.fp.tested === "na")) return errorText(new Error("MISSING_FIELD"), lang);
    if (k !== "rev" && requireRemarks && hasIssue(k) && !((p![k as EqCode] as { rmk?: string }).rmk ?? "").trim()) return t("remarksRequired");
    return "";
  }

  async function submit() {
    if (submitting.current) return;
    for (const s of steps) { const e = validate(s); if (e) { setStep(steps.indexOf(s)); setErr(e); return; } }
    if (doneThisWeek && !(isAdmin && (p!.override_reason ?? "").trim())) { setErr(t("duplicateWeek")); return; }
    const payload: InspectionPayload = { ...p!, override: doneThisWeek && isAdmin ? true : undefined };
    submitting.current = true; setBusy(true); setErr("");
    try { await sendOrQueue(payload); } finally { submitting.current = false; setBusy(false); }
  }

  async function sendOrQueue(payload: InspectionPayload) {
    if (!navigator.onLine) {
      await enqueue({ payload, owner: staff!.id, queuedAt: Date.now(), attempts: 0, storeName: store!.name });
      setResult("queued"); return;
    }
    try {
      const r = await submitPayload(payload);
      await drafts.remove(staff!.id, code);
      await inv("store-status", "inspections", "issues", "dashboard", "latest-per-store");
      setResult(r);
    } catch (e) {
      // NETWORK also covers "the server may have saved it but the answer never arrived" (timeout):
      // the queued copy has the same client_id, so the retry returns the saved record instead of a duplicate.
      if (errorCode(e) === "NETWORK") {
        await enqueue({ payload, owner: staff!.id, queuedAt: Date.now(), attempts: 1, storeName: store!.name });
        setResult("queued");
      } else setErr(errorText(e, lang));
    }
  }

  if (result) {
    return (
      <Shell title={store.name}>
        <div className="panel glass" style={{ textAlign: "center", padding: "32px 16px" }}>
          <div style={{ width: 76, height: 76, margin: "0 auto 14px", borderRadius: "50%", display: "grid", placeItems: "center", background: result === "queued" ? "var(--caution)" : "var(--safe)", color: "#fff", fontSize: 34 }}>{result === "queued" ? "⏳" : "✓"}</div>
          <h2>{result === "queued" ? t("pendingSync") : t("submitted")}</h2>
          <p className="muted2">{result === "queued" ? t("queued") : `${t("inspectionCode")}: ${result.code}`}</p>
          {result !== "queued" && (result.issues.length
            ? <p><span className="pill p-warn">{nf(result.issues.length)} {t("willOpen")}</span></p>
            : <p><span className="pill p-ok">{t("noIssuesFound")}</span></p>)}
          <button className="btn pri lg" onClick={() => nav("/tech")}>{t("backToStores")}</button>
        </div>
      </Shell>
    );
  }

  const Stepper = ({ k, f, max }: { k: "p6" | "co2" | "fs"; f: "good" | "dmg" | "miss"; max: number }) => (
    <div className="stepper">
      <button type="button" aria-label="−" onClick={() => upd({ [k]: { ...p[k], [f]: Math.max(0, p[k][f] - 1) } } as Partial<InspectionPayload>)}>−</button>
      <input className="num" inputMode="numeric" aria-label={t(f)} value={p[k][f]} onChange={(e) => { const v = Math.min(max, Math.max(0, Math.trunc(Number(e.target.value.replace(/[^\d]/g, "")) || 0))); upd({ [k]: { ...p[k], [f]: v } } as Partial<InspectionPayload>); }} />
      <button type="button" aria-label="+" onClick={() => upd({ [k]: { ...p[k], [f]: Math.min(max, p[k][f] + 1) } } as Partial<InspectionPayload>)}>+</button>
    </div>
  );
  const Chips = ({ group, field, label, disabled }: { group: "hc" | "al" | "fp"; field: string; label: string; disabled?: boolean }) => (
    <>
      <div className="q">{label}</div>
      <div className="chips" role="radiogroup" aria-label={label}>
        {OPTS[field].map(([v, c]) => (
          <button key={v} type="button" role="radio" aria-checked={(p[group] as Record<string, unknown>)[field] === v} aria-pressed={(p[group] as Record<string, unknown>)[field] === v}
            className={`chip c-${c}`} disabled={disabled} onClick={() => upd({ [group]: { ...p[group], [field]: v } } as Partial<InspectionPayload>)}>{t(`v_${v}` as TKey)}</button>
        ))}
      </div>
    </>
  );
  const Remarks = ({ k }: { k: EqCode }) => (
    <>
      <div className="q">{t("remarks")}{requireRemarks && hasIssue(k) ? " *" : ""}</div>
      <textarea className="input" maxLength={1000} value={p[k].rmk ?? ""} onChange={(e) => upd({ [k]: { ...p[k], rmk: e.target.value } } as Partial<InspectionPayload>)} />
    </>
  );

  let body: JSX.Element;
  if (cur === "p6" || cur === "co2" || cur === "fs") {
    const q = qtyOf(cur);
    body = (<>
      <div className="base"><span>{t("installed")}</span><b className="num">{nf(q)}</b></div>
      {(["good", "dmg", "miss"] as const).map((f) => (
        <div className="counter" key={f}><label><i className={`dot ${f === "good" ? "d-ok" : f === "dmg" ? "d-warn" : "d-bad"}`} />{t(f)}</label>{Stepper({ k: cur, f: f, max: q })}</div>
      ))}
      <div className={`tally ${sumBad(cur) ? "bad" : "ok"}`} aria-live="polite">
        {sumBad(cur) ? `${t("tallyBad")} ${nf(q)} — ${t("now")} ${nf(p[cur].good + p[cur].dmg + p[cur].miss)}` : `✓ ${t("tallyOk")} (${nf(q)})`}
      </div>
      {Remarks({ k: cur })}
    </>);
  } else if (cur === "hc") {
    body = (<>
      <div className="base"><span>{t("installed")}</span><b className="num">{nf(base.hc_total)}</b></div>
      <div className="counter"><label><i className="dot d-ok" />{t("hcOk")}</label>
        <div className="stepper">
          <button type="button" aria-label="−" onClick={() => upd({ hc: { ...p.hc, ok: Math.max(0, p.hc.ok - 1) } })}>−</button>
          <input className="num" inputMode="numeric" aria-label={t("hcOk")} value={p.hc.ok} onChange={(e) => upd({ hc: { ...p.hc, ok: Math.min(base.hc_total, Math.max(0, Math.trunc(Number(e.target.value.replace(/[^\d]/g, "")) || 0))) } })} />
          <button type="button" aria-label="+" onClick={() => upd({ hc: { ...p.hc, ok: Math.min(base.hc_total, p.hc.ok + 1) } })}>+</button>
        </div>
      </div>
      {Chips({ group: "hc", field: "hose", label: t("hose") })}{Chips({ group: "hc", field: "valve", label: t("valve") })}{Chips({ group: "hc", field: "glass", label: t("glass") })}
      {Remarks({ k: "hc" })}
    </>);
  } else if (cur === "al") {
    body = (<>
      {Chips({ group: "al", field: "system", label: t("alSystem") })}{Chips({ group: "al", field: "battery", label: t("battery") })}
      {Chips({ group: "al", field: "detectors", label: t("detectors") })}{Chips({ group: "al", field: "mcp", label: t("mcp") })}{Chips({ group: "al", field: "sounders", label: t("sounders") })}
      {Remarks({ k: "al" })}
    </>);
  } else if (customOf(cur)) {
    const cu = customOf(cur)!; const v = item(cur);
    body = cu.type.kind === "count" ? (<>
      <div className="base"><span>{t("installed")}</span><b className="num">{nf(cu.qty)}</b></div>
      {(["good", "dmg", "miss"] as const).map((f) => (
        <div className="counter" key={f}><label><i className={`dot ${f === "good" ? "d-ok" : f === "dmg" ? "d-warn" : "d-bad"}`} />{t(f)}</label>
          <div className="stepper">
            <button type="button" aria-label="−" onClick={() => setItem(cur, { [f]: Math.max(0, (v[f] ?? 0) - 1) })}>−</button>
            <input className="num" inputMode="numeric" aria-label={t(f)} value={v[f] ?? 0} onChange={(e) => setItem(cur, { [f]: Math.min(cu.qty, Math.max(0, Math.trunc(Number(e.target.value.replace(/[^\d]/g, "")) || 0))) })} />
            <button type="button" aria-label="+" onClick={() => setItem(cur, { [f]: Math.min(cu.qty, (v[f] ?? 0) + 1) })}>+</button>
          </div>
        </div>
      ))}
      <div className={`tally ${customBad(cur) ? "bad" : "ok"}`} aria-live="polite">
        {customBad(cur) ? `${t("tallyBad")} ${nf(cu.qty)} — ${t("now")} ${nf((v.good ?? 0) + (v.dmg ?? 0) + (v.miss ?? 0))}` : `✓ ${t("tallyOk")} (${nf(cu.qty)})`}
      </div>
    </>) : (<>
      <div className="q">{typeName(cur)}</div>
      <div className="chips" role="radiogroup">
        <button type="button" role="radio" aria-checked={v.ok !== false} aria-pressed={v.ok !== false} className="chip c-ok" onClick={() => setItem(cur, { ok: true })}>{t("isOk")}</button>
        <button type="button" role="radio" aria-checked={v.ok === false} aria-pressed={v.ok === false} className="chip c-bad" onClick={() => setItem(cur, { ok: false })}>{t("hasProblem")}</button>
      </div>
    </>);
    body = (<>{body}
      <div className="q">{t("remarks")}{requireRemarks && hasIssue(cur) ? " *" : ""}</div>
      <textarea className="input" maxLength={1000} value={v.rmk ?? ""} onChange={(e) => setItem(cur, { rmk: e.target.value })} />
    </>);
  } else if (cur === "fp") {
    body = (<>
      <div className="q">{t("fpHas")}</div>
      <div className="chips" role="radiogroup">
        <button type="button" role="radio" aria-checked={p.fp.available} aria-pressed={p.fp.available} className="chip c-ok" onClick={() => upd({ fp: { ...p.fp, available: true, running: p.fp.running === "na" ? "running" : p.fp.running, tested: p.fp.tested === "na" ? "tested" : p.fp.tested } })}>{t("yes")}</button>
        <button type="button" role="radio" aria-checked={!p.fp.available} aria-pressed={!p.fp.available} className="chip c-warn" onClick={() => upd({ fp: { ...p.fp, available: false, running: "na", tested: "na" } })}>{t("no")}</button>
      </div>
      {Chips({ group: "fp", field: "running", label: t("fpRunning"), disabled: !p.fp.available })}
      {Chips({ group: "fp", field: "tested", label: t("fpTested"), disabled: !p.fp.available })}
      {Remarks({ k: "fp" })}
    </>);
  } else {
    body = (<>
      <div className="rev">
        {steps.filter((s) => s !== "rev").map((s) => (
          <button key={s} type="button" className="r" onClick={() => setStep(steps.indexOf(s))} style={{ textAlign: "start" }}>
            <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><EqIcon code={s} icon={customOf(s)?.type.icon} size={20} />{typeName(s)}</span>
            <span className={`pill ${hasIssue(s) ? "p-warn" : "p-ok"}`}>{s === "p6" || s === "co2" || s === "fs" ? `${nf(p[s].good)}/${nf(qtyOf(s))}` : s === "hc" ? `${nf(p.hc.ok)}/${nf(base.hc_total)}` : customOf(s)?.type.kind === "count" ? `${nf(item(s).good ?? 0)}/${nf(customOf(s)!.qty)}` : t(hasIssue(s) ? "ov_warn" : "ov_ok")}</span>
          </button>
        ))}
      </div>
      <div className="q" style={{ marginTop: 18 }}>{issues.length ? t("willOpen") : t("noIssuesFound")}</div>
      {issues.map((s) => <div key={s} className="banner warn" style={{ marginBottom: 6 }}>{typeName(s)}</div>)}
      <div className="q">{t("generalRemarks")}</div>
      <textarea className="input" maxLength={2000} value={p.general_remarks ?? ""} onChange={(e) => upd({ general_remarks: e.target.value })} />
      {doneThisWeek && (isAdmin
        ? <><div className="q">{t("overrideReason")}</div><input className="input" maxLength={300} value={p.override_reason ?? ""} onChange={(e) => upd({ override_reason: e.target.value })} /></>
        : <div className="banner bad" style={{ marginTop: 12 }}>{t("duplicateWeek")}</div>)}
    </>);
  }

  const stepName = (s: string) => (s === "rev" ? t("review") : typeName(s));
  return (
    <Shell title={store.name}>
      {!navigator.onLine && <div className="banner warn">{t("offline")}</div>}
      <div className="wiz">
        <ol className="steps glass">
          {steps.map((s, i) => (
            <li key={s} className={i < step ? "done" : i === step ? "cur" : ""}>
              <span className="n num">{i < step ? "✓" : s === "rev" ? nf(i + 1) : <EqIcon code={s} icon={customOf(s)?.type.icon} size={17} />}</span>{stepName(s)}
            </li>
          ))}
        </ol>
        <section className="panel glass">
          <div className="mprog" aria-hidden="true">{steps.map((s, i) => <i key={s} className={i < step ? "done" : i === step ? "cur" : ""} />)}</div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 12 }}>{cur !== "rev" && <span className="eqicon-badge" style={{ background: "var(--hero)" }}><EqIcon code={cur} icon={customOf(cur)?.type.icon} size={24} /></span>}{stepName(cur)}</h2>
          <p className="muted num" style={{ margin: "0 0 16px" }}>{store.name} · {store.store_code} · {nf(step + 1)}/{nf(steps.length)}</p>
          {body}
          {err && <div className="banner bad" role="alert" style={{ marginTop: 14 }}>{err}</div>}
          <div className="fnav">
            {step > 0 && <button type="button" className="btn lg" onClick={() => { setErr(""); setStep(step - 1); window.scrollTo(0, 0); }}>{t("back")}</button>}
            {cur === "rev"
              ? <button type="button" className="btn pri lg" disabled={busy} onClick={submit}>{busy ? t("submitting") : t("submit")}</button>
              : <button type="button" className="btn pri lg" onClick={() => { const e = validate(cur); if (e) { setErr(e); return; } setStep(step + 1); window.scrollTo(0, 0); }}>{t("next")}</button>}
          </div>
          <p className="code" style={{ textAlign: "center", marginTop: 10 }}>{t("draftSaved")}</p>
        </section>
      </div>
    </Shell>
  );
}
