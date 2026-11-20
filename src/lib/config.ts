// Public client configuration. The URL and anon key are designed to be public;
// all protection comes from Row Level Security and the RPCs. NEVER put the secret/service key here.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://pwijwlcqtjoaqxjnygwh.supabase.co";
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aWp3bGNxdGpvYXF4am55Z3doIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxNzU1NTQsImV4cCI6MjExMDc1MTU1NH0.saCq478pIMDkSJB8v4dPyp4KuNt2P75HEtKUPweyeK8";
export const LOGIN_DOMAIN = import.meta.env.VITE_LOGIN_DOMAIN || "fs.local";
