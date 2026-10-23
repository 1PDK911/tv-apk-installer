// Content Security Policy for the renderer: no remote code, no network access
// from the page (all adb and download work happens in the main process).
export function buildCsp(dev: boolean): string {
  return [
    "default-src 'self'",
    // The dev server's React Fast Refresh preamble is an inline script; production allows none.
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    dev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}
