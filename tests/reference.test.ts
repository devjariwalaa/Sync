import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { scenario } from "./helpers/scenarios";
test("independent Go reference agrees on 100 randomized TS histories", () => {
  const cases = Array.from({ length: 100 }, (_, i) => scenario(i + 701));
  const actual = JSON.parse(
    execFileSync("./scripts/go.sh", ["run", "./cmd/reference"], {
      input: JSON.stringify(cases.map((c) => ({ ops: [...c.ops].reverse() }))),
      maxBuffer: 16 * 1024 * 1024,
    }).toString(),
  );
  assert.deepEqual(
    actual,
    cases.map((c) => c.text),
  );
});
