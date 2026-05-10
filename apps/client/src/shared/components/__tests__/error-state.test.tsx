// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { ServerCrashIcon } from "lucide-react";

import {
  ErrorScreen,
  ErrorState,
  ErrorStateActions,
  ErrorStateContent,
  ErrorStateDescription,
  ErrorStateMedia,
  ErrorStateReference,
  ErrorStateTitle,
} from "../error-state";

afterEach(cleanup);

describe("ErrorState", () => {
  it("renders an alert with the composed parts", () => {
    render(
      <ErrorState>
        <ErrorStateMedia />
        <ErrorStateContent>
          <ErrorStateTitle>Couldn't load page</ErrorStateTitle>
          <ErrorStateDescription>Source did not respond.</ErrorStateDescription>
          <ErrorStateReference>Ref: abc1234</ErrorStateReference>
        </ErrorStateContent>
        <ErrorStateActions>
          <button type="button">Retry</button>
        </ErrorStateActions>
      </ErrorState>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-orientation")).toBe("horizontal");
    expect(screen.getByRole("heading", { name: /couldn't load page/i })).toBeTruthy();
    expect(screen.getByText(/source did not respond/i)).toBeTruthy();
    expect(screen.getByText(/abc1234/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("flags vertical orientation through data attribute", () => {
    render(
      <ErrorState orientation="vertical">
        <ErrorStateMedia />
        <ErrorStateTitle>Down</ErrorStateTitle>
      </ErrorState>,
    );
    expect(screen.getByRole("alert").getAttribute("data-orientation")).toBe("vertical");
  });

  it("forwards a custom icon through ErrorStateMedia children", () => {
    const { container } = render(
      <ErrorState>
        <ErrorStateMedia>
          <ServerCrashIcon data-testid="custom-icon" />
        </ErrorStateMedia>
      </ErrorState>,
    );
    expect(container.querySelector('[data-testid="custom-icon"]')).toBeTruthy();
  });

  it("hides decorative media from assistive tech", () => {
    const { container } = render(
      <ErrorState>
        <ErrorStateMedia />
      </ErrorState>,
    );
    const media = container.querySelector('[data-slot="error-state-media"]');
    expect(media?.getAttribute("aria-hidden")).toBe("true");
  });

  it("ErrorScreen wraps content in a centered container", () => {
    render(
      <ErrorScreen data-testid="screen">
        <ErrorState orientation="vertical">
          <ErrorStateTitle>Boom</ErrorStateTitle>
        </ErrorState>
      </ErrorScreen>,
    );
    expect(screen.getByTestId("screen").getAttribute("data-slot")).toBe("error-screen");
  });
});
