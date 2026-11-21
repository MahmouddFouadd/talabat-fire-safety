import { useEquipmentTypes } from "../lib/api";
import { useI18n, type TKey } from "../lib/i18n";

/* Line icons for inspected equipment — one visual language, 24×24, 1.8 stroke.
   Built-in types use their code; custom types pick one of these keys in Settings. */
export const ICONS: Record<string, string[]> = {
  p6: ["M9 9.5a3 3 0 0 1 6 0V20a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z", "M10.5 6.5h3v1.6h-3z", "M9.5 4.5h6", "M13.5 6.5c2.8 0 4.5 1.4 4.5 4.2V14", "M9 14h6"],
  co2: ["M9.5 9a2.5 2.5 0 0 1 5 0v11a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1z", "M10.8 6.5h2.4v1.6h-2.4z", "M10 4.5h5", "M13 6.5c2.4 0 4 1 4 3.5v2", "M15.5 12h3l1.5 4h-6z"],
  fs: ["M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M15.6 15.6 20.5 20.5", "M10.5 7c.6 2 2.6 2.9 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1 .5-1.8 1-2.3 0 1 .6 1.5 1.1 1.5 0-1.5-.5-2.6.5-4.2z"],
  hc: ["M4 3.5h16a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z", "M11 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z", "M11 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z", "M18 8v8", "M3 20.5h18"],
  al: ["M6.5 16.5h11l-1.6-2.2V10.5a3.9 3.9 0 0 0-7.8 0v3.8z", "M10.2 19a1.8 1.8 0 0 0 3.6 0", "M12 4.5v2", "M3.5 9.5c0-1.7.7-3.2 1.8-4.3", "M20.5 9.5c0-1.7-.7-3.2-1.8-4.3"],
  fp: ["M8.5 9.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z", "M8.5 12.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z", "M13 12h7v5h-7", "M8.5 9.5V5h5", "M13.5 3.5v3", "M3 21h18"],
  light: ["M4 8h16v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z", "M8 12a1.6 1.6 0 1 0 0 .01", "M16 12a1.6 1.6 0 1 0 0 .01", "M12 4v2", "M6.5 5l1 1.5", "M17.5 5l-1 1.5", "M10 19h4"],
  exit: ["M3 6h18v12H3z", "M10 9.5l-2 2.5 2 2.5", "M8 12h6", "M15.5 9v6", "M17.5 10.5a.8.8 0 1 0 0 .01"],
  aid: ["M4 7.5h16a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z", "M9 7.5V5.5h6v2", "M12 10.5v6", "M9 13.5h6"],
  smoke: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M12 4v2", "M12 18v2"],
  sprinkler: ["M9 3.5h6", "M12 3.5v5", "M8.5 8.5h7l-1.5 3h-4z", "M6 15l-1.5 2", "M12 15v2.5", "M18 15l1.5 2", "M8 19.5l-.8 1.2", "M16 19.5l.8 1.2"],
  blanket: ["M5 4h14v16H5z", "M5 9h14", "M10 13l2-2.5 2 2.5c0 1.2-.9 2-2 2s-2-.8-2-2z"],
  box: ["M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z", "M4 7.5 12 11l8-3.5", "M12 11v9"],
};
export const ICON_KEYS = ["light", "exit", "aid", "smoke", "sprinkler", "blanket", "p6", "co2", "al", "hc", "fp", "fs", "box"];

export function EqIcon({ code, icon, size = 22, title }: { code: string; icon?: string | null; size?: number; title?: string }) {
  const paths = ICONS[icon ?? code] ?? ICONS[code] ?? ICONS.box;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** Name + icon of any equipment code (built-in or custom), in the current language. */
export function useEq() {
  const { t, lang } = useI18n();
  const types = useEquipmentTypes();
  const find = (code: string) => types.data?.find((x) => x.code === code);
  return {
    types: types.data ?? [],
    name: (code: string) => { const x = find(code); return x ? (lang === "ar" ? x.name_ar : x.name_en) : t(`eq_${code}` as TKey); },
    icon: (code: string) => find(code)?.icon ?? code,
  };
}
