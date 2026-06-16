/**
 * Triggers a browser download via a synthetic anchor click. Used instead of
 * `window.location.href = ...` so the response can be a streamed attachment
 * with a `Content-Disposition` header without leaving the SPA.
 */
export function triggerAnchorDownload(href: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
