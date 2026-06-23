import { compact } from "es-toolkit/array";

import { m } from "@/paraglide/messages";

import type {
  ActionItem,
  MediaItem,
  PageItem,
  SearchModeItem,
  SettingItem,
  SettingOption,
} from "../types";

/** Fuzzy-matches on title, year, genres, tags (not id) to avoid id-format noise. */
export function mediaMatchValue(item: MediaItem): string {
  return compact([
    item.title,
    item.year,
    item.genres?.join(" "),
    item.tags?.join(" "),
    item.mediaType === "tv" ? "tv show series" : "movie film",
  ]).join(" ");
}

export function pageMatchValue(page: PageItem): string {
  return `${page.id} ${m[page.labelKey]()} ${m[page.hintKey]()}`;
}

export function searchModeMatchValue(mode: SearchModeItem): string {
  return `${mode.id} ${m[mode.labelKey]()} ${m[mode.hintKey]()}`;
}

export function actionMatchValue(action: ActionItem): string {
  return `${action.id} ${m[action.labelKey]()} ${m[action.hintKey]()}`;
}

export function settingMatchValue<T extends string>(
  setting: SettingItem<T>,
  opt: SettingOption<T>,
): string {
  return `${setting.id}:${opt.id} ${m[setting.labelKey]()} ${m[opt.labelKey]()}`;
}
