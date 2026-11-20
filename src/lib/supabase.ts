import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

// Session is kept by supabase-js (refresh-token rotation). Only the auth session lives in
// localStorage; inspection drafts live in IndexedDB and never contain tokens.
// Every request times out after 20 s so a bad connection shows an error instead of spinning forever.
const timedFetch: typeof fetch = (input, init) => {
  if (init?.signal || typeof AbortController === "undefined") return fetch(input, init);
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), 20_000);
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(id));
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "fs-auth" },
  global: { fetch: timedFetch },
});
