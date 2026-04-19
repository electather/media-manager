import { reportError } from "./report";

let registered = false;

/** Installs `window.error` and `unhandledrejection` listeners so anything thrown
 *  outside React's tree still makes it into the backend error store. Idempotent. */
export function installGlobalErrorHandlers(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;

  window.addEventListener("error", (event) => {
    void reportError(event.error ?? event.message, "error", {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    void reportError(event.reason, "error", { kind: "unhandledrejection" });
  });
}
