import { createClient } from '@supabase/supabase-js';

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

if (!URL || !ANON) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing — auth features disabled, legacy share-URL flow still works.',
  );
}

export const supabase = createClient(URL || 'https://invalid.local', ANON || 'invalid', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'kaamos.auth.session',
  },
});

export const supabaseConfigured = Boolean(URL && ANON);
