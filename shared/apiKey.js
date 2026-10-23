/** API keys are opaque credentials. Google, not a prefix regex, validates them. */
export function normalizeApiKey(value) {
  if (typeof value !== 'string') return '';
  let key = value.trim().replace(/^(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*/, '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  return key;
}
export function hasApiKeyFormat(value) {
  const key = normalizeApiKey(value);
  // Prevent accidental multiline/header input, without depending on key prefixes.
  return key.length >= 20 && key.length <= 512 && /^[\x21-\x7e]+$/.test(key);
}
