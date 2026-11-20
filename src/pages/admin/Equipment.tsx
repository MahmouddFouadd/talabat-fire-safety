import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Loading, useErrorToast, useToast } from "../../components/ui";
import { useSaveEquipment, useStoreEquipment, useStores, useZones } from "../../lib/api";
import { useI18n, type TKey } from "../../lib/i18n";

type Row = { p6_qty: number; co2_qty: number; fs_qty: number; hc_total: number };
const KEYS = ["p6_qty", "co2_qty", "fs_qty", "hc_total"] as const;

export default function Equipment() {
  const { t, nf, df, lang } = useI18n();
  const [sp] = useSearchParams();
  const stores = useStores(); const eq = useStoreEquipment(); const zones = useZones(); const save = useSaveEquipment();
  const toast = useToast(); const toastErr = useErrorToast();
  const [q, setQ] = useState(""); const [zone, setZone] = useState(""); const [missing, setMissing] = useState(sp.get("missing") === "1");
  const [dirty, setDirty] = useState<Record<string, Row>>({});

  const rows = useMemo(() => (stores.data ?? []).filter((s) => s.active && (!zone || s.zone_id === zone)
    && (!q || `${s.name} ${s.store_code}`.toLowerCase().includes(q.toLowerCase()))
    && (!missing || !eq.data?.some((e) => e.store_code === s.store_code))), [stores.data, eq.data, q, zone, missing]);

  const current = (code: string): Row => dirty[code] ?? eq.data?.find((e) => e.store_code === code) ?? { p6_qty: 0, co2_qty: 0, fs_qty: 0, hc_total: 0 };
  const invalid = (v: number) => !Number.isInteger(v) || v < 0 || v > 9999;
  const dirtyCount = Object.keys(dirty).length;
  const hasInvalid = Object.values(dirty).some((r) => KEYS.some((k) => invalid(r[k])));

  function setVal(code: string, k: (typeof KEYS)[number], v: string) {
    setDirty((d) => ({ ...d, [code]: { ...current(code), [k]: v === "" ? NaN : Number(v) } }));
  }
  function saveAll() {
    if (hasInvalid) return;
    save.mutate(Object.entries(dirty).map(([store_code, r]) => ({ store_code, ...r })), {
      onSuccess: () => { toast(`${t("saved")} (${nf(dirtyCount)})`, "ok"); setDirty({}); }, onError: toastErr,
    });
  }

  return (
    <Shell title={t("equipment")} actions={<button className="btn pri" disabled={!dirtyCount || hasInvalid || save.isPending} onClick={saveAll}>{t("save")}{dirtyCount ? ` (${nf(dirtyCount)})` : ""}</button>}>
      <p className="muted" style={{ marginTop: -8 }}>{t("eqHint")}</p>
      <div className="filters">
        <input className="input" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search")} />
        <select className="input" value={zone} onChange={(e) => setZone(e.target.value)} aria-label={t("zone")}>
          <option value="">{t("allZones")}</option>{zones.data?.map((z) => <option key={z.id} value={z.id}>{lang === "ar" ? z.name_ar : z.name_en}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />{t("missingBaseOnly")}</label>
      </div>
      {stores.isLoading || eq.isLoading ? <Loading /> : stores.error ? <ErrorBox error={stores.error} /> : rows.length === 0 ? <Empty /> : (
        <div className="card glass" style={{ padding: "6px 16px" }}>
          <div className="tw">
            <table className="t" style={{ minWidth: 640 }}>
              <thead><tr><th>{t("store")}</th>{KEYS.map((k) => <th key={k}>{t(`eq_${k.split("_")[0]}` as TKey)}</th>)}<th>{t("date")}</th></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const r = current(s.store_code); const has = eq.data?.find((e) => e.store_code === s.store_code);
                  return (
                    <tr key={s.store_code} style={dirty[s.store_code] ? { background: "rgba(244,91,0,.06)" } : undefined}>
                      <td><b>{s.name}</b><div className="code num">{s.store_code}{!has && <span style={{ color: "var(--alarm)" }}> · {t("noBase")}</span>}</div></td>
                      {KEYS.map((k) => (
                        <td key={k}><input className="input num" style={{ width: 84, minHeight: 40, borderColor: invalid(r[k]) ? "var(--alarm)" : undefined }}
                          type="number" inputMode="numeric" min={0} max={9999} value={Number.isNaN(r[k]) ? "" : r[k]}
                          aria-label={`${s.store_code} ${t(`eq_${k.split("_")[0]}` as TKey)}`} onChange={(e) => setVal(s.store_code, k, e.target.value)} /></td>
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
