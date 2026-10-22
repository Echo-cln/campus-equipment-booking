/* Public browser settings. The Supabase publishable/anon key is intended for
   browser use; RLS is the security boundary. Never put a service_role key here. */
window.SITE_CONFIG = Object.freeze({
  supabaseUrl: "",
  supabaseAnonKey: "",
  requestTimeoutMs: 8000,
  pageSize: 5,
  calendarMinYear: 2000,
  calendarMaxYear: 2100
});
