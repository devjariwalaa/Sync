import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalStore } from "../src/client/storage";
import { CRDT } from "../src/core/crdt";
test("durable offline queue survives reopen; ack keeps history; cursors never regress", async () => {
  const doc = crypto.randomUUID(),
    s = await LocalStore.open(),
    a = new CRDT("a"),
    ops = a.edit("offline😀");
  await s.saveLocal(doc, ops);
  const reopened = await LocalStore.open();
  let state = await reopened.load(doc);
  assert.equal(state.pending.length, 8);
  const b = new CRDT("b");
  b.apply(state.ops);
  assert.equal(b.text(), "offline😀");
  await reopened.saveRemote(doc, ops, 8);
  await s.saveRemote(doc, ops.slice(0, 1), 1);
  assert.equal((await s.load(doc)).cursor, 8);
  await s.acknowledge(
    doc,
    ops.map((o) => o.id),
  );
  state = await reopened.load(doc);
  assert.equal(state.pending.length, 0);
  assert.equal(state.ops.length, 8);
});
test("two tab stores retain both offline queues and isolate documents", async () => {
  const doc = crypto.randomUUID(),
    a = await LocalStore.open(),
    b = await LocalStore.open();
  const x = new CRDT("x").edit("x"),
    y = new CRDT("y").edit("y");
  await Promise.all([a.saveLocal(doc, x), b.saveLocal(doc, y)]);
  const state = await a.load(doc);
  assert.equal(state.pending.length, 2);
  assert.equal(state.ops.length, 2);
  assert.equal((await a.load(doc + "-other")).ops.length, 0);
});
