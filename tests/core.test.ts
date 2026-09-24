import { test } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./helpers/scenarios";
import { CRDT, type Op } from "../src/core/crdt";
test("middle edits, Unicode, delete before insertion, child before parent, duplicates", () => {
  const a = new CRDT("a");
  const initial = a.edit("a😀c");
  const edits = a.edit("a🦊bc");
  assert.equal(a.text(), "a🦊bc");
  const b = new CRDT("b");
  b.apply([...edits, ...initial].reverse());
  b.apply(initial);
  assert.equal(b.text(), a.text());
});
test("invalid batch is atomic and conflicting IDs rejected", () => {
  const a = new CRDT("a");
  const ops = a.edit("x");
  assert.throws(() =>
    a.apply([
      { kind: "insert", id: "2:b", after: "", value: "y" },
      { ...ops[0], value: "z" } as Op,
    ]),
  );
  assert.equal(a.text(), "x");
  assert.throws(() =>
    a.apply([{ kind: "insert", id: "2:a", after: "2:b", value: "x" }]),
  );
  assert.throws(() => a.edit("\ud800"));
});
test("200 seeded partition/reorder/duplicate/concurrent-edit convergence scenarios", () => {
  for (let seed = 1; seed <= 200; seed++) scenario(seed);
});
