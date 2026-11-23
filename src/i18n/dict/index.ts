import { common } from "./common";
import { errors } from "./errors";
import { flows } from "./flows";
import { labels } from "./labels";
import { main } from "./main";
import { pending } from "./pending";
import { settings } from "./settings";

/** Texto em português → [inglês, espanhol]. Cada área da interface tem o seu arquivo. */
export type Entries = Record<string, [string, string]>;

export const DICTIONARY: Entries = {
  ...common,
  ...main,
  ...labels,
  ...settings,
  ...flows,
  ...errors,
  ...pending,
};
