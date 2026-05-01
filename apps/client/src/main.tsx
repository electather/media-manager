import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import "./globals.css";
import { TooltipProvider } from "./shared/ui/tooltip";
import { Toaster } from "./shared/ui/sonner";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ErrorBoundary } from "./shared/components/error-boundary";
import { installGlobalErrorHandlers } from "./shared/lib/errors/global-handlers";
import { I18nProvider } from "./app/i18n-provider";
import { activateLocale, resolveInitialLocale } from "./app/i18n";

installGlobalErrorHandlers();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

await activateLocale(resolveInitialLocale());

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
          <Toaster />
          <ReactQueryDevtools initialIsOpen={false} />
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
