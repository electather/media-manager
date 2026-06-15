/**
 * Triggers a browser download via a synthetic anchor click. Used instead of
 * `window.location.href = ...` so the response can be a streamed attachment
 * with a `Content-Disposition` header without leaving the SPA.
 *
 * When `filename` is provided it is set as the `download` attribute, which
 * is necessary for blob URLs that carry no Content-Disposition header of
 * their own.
 */
export function triggerAnchorDownload(href: string, filename?: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
