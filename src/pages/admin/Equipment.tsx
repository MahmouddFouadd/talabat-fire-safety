import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Loading, useErrorToast, useToast } from "../../components/ui";
import { EqIcon, useEq } from "../../components/EqIcon";
import { useInvalidate, useStoreEquipment, useStoreItems, useStores, useZones } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { useI18n } from "../../lib/i18n";

/* One grid for every store × every equipment type.
   Built-in quantities live in store_equipment, custom ones in store_items (0 = not at this store). */
const BUILT = [["p6", "p6_qty"], ["co2", "co2_qty"], ["fs", "fs_qty"], ["hc", "hc_total"]] as const;
type Row = Record<string, number>;

export default function Equipment() {
  const { t, nf, df, lang } = useI18n();
  const [sp] = useSearchParams();
  const stores = useStores(); const eq = useStoreEquipment(); const items = useStoreItems(); const zones = useZones(); const { types, name } = useEq();
  const inv = useInvalidate(); const toast = useToast(); const toastErr = useErrorToast();
  const [q, setQ] = useState(""); const [zone, setZone] = useState(""); const [missing, setMissing] = useState(sp.get("missing") === "1");
  const [dirty, setDirty] = useState<Record<string, Row>>({}); const [busy, setBusy] = useState(false);
  const custom = types.filter((x) => (x.kind === "count" || x.kind === "check") && x.active);
  const cols = [...BUILT.map(([code]) => ({ code, icon: code, check: false })), ...custom.map((c) => ({ code: c.code, icon: c.icon ?? "box", check: c.kind === "check" }))];
  const [bulk, setBulk] = useState({ code: "", qty: 1 });

  const rows = useMemo(() => (stores.data ?? []).filter((s) => s.active && (!zone || (zone === "none" ? !s.zone_id : s.zone_id === zone))
    && (!q || `${s.name} ${s.store_code}`.toLowerCase().includes(q.toLowerCase()))
    && (!missing || !eq.data?.some((e) => e.store_code === s.store_code))), [stores.data, eq.data, q, zone, missing]);

  const saved = (code: string): Row => {
    const b = eq.data?.find((e) => e.store_code === code);
    const r: Row = { p6: b?.p6_qty ?? 0, co2: b?.co2_qty ?? 0, fs: b?.fs_qty ?? 0, hc: b?.hc_total ?? 0 };
    custom.forEach((c) => { r[c.code] = items.data?.find((i) => i.store_code === code && i.type_code === c.code)?.qty ?? 0; });
    return r;
  };
  const current = (code: string): Row => ({ ...saved(code), ...(dirty[code] ?? {}) });
  const invalid = (v: number) => !Number.isInteger(v) || v < 0 || v > 9999;
  const dirtyCount = Object.keys(dirty).length;
  const hasInvalid = Object.values(dirty).some((r) => Object.values(r).some(invalid));
  const setVal = (store: string, col: string, v: number) => setDirty((d) => ({ ...d, [store]: { ...(d[store] ?? {}), [col]: v } }));

  function applyBulk() {
    if (!bulk.code || invalid(bulk.qty)) return;
    setDirty((d) => { const n = { ...d }; rows.forEach((s) => { n[s.store_code] = { ...(n[s.store_code] ?? {}), [bulk.code]: bulk.qty }; }); return n; });
  }

  async function saveAll() {
    if (hasInvalid) return;
    setBusy(true);
    try {
      const baseRows = Object.entries(dirty).filter(([, r]) => BUILT.some(([c]) => c in r)).map(([store_code]) => {
        const r = current(store_code); return { store_code, p6_qty: r.p6, co2_qty: r.co2, fs_qty: r.fs, hc_total: r.hc };
      });
      if (baseRows.length) { const { error } = await supabase.from("store_equipment").upsert(baseRows); if (error) throw error; }
      const up: { store_code: string; type_code: string; qty: number }[] = []; const del: [string, string][] = [];
      Object.entries(dirty).forEach(([store_code, r]) => custom.forEach((c) => {
        if (!(c.code in r)) return;
        if (r[c.code] > 0) up.push({ store_code, type_code: c.code, qty: r[c.code] }); else del.push([store_code, c.code]);
      }));
      if (up.length) { const { error } = await supabase.from("store_items").upsert(up); if (error) throw error; }
      for (const [s, c] of del) { const { error } = await supabase.from("store_items").delete().eq("store_code", s).eq("type_code", c); if (error) throw error; }
      await inv("store-equipment", "store-items", "store-status", "dashboard");
      toast(`${t("saved")} (${nf(dirtyCount)})`, "ok"); setDirty({});
    } catch (e) { toastErr(e); }
    setBusy(false);
  }

  return (
    <Shell title={t("equipment")} actions={<button className="btn pri" disabled={!dirtyCount || hasInvalid || busy} onClick={saveAll}>{t("save")}{dirtyCount ? ` (${nf(dirtyCount)})` : ""}</button>}>
      <p className="muted" style={{ marginTop: -8 }}>{t("eqHint")}</p>
      <div className="filters">
        <input className="input" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search")} />
        <select className="input" value={zone} onChange={(e) => setZone(e.target.value)} aria-label={t("zone")}>
          <option value="">{t("allZones")}</option>{zones.data?.map((z) => <option key={z.id} value={z.id}>{lang === "ar" ? z.name_ar : z.name_en}</option>)}
          <option value="none">{t("noZone")}</option>
        </select>
        <label className="check"><input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />{t("missingBaseOnly")}</label>
      </div>
      <div className="card glass bulkbar">
        <select className="input" value={bulk.code} onChange={(e) => setBulk({ ...bulk, code: e.target.value })} aria-label={t("bulkType")}>
          <option value="">{t("bulkType")}…</option>{cols.map((c) => <option key={c.code} value={c.code}>{name(c.code)}</option>)}
        </select>
        <input className="input num" type="number" min={0} max={9999} value={bulk.qty} onChange={(e) => setBulk({ ...bulk, qty: Math.trunc(Number(e.target.value)) })} aria-label={t("bulkQty")} style={{ width: 110, flex: "none" }} />
        <button className="btn" disabled={!bulk.code || !rows.length} onClick={applyBulk}>{t("bulkApply")} ({nf(rows.length)})</button>
      </div>
      {stores.isLoading || eq.isLoading ? <Loading /> : stores.error ? <ErrorBox error={stores.error} /> : rows.length === 0 ? <Empty /> : (
        <div className="card glass" style={{ padding: "6px 16px" }}>
          <div className="tw">
            <table className="t" style={{ minWidth: 300 + cols.length * 96 }}>
              <thead><tr><th>{t("store")}</th>{cols.map((c) => <th key={c.code} title={name(c.code)} style={{ textAlign: "center" }}><span className="th-eq"><EqIcon code={c.code} icon={c.icon} size={18} /><span>{name(c.code)}</span></span></th>)}<th>{t("date")}</th></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const r = current(s.store_code); const has = eq.data?.find((e) => e.store_code === s.store_code);
                  return (
                    <tr key={s.store_code} style={dirty[s.store_code] ? { background: "rgba(255,90,0,.06)" } : undefined}>
                      <td><b>{s.name}</b><div className="code num">{s.store_code}{!has && <span style={{ color: "var(--alarm)" }}> · {t("noBase")}</span>}</div></td>
                      {cols.map((c) => (
                        <td key={c.code} style={{ textAlign: "center" }}>
                          {c.check
                            ? <input type="checkbox" style={{ width: 22, height: 22, accentColor: "var(--ember)" }} checked={r[c.code] > 0} onChange={(e) => setVal(s.store_code, c.code, e.target.checked ? 1 : 0)} aria-label={`${s.store_code} ${name(c.code)}`} />
                            : <input className="input num" style={{ width: 76, minHeight: 40, textAlign: "center", borderColor: invalid(r[c.code]) ? "var(--alarm)" : undefined }}
                                type="number" inputMode="numeric" min={0} max={9999} value={Number.isNaN(r[c.code]) ? "" : r[c.code]}
                                aria-label={`${s.store_code} ${name(c.code)}`} onChange={(e) => setVal(s.store_code, c.code, e.target.value === "" ? NaN : Number(e.target.value))} />}
                        </td>
                      ))}
                      <td className="code">{dirty[s.store_code] ? t("changed") : has ? df(has.updated_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}
