import type { ReactNode } from "react";
import { I18nProvider as LinguiProvider } from "@lingui/react";
import { i18n } from "./i18n";

interface Props {
  children: ReactNode;
}

export function I18nProvider({ children }: Props) {
  return <LinguiProvider i18n={i18n}>{children}</LinguiProvider>;
}
