import { compact } from "es-toolkit/array";

import type {
  ActionItem,
  MediaItem,
  PageItem,
  SearchModeItem,
  SettingItem,
  SettingOption,
} from "../types";
import { t } from "./i18n";

/**
 * cmdk fuzzy-matches against the `value` string. Title comes first so prefix
 * matches on the title score highest; everything else (year, genres, tags,
 * director, cast) is appended to broaden hits — a query for "atmos" or a cast
 * name still finds the right title. We leave `item.id` out so id strings like
 * `tv:tt0898266` don't leak into fuzzy space.
 */
export function mediaMatchValue(item: MediaItem): string {
  return compact([
    item.title,
    item.year,
    item.genres?.join(" "),
    item.tags?.join(" "),
    item.mediaType === "tv" ? "tv show series" : "movie film",
    item.director,
    item.cast?.join(" "),
  ]).join(" ");
}

export function pageMatchValue(page: PageItem): string {
  return `${page.id} ${t(page.labelKey)} ${t(page.hintKey)}`;
}

export function searchModeMatchValue(mode: SearchModeItem): string {
  return `${mode.id} ${t(mode.labelKey)} ${t(mode.hintKey)}`;
}

export function actionMatchValue(action: ActionItem): string {
  return `${action.id} ${t(action.labelKey)} ${t(action.hintKey)}`;
}

export function settingMatchValue<T extends string>(
  setting: SettingItem<T>,
  opt: SettingOption<T>,
): string {
  return `${setting.id}:${opt.id} ${t(setting.labelKey)} ${t(opt.labelKey)}`;
}
