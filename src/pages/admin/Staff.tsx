import { useState } from "react";
import { Shell } from "../../components/Shell";
import { Empty, ErrorBox, Field, Loading, Modal, useConfirm, useErrorToast, useToast } from "../../components/ui";
import { Icon } from "../../components/icons";
import { adminUsers, useInvalidate, useStaff, useStoreStatus, useZones } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";
import { strong } from "../ChangePassword";
import { PinDialog } from "../../components/PinDialog";
import { useQuery } from "@tanstack/react-query";
import type { Role, Staff as StaffT } from "../../lib/types";

export default function Staff() {
  const { t, nf, lang } = useI18n();
  const staff = useStaff(); const zones = useZones(); const stores = useStoreStatus(); const { staff: me } = useAuth();
  const inv = useInvalidate(); const toast = useToast(); const toastErr = useErrorToast(); const { ask, node } = useConfirm();
  const [edit, setEdit] = useState<StaffT | "new" | null>(null);
  const [login, setLogin] = useState<{ s: StaffT; mode: "create" | "reset" } | null>(null);
  const [pinFor, setPinFor] = useState<StaffT | null>(null);
  const pins = useQuery({ queryKey: ["pin-list"], queryFn: async () => { const { data, error } = await supabase.rpc("admin_pin_list"); if (error) throw error; return new Set((data as string[]) ?? []); } });
  const zoneName = (id: string | null) => { const z = zones.data?.find((x) => x.id === id); return z ? (lang === "ar" ? z.name_ar : z.name_en) : "—"; };

  async function removeUser(s: StaffT) {
    if (!(await ask(`${t("deleteConfirm")} ${s.full_name}؟`, true))) return;
    try {
      await adminUsers({ action: "delete", staff_id: s.id });   // Edge Function: checks history, last admin, removes login
      await inv("staff", "stores", "store-status", "dashboard"); toast(t("deleted"), "ok");
    } catch (e) { toastErr(e); }
  }
  async function toggle(s: StaffT) {
    if (!(await ask(`${t(s.active ? "deactivate" : "activate")}: ${s.full_name}?`, s.active))) return;
    try { await adminUsers({ action: "set_active", staff_id: s.id, active: !s.active }); await inv("staff"); toast(t("saved"), "ok"); } catch (e) { toastErr(e); }
  }

  return (
    <Shell title={t("staff")} actions={<button className="btn pri" onClick={() => setEdit("new")}><Icon name="plus" size={16} />{t("addStaff")}</button>}>
      {staff.isLoading ? <Loading /> : staff.error ? <ErrorBox error={staff.error} /> : !staff.data?.length ? <Empty /> : (
        <div className="card glass" style={{ padding: "6px 16px" }}>
          <div className="tw"><table className="t cards">
            <thead><tr><th>{t("name")}</th><th>{t("role")}</th><th>{t("zone")}</th><th>{t("stores")}</th><th>{t("login")}</th><th>{t("status")}</th><th /></tr></thead>
            <tbody>{staff.data.map((s) => (
              <tr key={s.id}>
                <td><b>{s.full_name}</b><div className="code num" dir="ltr" style={{ textAlign: "start" }}>{s.username ?? "—"}{s.legacy_code ? ` · ${s.legacy_code}` : ""}</div></td>
                <td className="mh">{t(s.role === "admin" ? "admin" : "technician")}</td>
                <td className="mh">{zoneName(s.zone_id)}</td>
                <td className="mh num">{nf(stores.data?.filter((x) => x.assigned_tech_id === s.id).length ?? 0)}</td>
                <td className="mh">{s.auth_user_id ? <span className="pill p-ok">✓</span> : <span className="pill p-none">{t("noLogin")}</span>} {pins.data?.has(s.id) && <span className="pill p-info">PIN</span>}</td>
                <td><span className={`pill ${s.active ? "p-ok" : "p-none"}`}>{t(s.active ? "active" : "inactive")}</span></td>
                <td><div className="flow">
                  <button className="btn" onClick={() => setEdit(s)}>{t("edit")}</button>
                  <button className="btn" onClick={() => setLogin({ s, mode: s.auth_user_id ? "reset" : "create" })}>{t(s.auth_user_id ? "resetPassword" : "createLogin")}</button>
                  {s.auth_user_id && <button className="btn" onClick={() => setPinFor(s)}>{t("pin")}</button>}
                  {s.id !== me?.id && <button className="btn danger" onClick={() => toggle(s)}>{t(s.active ? "deactivate" : "activate")}</button>}
                  {s.id !== me?.id && <button className="btn danger" onClick={() => removeUser(s)} aria-label={t("delete")}>{t("delete")}</button>}
                </div></td>
              </tr>))}</tbody>
          </table></div>
        </div>
      )}
      {edit && <StaffForm s={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {pinFor && <PinDialog staffId={pinFor.id} name={pinFor.full_name} onClose={() => setPinFor(null)} />}
      {login && <LoginForm s={login.s} mode={login.mode} onClose={() => setLogin(null)} />}
      {node}
    </Shell>
  );
}

function StaffForm({ s, onClose }: { s: StaffT | null; onClose: () => void }) {
    const { t, lang } = useI18n(); const zones = useZones(); const inv = useInvalidate(); const toast = useToast(); const toastErr = useErrorToast();
    const zoneName = (id: string | null) => { const z = zones.data?.find((x) => x.id === id); return z ? (lang === "ar" ? z.name_ar : z.name_en) : "—"; };
    const [f, setF] = useState({ full_name: s?.full_name ?? "", role: (s?.role ?? "technician") as Role, zone_id: s?.zone_id ?? "", phone: s?.phone ?? "" });
    const [busy, setBusy] = useState(false);
    async function save() {
      setBusy(true);
      const row = { full_name: f.full_name.trim(), role: f.role, zone_id: f.zone_id || null, phone: f.phone.trim() || null };
      const r = s ? await supabase.from("staff").update(row).eq("id", s.id) : await supabase.from("staff").insert(row);
      setBusy(false);
      if (r.error) return toastErr(r.error);
      await inv("staff", "dashboard"); toast(t("saved"), "ok"); onClose();
    }
    return (
      <Modal title={s ? s.full_name : t("addStaff")} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t("cancel")}</button><button className="btn pri" disabled={!f.full_name.trim() || busy} onClick={save}>{t("save")}</button></>}>
        <div style={{ display: "grid", gap: 12 }}>
          <Field label={t("fullName")}><input className="input" maxLength={80} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label={t("role")}><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}><option value="technician">{t("technician")}</option><option value="admin">{t("admin")}</option></select></Field>
          <Field label={t("zone")}><select className="input" value={f.zone_id} onChange={(e) => setF({ ...f, zone_id: e.target.value })}><option value="">—</option>{zones.data?.map((z) => <option key={z.id} value={z.id}>{zoneName(z.id)}</option>)}</select></Field>
          <Field label={t("phone")} hint={t("phoneLoginHint")}><input className="input" dir="ltr" inputMode="tel" maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
      </Modal>
    );
  }

function LoginForm({ s, mode, onClose }: { s: StaffT; mode: "create" | "reset"; onClose: () => void }) {
    const { t } = useI18n(); const inv = useInvalidate(); const toast = useToast(); const toastErr = useErrorToast();
    const [u, setU] = useState(s.username ?? ""); const [p, setP] = useState(""); const [busy, setBusy] = useState(false);
    const okU = /^[a-z0-9._-]{3,32}$/.test(u);
    async function save() {
      setBusy(true);
      try {
        await adminUsers(mode === "create" ? { action: "create_login", staff_id: s.id, username: u, password: p } : { action: "reset_password", staff_id: s.id, password: p });
        await inv("staff"); toast(t("saved"), "ok"); onClose();
      } catch (e) { toastErr(e); }
      setBusy(false);
    }
    return (
      <Modal title={`${t(mode === "create" ? "createLogin" : "resetPassword")} — ${s.full_name}`} onClose={onClose}
        footer={<><button className="btn" onClick={onClose}>{t("cancel")}</button><button className="btn pri" disabled={busy || !strong(p) || (mode === "create" && !okU)} onClick={save}>{t("save")}</button></>}>
        <div style={{ display: "grid", gap: 12 }}>
          {mode === "create" && <Field label={t("username")} hint="a-z 0-9 . _ -"><input className="input" dir="ltr" autoCapitalize="none" value={u} onChange={(e) => setU(e.target.value.toLowerCase())} /></Field>}
          <Field label={t("tempPassword")} hint={t("pwRule")}><input className="input" dir="ltr" type="text" autoComplete="off" value={p} onChange={(e) => setP(e.target.value)} /></Field>
        </div>
      </Modal>
    );
  }
