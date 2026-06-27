import { embedText } from './embeddings';
import { getSupabaseClient } from './supabase';

export async function retrievePatterns(formData) {
  const exportMethods = formData.exportMethods || formData.dataExportMethods;
  const eventTracking = formData.eventTracking || formData.eventTrackingMethod;
  const currentMmp = formData.currentMMP || formData.currentMmp;

  const queryTerms = [
    formData.platforms?.join(' '),
    formData.integrationMethods?.join(' '),
    exportMethods?.join(' '),
    formData.authMethod,
    eventTracking,
    currentMmp && currentMmp !== 'None' ? currentMmp : null,
    formData.industry,
  ]
    .filter(Boolean)
    .join(' ');

  if (!queryTerms.trim()) return '';

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.VOYAGE_API_KEY) {
    return '';
  }

  try {
    const supabase = getSupabaseClient();
    if (!supabase) return '';

    const embedding = await embedText(queryTerms);

    const { data, error } = await supabase.rpc('match_patterns', {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: 5,
    });

    if (error) {
      console.error('RAG retrieval error:', error);
      return '';
    }

    if (!data || data.length === 0) return '';

    return data
      .map(
        (row, i) => `[Pattern ${i + 1}] ${row.platform} — ${row.title}\n${row.content}`
      )
      .join('\n\n---\n\n');
  } catch (err) {
    console.error('RAG error:', err);
    return '';
  }
}
