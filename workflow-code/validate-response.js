// Shared source embedded into exported Code nodes by scripts/harden-workflows.cjs.
function validateGeminiResponse(response, kind) {
  const fail = code => { throw new Error('AI_RESPONSE_REJECTED: ' + code + '; no draft was written'); };
  if (!response || response.error || response.promptFeedback?.blockReason) fail('BLOCKED_OR_ERROR');
  if (!Array.isArray(response.candidates) || response.candidates.length !== 1) fail('CANDIDATE_COUNT');
  const candidate = response.candidates[0];
  if (candidate.finishReason !== 'STOP') fail('INCOMPLETE_RESPONSE');
  const parts = candidate.content?.parts;
  if (!Array.isArray(parts) || parts.length !== 1 || typeof parts[0].text !== 'string' || parts[0].thought === true) fail('TEXT_REQUIRED');
  if (parts[0].text.length > 24000) fail('RESPONSE_TOO_LARGE');
  const text = parts[0].text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  let data;
  try { data = JSON.parse(text); } catch { fail('INVALID_JSON'); }
  const fields = kind === 'meal'
    ? ['observed_foods','goal_alignment','ai_coach_assessment','missing_info','ai_client_draft','issue_flags']
    : ['coach_summary','ai_client_draft'];
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('OBJECT_REQUIRED');
  if (Object.keys(data).length !== fields.length || Object.keys(data).some(k => !fields.includes(k))) fail('UNEXPECTED_FIELDS');
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(data, field) || typeof data[field] !== 'string') fail('FIELD_TYPE');
    if (data[field].length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data[field])) fail('FIELD_CONTENT');
    if (!['missing_info','issue_flags'].includes(field) && !data[field].trim()) fail('EMPTY_FIELD');
  }
  return data;
}
