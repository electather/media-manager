import { expect, test } from "vite-plus/test";

import { findLongComments, parseLimit } from "../find-long-comments";

test("flags a block comment spanning more than 5 lines", () => {
  const src = ["/**", " * 1", " * 2", " * 3", " * 4", " * 5", " */", "const x = 1;"].join("\n");
  expect(findLongComments(src)).toEqual([{ startLine: 1, endLine: 7 }]);
});

test("ignores a block comment of exactly 5 lines", () => {
  const src = ["/**", " * 1", " * 2", " * 3", " */"].join("\n");
  expect(findLongComments(src)).toEqual([]);
});

test("merges consecutive line comments into one region", () => {
  const src = ["// 1", "// 2", "// 3", "// 4", "// 5", "// 6", "code();"].join("\n");
  expect(findLongComments(src)).toEqual([{ startLine: 1, endLine: 6 }]);
});

test("does not merge line comments separated by code", () => {
  const src = ["// 1", "// 2", "// 3", "code();", "// 5", "// 6", "// 7"].join("\n");
  expect(findLongComments(src)).toEqual([]);
});

test("a trailing comment does not bridge two standalone comment runs", () => {
  // Without the trailing-comment guard, lines 1-4 + the trailing comment on line 5
  // + line 6 would merge into a 6-line region and be falsely flagged.
  const src = ["// a", "// b", "// c", "// d", "someCode(); // trailing", "// f"].join("\n");
  expect(findLongComments(src)).toEqual([]);
});

test("still flags six whole-line comments with no intervening code", () => {
  const src = ["// 1", "// 2", "// 3", "// 4", "// 5", "// 6", "code();"].join("\n");
  expect(findLongComments(src)).toEqual([{ startLine: 1, endLine: 6 }]);
});

test("ignores comment tokens inside strings", () => {
  const src = [
    'const a = "/* not a comment */";',
    "const b = '// also not';",
    "const c = `/* still not",
    "a comment */`;",
    "const d = 1;",
    "const e = 2;",
    "const f = 3;",
  ].join("\n");
  expect(findLongComments(src)).toEqual([]);
});

test("handles escaped quotes inside strings without losing track", () => {
  const src = [
    'const s = "a \\" /* not */ b";',
    "/**",
    " * real",
    " * long",
    " * comment",
    " * here",
    " */",
  ].join("\n");
  expect(findLongComments(src)).toEqual([{ startLine: 2, endLine: 7 }]);
});

test("counts string line-continuations toward line numbers", () => {
  const src = ['const s = "a \\', 'b";', "x;", "y;", "/* c1", "c2", "c3", "c4", "c5", "c6 */"].join(
    "\n",
  );
  expect(findLongComments(src)).toEqual([{ startLine: 5, endLine: 10 }]);
});

test("parseLimit reads --limit, -n, -l and inline forms", () => {
  expect(parseLimit(["--limit", "3"])).toBe(3);
  expect(parseLimit(["-n", "7"])).toBe(7);
  expect(parseLimit(["-l=2"])).toBe(2);
  expect(parseLimit([])).toBeUndefined();
});

test("parseLimit rejects non-integer values", () => {
  expect(() => parseLimit(["--limit", "abc"])).toThrow();
  expect(() => parseLimit(["--limit", "-5"])).toThrow();
});
