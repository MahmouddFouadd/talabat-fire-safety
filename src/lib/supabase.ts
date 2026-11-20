import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

// Session is kept by supabase-js (refresh-token rotation). Only the auth session lives in
// localStorage; inspection drafts live in IndexedDB and never contain tokens.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "fs-auth" },
});
