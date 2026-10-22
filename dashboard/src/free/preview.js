/** CSP + opaque-origin iframe keeps generated scripts away from the builder and API keys. */
export function previewDocument(files) {
  const html = files.find(f => f.path === 'frontend/index.html')?.content || '<p>No frontend/index.html available.</p>';
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  // Put our policy first, before any model-controlled markup or scripts.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
}
