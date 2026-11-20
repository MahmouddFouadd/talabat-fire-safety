import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { latinDigits } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Field, Modal, useErrorToast, useToast } from "./ui";

export const usePinStatus = () => useQuery({
  queryKey: ["my-pin"],
  queryFn: async () => { const { data, error } = await supabase.rpc("my_pin_status"); if (error) throw error; return data as { has_pin: boolean; locked: boolean }; },
});

const weak = (p: string) => !/^[0-9]{4,6}$/.test(p) || /^(.)\1+$/.test(p) || "0123456789012345".includes(p) || "9876543210987654".includes(p);

/** Set / change / remove the signed-in user's own PIN. With staffId+name it is the admin version. */
export function PinDialog({ onClose, staffId, name }: { onClose: () => void; staffId?: string; name?: string }) {
  const { t } = useI18n(); const toast = useToast(); const toastErr = useErrorToast(); const qc = useQueryClient();
  const status = usePinStatus();
  const [a, setA] = useState(""); const [b, setB] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const digits = (v: string) => latinDigits(v).replace(/[^0-9]/g, "").slice(0, 6);

  async function save() {
    if (weak(a)) return setErr(t("pinHint"));
    if (a !== b) return setErr(t("pinMismatch"));
    setBusy(true);
    const { error } = staffId ? await supabase.rpc("admin_set_pin", { p_staff: staffId, p_pin: a }) : await supabase.rpc("set_my_pin", { p_pin: a });
    setBusy(false);
    if (error) return toastErr(error);
    await qc.invalidateQueries({ queryKey: ["my-pin"] }); await qc.invalidateQueries({ queryKey: ["pin-list"] });
    toast(t(staffId ? "saved" : "pinSaved"), "ok"); onClose();
  }
  async function remove() {
    setBusy(true);
    const { error } = staffId ? await supabase.rpc("admin_set_pin", { p_staff: staffId, p_pin: null }) : await supabase.rpc("clear_my_pin");
    setBusy(false);
    if (error) return toastErr(error);
    await qc.invalidateQueries({ queryKey: ["my-pin"] }); await qc.invalidateQueries({ queryKey: ["pin-list"] });
    toast(t("saved"), "ok"); onClose();
  }
  const pinInput = (v: string, set: (s: string) => void) => (
    <input className="input num" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} dir="ltr" autoComplete="new-password"
      style={{ fontSize: 24, letterSpacing: 10, textAlign: "center" }} value={v} onChange={(e) => { setErr(""); set(digits(e.target.value)); }} />
  );
  return (
    <Modal title={staffId ? `${t("setPinFor")} ${name}` : t("pinTitle")} onClose={onClose}
      footer={<>
        {(staffId || status.data?.has_pin) && <button className="btn danger" disabled={busy} onClick={remove}>{t("pinRemove")}</button>}
        <button className="btn" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri" disabled={busy || a.length < 4} onClick={save}>{t("save")}</button>
      </>}>
      {!staffId && <div className={`banner ${status.data?.has_pin ? "info" : "warn"}`}>{status.data?.has_pin ? t("pinActive") : t("pinNone")}</div>}
      <p className="muted" style={{ marginTop: 0 }}>{t("pinHint")}</p>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label={t("pinLabel")}>{pinInput(a, setA)}</Field>
        <Field label={t("pinConfirm")}>{pinInput(b, setB)}</Field>
        {err && <div className="banner bad" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}
