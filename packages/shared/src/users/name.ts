import { NAME_MAX_LENGTH } from "./schemas";

// UTF-16 limit mirrors Zod z.string().max(NAME_MAX_LENGTH) (String.length).
// A code-point limit would accept strings the API guard rejects. If the
// boundary lands on a high surrogate, drop it to avoid a lone surrogate.
export function truncateName(name: string): string {
  if (name.length <= NAME_MAX_LENGTH) return name;
  // 0xD800–0xDBFF is the high-surrogate range; a high surrogate at the last
  // kept index means its low-surrogate mate would be cut off, so exclude it.
  const lastKept = name.charCodeAt(NAME_MAX_LENGTH - 1);
  const end = lastKept >= 0xd800 && lastKept <= 0xdbff ? NAME_MAX_LENGTH - 1 : NAME_MAX_LENGTH;
  return name.slice(0, end);
}
