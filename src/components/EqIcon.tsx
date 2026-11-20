import type { EqCode } from "../lib/types";

/* Line icons for the inspected equipment — one visual language, 24×24, 1.8 stroke. */
const PATHS: Record<EqCode, string[]> = {
  // 6 kg dry-powder extinguisher: cylinder, valve, carry handle, short hose
  p6: ["M9 9.5a3 3 0 0 1 6 0V20a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z", "M10.5 6.5h3v1.6h-3z", "M9.5 4.5h6", "M13.5 6.5c2.8 0 4.5 1.4 4.5 4.2V14", "M9 14h6"],
  // CO2 extinguisher: slimmer cylinder with discharge horn
  co2: ["M9.5 9a2.5 2.5 0 0 1 5 0v11a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1z", "M10.8 6.5h2.4v1.6h-2.4z", "M10 4.5h5", "M13 6.5c2.4 0 4 1 4 3.5v2", "M15.5 12h3l1.5 4h-6z"],
  // Fire Search equipment: magnifier over a flame
  fs: ["M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M15.6 15.6 20.5 20.5", "M10.5 7c.6 2 2.6 2.9 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1 .5-1.8 1-2.3 0 1 .6 1.5 1.1 1.5 0-1.5-.5-2.6.5-4.2z"],
  // hose-reel cabinet: cabinet, reel, valve wheel
  hc: ["M4 3.5h16a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z", "M11 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z", "M11 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z", "M18 8v8", "M3 20.5h18"],
  // fire alarm: bell with sound waves
  al: ["M6.5 16.5h11l-1.6-2.2V10.5a3.9 3.9 0 0 0-7.8 0v3.8z", "M10.2 19a1.8 1.8 0 0 0 3.6 0", "M12 4.5v2", "M3.5 9.5c0-1.7.7-3.2 1.8-4.3", "M20.5 9.5c0-1.7-.7-3.2-1.8-4.3"],
  // fire pump: volute, motor, outlet pipe, base
  fp: ["M8.5 9.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z", "M8.5 12.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z", "M13 12h7v5h-7", "M8.5 9.5V5h5", "M13.5 3.5v3", "M3 21h18"],
};

export function EqIcon({ code, size = 22, title }: { code: EqCode; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {PATHS[code].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
