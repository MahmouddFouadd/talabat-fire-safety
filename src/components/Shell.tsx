import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useI18n, type TKey } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useDashboard } from "../lib/api";
import { Icon } from "./icons";
import { Modal } from "./ui";

type Item = { to: string; key: TKey; icon: string };
const ADMIN: Item[] = [
  { to: "/admin", key: "dashboard", icon: "dashboard" },
  { to: "/admin/stores", key: "stores", icon: "stores" },
  { to: "/admin/issues", key: "issues", icon: "issues" },
  { to: "/admin/inspections", key: "inspections", icon: "inspections" },
  { to: "/admin/equipment", key: "equipment", icon: "equipment" },
  { to: "/admin/reports", key: "reports", icon: "reports" },
  { to: "/admin/zones", key: "zones", icon: "zones" },
  { to: "/admin/staff", key: "staff", icon: "staff" },
  { to: "/admin/settings", key: "settings", icon: "settings" },
  { to: "/admin/audit", key: "audit", icon: "audit" },
];
const TECH: Item[] = [
  { to: "/tech", key: "myStores", icon: "myStores" },
  { to: "/tech/history", key: "history", icon: "history" },
];

export function useTheme() {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("fs-theme") || "");
  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme); else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("fs-theme", theme);
  }, [theme]);
  const isDark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return { isDark, toggle: () => setTheme(isDark ? "light" : "dark") };
}

export function Tools() {
  const { lang, setLang, t } = useI18n();
  const { isDark, toggle } = useTheme();
  return (
    <>
      <div className="seg" role="group" aria-label={t("language")}>
        <button aria-pressed={lang === "ar"} onClick={() => setLang("ar")}>ع</button>
        <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
      </div>
      <button className="iconbtn" onClick={toggle} aria-label={t("theme")}><Icon name={isDark ? "sun" : "moon"} size={18} /></button>
    </>
  );
}

export function Shell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const { t } = useI18n();
  const { staff, signOut } = useAuth();
  const isAdmin = staff?.role === "admin";
  const items = isAdmin ? ADMIN : TECH;
  const { data: dash } = useDashboard(null, isAdmin);
  const openIssues = isAdmin ? dash?.open_issues ?? 0 : 0;
  const loc = useLocation();
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  const mobileMain = isAdmin ? items.slice(0, 4) : items;
  const isActive = (to: string) => (to === "/admin" || to === "/tech" ? loc.pathname === to || (to === "/tech" && loc.pathname.startsWith("/tech/inspect")) : loc.pathname.startsWith(to));

  useEffect(() => { document.title = `${title} · ${t("app")}`; }, [title, t]);

  return (
    <div className="app">
      <aside className="rail glass" aria-label="Main navigation">
        <div className="brand">
          <img className="brand-logo" src="./brand/talabat-mart.png" alt="talabat mart" />
          <span>{t("app")}</span>
        </div>
        <nav>
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === "/admin" || i.to === "/tech"} className={() => `navi ${isActive(i.to) ? "active" : ""}`}>
              <Icon name={i.icon} /><span>{t(i.key)}</span>
              {i.key === "issues" && openIssues > 0 && <span className="cnt num">{openIssues}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="who" style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 22 }}>
          <div className="av">{(staff?.full_name ?? "?").slice(0, 2).toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={{ fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{staff?.full_name}</b>
            <span className="code">{t(isAdmin ? "admin" : "technician")}</span>
          </div>
          <button className="iconbtn" onClick={signOut} aria-label={t("signOut")} title={t("signOut")}><Icon name="logout" size={18} /></button>
        </div>
      </aside>

      <main className="content">
        <div className="top">
          <h1>{title}</h1>
          <div className="tools">
            {actions}
            <Tools />
            <button className="iconbtn bn-only" onClick={signOut} aria-label={t("signOut")}><Icon name="logout" size={18} /></button>
          </div>
        </div>
        {children}
      </main>

      <nav className="bnav glass" aria-label="Main navigation">
        {mobileMain.map((i) => (
          <button key={i.to} className={isActive(i.to) ? "active" : ""} onClick={() => nav(i.to)} aria-current={isActive(i.to) ? "page" : undefined} aria-label={t(i.key)} title={t(i.key)}>
            <div className="bub"><Icon name={i.icon} /></div><span>{t(i.key)}</span>
            {i.key === "issues" && openIssues > 0 && <b className="cnt num">{openIssues}</b>}
          </button>
        ))}
        {isAdmin && (
          <button className={items.slice(4).some((i) => isActive(i.to)) ? "active" : ""} onClick={() => setMore(true)} aria-label={t("more")} title={t("more")}>
            <div className="bub"><Icon name="more" /></div><span>{t("more")}</span>
          </button>
        )}
      </nav>

      {more && (
        <Modal title={t("more")} onClose={() => setMore(false)}>
          <div style={{ display: "grid", gap: 4 }}>
            {items.slice(4).map((i) => (
              <button key={i.to} className={`navi ${isActive(i.to) ? "active" : ""}`} onClick={() => { setMore(false); nav(i.to); }}>
                <Icon name={i.icon} /><span>{t(i.key)}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
