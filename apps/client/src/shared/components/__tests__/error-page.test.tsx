// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  ErrorPage,
  ErrorPageActions,
  ErrorPageDescription,
  ErrorPageDetails,
  ErrorPageFrame,
  ErrorPageHeadline,
  ErrorPageHelp,
} from "../error-page";

afterEach(cleanup);

describe("ErrorPage", () => {
  it("renders the composed headline and description with an alert frame", () => {
    render(
      <ErrorPage tone="info">
        <ErrorPageFrame>
          <ErrorPageHeadline code="404" eyebrow="// route.not_found">
            We can't find that page.
          </ErrorPageHeadline>
          <ErrorPageDescription>The link is broken.</ErrorPageDescription>
          <ErrorPageActions>
            <button type="button">Back home</button>
          </ErrorPageActions>
        </ErrorPageFrame>
      </ErrorPage>,
    );

    const stage = screen.getByRole("alert").closest('[data-slot="error-page"]');
    expect(stage?.getAttribute("data-tone")).toBe("info");
    expect(screen.getByRole("heading", { name: /can't find that page/i })).toBeTruthy();
    expect(screen.getByText("404")).toBeTruthy();
    expect(screen.getByText("// route.not_found")).toBeTruthy();
    expect(screen.getByText(/the link is broken/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /back home/i })).toBeTruthy();
  });

  it("defaults to the danger tone", () => {
    render(
      <ErrorPage>
        <ErrorPageFrame>
          <ErrorPageHeadline code="500">Boom</ErrorPageHeadline>
        </ErrorPageFrame>
      </ErrorPage>,
    );
    const stage = screen.getByRole("alert").closest('[data-slot="error-page"]');
    expect(stage?.getAttribute("data-tone")).toBe("danger");
  });

  it("ErrorPageDetails reveals the rows when the trigger is clicked", () => {
    render(
      <ErrorPageDetails
        title="Technical details"
        reference="abc1234"
        rows={[
          { label: "Request ID", value: "abc1234", copyValue: "rid-abc-1234" },
          { label: "Status", value: "500 · Server error" },
        ]}
      />,
    );

    expect(screen.queryByText(/^Status$/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /technical details/i }));
    expect(screen.getByText(/^Status$/i)).toBeTruthy();
    expect(screen.getByText("500 · Server error")).toBeTruthy();
  });

  it("ErrorPageHelp wraps links with hover-aware classes", () => {
    render(
      <ErrorPageHelp>
        <a href="https://example.com/status">Status page</a>
        <a href="https://example.com/help">Help center</a>
      </ErrorPageHelp>,
    );
    expect(screen.getByRole("link", { name: /status page/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /help center/i })).toBeTruthy();
  });
});
