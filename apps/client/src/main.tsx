import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import "./globals.css";
import { TooltipProvider } from "./shared/ui/tooltip";
import { Toaster } from "./shared/ui/sonner";
import { NotificationToasterHost } from "./features/notifications";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ErrorBoundary } from "./shared/components/error-boundary";
import { installGlobalErrorHandlers } from "./shared/lib/diagnostics/global-handlers";
import { useHtmlDir } from "./shared/hooks/use-html-dir";
import { DirectionProvider } from "./shared/ui/direction";

installGlobalErrorHandlers();

function I18nRoot({ children }: { children: ReactNode }) {
  const dir = useHtmlDir();
  return <DirectionProvider direction={dir}>{children}</DirectionProvider>;
}

const queryClient = new QueryClient();

const router = createRouter({ routeTree, context: { queryClient } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

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
          <NotificationToasterHost />
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </I18nRoot>
    </ErrorBoundary>
  </StrictMode>,
);
