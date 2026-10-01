import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;
function getClient() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

/**
 * Saves a completed fitting. Generates the row's UUID client-side and
 * inserts it explicitly — this is NOT optional. The RLS policy on
 * fitting_submissions grants INSERT only, not SELECT, so any use of
 * Supabase's `.select()` after `.insert()` (a common pattern in their
 * docs, which performs `INSERT ... RETURNING` under the hood) will fail
 * with "permission denied" under this schema. Generating the id here and
 * returning it directly avoids ever needing that round trip. Verified
 * against a real Postgres instance with the same RLS policies before
 * shipping this.
 *
 * @returns {string} the submission's id, for linking feedback to it.
 */
async function saveFittingSubmission(answers, results) {
  const id = crypto.randomUUID();
  const row = {
    id,
    speed_band: results.speedBand ?? null,
    best_overall_ball: results.bestOverall ? results.bestOverall.ball.name : null,
    best_value_ball: results.bestValue ? results.bestValue.ball.name : null,
    premium_alternative_ball: results.premiumAlternative ? results.premiumAlternative.ball.name : null,
    answers,
    results,
  };
  const { error } = await getClient().from('fitting_submissions').insert(row);
  if (error) {
    console.error('Failed to save fitting submission:', error);
    return null; // caller should treat this as "couldn't save" without breaking the UI
  }
  return id;
}

/**
 * @param {string|null} submissionId - from saveFittingSubmission(), or null
 *   if that save failed (feedback can still be recorded standalone).
 * @param {'yes'|'sort_of'|'no'} rating
 * @param {string} [comment]
 */
async function saveFeedback(submissionId, rating, comment = null) {
  // No client-generated id needed here — nothing downstream needs this
  // row's id back, so the table's default gen_random_uuid() is fine.
  const row = { submission_id: submissionId, rating, comment };
  const { error } = await getClient().from('tester_feedback').insert(row);
  if (error) {
    console.error('Failed to save feedback:', error);
    return false;
  }
  return true;
}

export { saveFittingSubmission, saveFeedback };
