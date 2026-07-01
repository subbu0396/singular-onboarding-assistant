// Server-side CRUD for the generations table (Phase 7).
//
// Every completed doc generation is persisted here so the SE can revisit
// it later without re-running the pipeline, and so a share_token can
// point to a public read-only view for 24h. All rows are globally
// visible on the homepage list — no owner scoping to match the rest of
// the app's demo shape.

import { getSupabaseClient } from '@/lib/supabase';

const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 20;

function randomShareToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Trim the form snapshot to only the fields Skill prompts read, so we don't
// stash tokens or the client's OAuth state in the row by accident. Server-
// side helpers already strip _docUploaded (removed in PR #19) and there's
// no session data on the form itself, but future refactors could slip
// something in — this allowlist is the belt.
const FORM_FIELDS = [
  'clientName',
  'targetMmp',
  'industry',
  'primaryMarket',
  'platforms',
  'currentMmp',
  'attributionModel',
  'integrationMethods',
  'dataExportMethods',
  'eventTrackingMethod',
  'backendLanguage',
  'hasDataWarehouse',
  'usesCdp',
  'cdpName',
  'authMethod',
  'targetGoLiveDate',
  'onboardingUrgency',
  'seAvailabilityNotes',
  'engineeringAvailabilityNotes',
];

function sanitizeForm(form) {
  if (!form || typeof form !== 'object') return {};
  const out = {};
  for (const field of FORM_FIELDS) {
    if (form[field] !== undefined) out[field] = form[field];
  }
  return out;
}

export async function saveGeneration({ form, documents }) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const shareToken = randomShareToken();
  const now = new Date();
  const shareExpiresAt = new Date(now.getTime() + SHARE_TTL_MS);

  const row = {
    client_name: form?.clientName || 'Unknown client',
    target_mmp: form?.targetMmp || null,
    form_snapshot: sanitizeForm(form),
    documents,
    share_token: shareToken,
    share_expires_at: shareExpiresAt.toISOString(),
    created_at: now.toISOString(),
  };

  const { data, error } = await supabase
    .from('generations')
    .insert(row)
    .select('id, share_token, share_expires_at, created_at')
    .single();

  if (error) {
    console.error('saveGeneration failed', error.message);
    return null;
  }
  return data;
}

export async function listRecentGenerations(limit = RECENT_LIMIT) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('generations')
    .select('id, client_name, target_mmp, created_at, share_token, share_expires_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('listRecentGenerations failed', error.message);
    return [];
  }
  return data || [];
}

export async function getGenerationById(id) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('generations')
    .select('id, client_name, target_mmp, form_snapshot, documents, created_at, share_token, share_expires_at')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('getGenerationById failed', error.message);
    return null;
  }
  return data;
}

export async function getGenerationByShareToken(token) {
  if (!token) return null;
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('generations')
    .select('id, client_name, target_mmp, form_snapshot, documents, created_at, share_expires_at')
    .eq('share_token', token)
    .maybeSingle();
  if (error) {
    console.error('getGenerationByShareToken failed', error.message);
    return null;
  }
  if (!data) return null;
  if (data.share_expires_at && new Date(data.share_expires_at) < new Date()) {
    return { expired: true };
  }
  return data;
}
