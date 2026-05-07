// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Suspense } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fetchersMock = vi.hoisted(() => ({
  fetchAdminSettings: vi.fn(),
  fetchUpdateAdminSettings: vi.fn(),
}));
vi.mock("../../shared/fetchers", () => fetchersMock);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { RetentionForm } from "../retention-form";
import { notificationsKeys } from "../../shared/query-keys";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function withClient(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <Suspense fallback={null}>{children}</Suspense>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  for (const fn of Object.values(fetchersMock)) fn.mockReset();
  for (const fn of Object.values(toastMock)) fn.mockReset();
});
afterEach(() => cleanup());

describe("RetentionForm", () => {
  it("does not call the mutation when an input is non-numeric or below 1", async () => {
    fetchersMock.fetchAdminSettings.mockResolvedValue({
      inboxRetentionDays: 30,
      deliveryRetentionDays: 30,
    });
    const qc = makeClient();
    qc.setQueryData(notificationsKeys.admin.settings(), {
      inboxRetentionDays: 30,
      deliveryRetentionDays: 30,
    });
    const user = userEvent.setup();
    render(<RetentionForm />, { wrapper: withClient(qc) });

    const inboxInput = (await screen.findByLabelText(/inbox retention/i)) as HTMLInputElement;
    await user.clear(inboxInput);
    await user.type(inboxInput, "0");
    const form = inboxInput.closest("form")!;
    fireEvent.submit(form);
    expect(fetchersMock.fetchUpdateAdminSettings).not.toHaveBeenCalled();
  });

  it("submits the typed values to the update endpoint", async () => {
    fetchersMock.fetchAdminSettings.mockResolvedValue({
      inboxRetentionDays: 30,
      deliveryRetentionDays: 30,
    });
    fetchersMock.fetchUpdateAdminSettings.mockResolvedValue({
      inboxRetentionDays: 365,
      deliveryRetentionDays: 365,
    });
    const qc = makeClient();
    qc.setQueryData(notificationsKeys.admin.settings(), {
      inboxRetentionDays: 30,
      deliveryRetentionDays: 30,
    });
    const user = userEvent.setup();
    render(<RetentionForm />, { wrapper: withClient(qc) });

    const inboxInput = (await screen.findByLabelText(/inbox retention/i)) as HTMLInputElement;
    await user.clear(inboxInput);
    await user.type(inboxInput, "9999");
    const form = inboxInput.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(fetchersMock.fetchUpdateAdminSettings).toHaveBeenCalledWith({
        inboxRetentionDays: 9999,
        deliveryRetentionDays: 30,
      });
    });
  });
});
