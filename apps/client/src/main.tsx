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
import { installGlobalErrorHandlers } from "./shared/lib/diagnostics/global-handlers";
import { useHtmlDir } from "./shared/hooks/use-html-dir";
import { DirectionProvider } from "./shared/ui/direction";
import { ThemeProvider } from "./shared/lib/theme";

installGlobalErrorHandlers();

function I18nRoot({ children }: { children: ReactNode }) {
  const dir = useHtmlDir();
  return <DirectionProvider direction={dir}>{children}</DirectionProvider>;
}

// 60s is the app-wide baseline staleTime; it matches the largest existing
// cluster of explicit overrides. Individual queries override it only when they
// need fresher (e.g. polling diagnostics/notifications) or longer (e.g. 5-min
// trending, immortal public config) caching.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000 } },
});

const router = createRouter({ routeTree, context: { queryClient, session: null } });

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
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <RouterProvider router={router} />
            </TooltipProvider>
            <Toaster />
            <ReactQueryDevtools initialIsOpen={false} />
          </QueryClientProvider>
        </ThemeProvider>
      </I18nRoot>
    </ErrorBoundary>
  </StrictMode>,
);
