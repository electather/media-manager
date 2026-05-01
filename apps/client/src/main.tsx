import { StrictMode, type ReactNode } from "react";
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
import { useHtmlDir } from "./shared/hooks/use-html-dir";
import { DirectionProvider } from "./shared/ui/direction";
import { htmlDirFor } from "./shared/lib/i18n/rtl";
import { getLocale } from "./paraglide/runtime";

installGlobalErrorHandlers();

function I18nRoot({ children }: { children: ReactNode }) {
  useHtmlDir();
  const dir = htmlDirFor(getLocale());
  return <DirectionProvider direction={dir}>{children}</DirectionProvider>;
}

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nRoot>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
          <Toaster />
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </I18nRoot>
    </ErrorBoundary>
  </StrictMode>,
);
