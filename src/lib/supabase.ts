import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let _serviceClient: SupabaseClient | null = null;

/**
 * Returns the Supabase service-role client singleton.
 * Bypasses RLS — only call from server-side code (API routes, lib functions).
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!_serviceClient) {
    _serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return _serviceClient;
}
