import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n, type TKey } from "../lib/i18n";
import { errorText } from "../lib/errors";
import type { StoreStatus } from "../lib/types";

/* toasts */
type Toast = { id: number; text: string; kind?: "ok" | "bad" };
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind?: Toast["kind"]) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{list.map((t) => <div key={t.id} className={`toast ${t.kind ?? ""}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
export function useErrorToast() {
  const toast = useToast(); const { lang } = useI18n();
  return (e: unknown) => toast(errorText(e, lang), "bad");
}

/* modal */
export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus(); };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal glass ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
        {footer && <div className="actions">{footer}</div>}
      </div>
    </div>
  );
}

export function useConfirm() {
  const { t } = useI18n();
  const [state, setState] = useState<{ text: string; resolve: (v: boolean) => void; danger?: boolean } | null>(null);
  const ask = (text: string, danger?: boolean) => new Promise<boolean>((resolve) => setState({ text, resolve, danger }));
  const node = state ? (
    <Modal title={t("confirm")} onClose={() => { state.resolve(false); setState(null); }}
      footer={<>
        <button className="btn" onClick={() => { state.resolve(false); setState(null); }}>{t("cancel")}</button>
        <button className={`btn ${state.danger ? "wine" : "pri"}`} onClick={() => { state.resolve(true); setState(null); }}>{t("confirm")}</button>
      </>}>
      <p style={{ margin: 0 }}>{state.text}</p>
    </Modal>
  ) : null;
  return { ask, node };
}

export function Kpi({ dot, label, value, hint, onClick }: { dot: string; label: string; value: number; hint?: string; onClick?: () => void }) {
  const { nf } = useI18n();
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className="kpi glass" onClick={onClick}>
      <div className="lab"><i className={`dot d-${dot}`} />{label}</div>
      <div className="val num">{nf(value)}</div>
      {hint && <div className="hint">{hint}</div>}
    </Tag>
  );
}

export function StatusPill({ s }: { s: StoreStatus }) {
  const { t } = useI18n();
  return <span className={`pill p-${s}`}><i className={`dot d-${s}`} />{t(`st_${s}` as TKey)}</span>;
}
export function OverallPill({ s }: { s: "ok" | "warn" }) {
  const { t } = useI18n();
  return <span className={`pill p-${s === "ok" ? "ok" : "warn"}`}>{t(s === "ok" ? "ov_ok" : "ov_warn")}</span>;
}

export function Loading() { const { t } = useI18n(); return <div className="center"><div className="spinner" /><span className="muted">{t("loading")}</span></div>; }
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, lang } = useI18n();
  return <div className="banner bad" role="alert"><span>{errorText(error, lang)}</span>{onRetry && <button className="btn" onClick={onRetry}>{t("retry")}</button>}</div>;
}
export function Empty({ text }: { text?: string }) { const { t } = useI18n(); return <div className="empty">{text ?? t("empty")}</div>; }

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <label className="field">{label}{children}{hint && <small>{hint}</small>}{error && <span className="err">{error}</span>}</label>;
}

export function Pager({ page, count, size, onPage }: { page: number; count: number; size: number; onPage: (p: number) => void }) {
  const { t, nf } = useI18n();
  const pages = Math.max(1, Math.ceil(count / size));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn" disabled={page === 0} onClick={() => onPage(page - 1)}>{t("prev")}</button>
      <span className="num">{t("page")} {nf(page + 1)} {t("of")} {nf(pages)}</span>
      <button className="btn" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>{t("nextPage")}</button>
    </div>
  );
}
