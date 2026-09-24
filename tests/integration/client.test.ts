import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncClient, type Status } from "../../src/client/sync";
import { LocalStore } from "../../src/client/storage";
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "window", { value: new EventTarget() });
Object.defineProperty(globalThis, "location", {
  value: new URL(process.env.TEST_BASE_URL ?? "http://127.0.0.1:8080"),
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
  },
});
Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 15000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw Error("Timed out waiting for convergence");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
function replica(doc: string) {
  let status: Status = { connection: "connecting", pending: 0, cursor: 0 };
  const client = new SyncClient(doc, {
    change: () => {},
    status: (s) => {
      status = s;
    },
  });
  return {
    client,
    get status() {
      if (status.error) throw Error(status.error);
      return status;
    },
  };
}
test("real WebSocket: offline durable reload, concurrent edits, catch-up and backend persistence", async () => {
  const doc = "client-" + crypto.randomUUID(),
    a = replica(doc);
  let b = replica(doc);
  try {
    await a.client.start();
    await b.client.start();
    await until(
      () =>
        a.status.connection === "online" && b.status.connection === "online",
    );
    a.client.edit("Base");
    await until(
      () => b.client.crdt.text() === "Base" && a.status.pending === 0,
    );
    b.client.setOffline(true);
    b.client.edit("Base OFFLINE😀");
    a.client.edit("Base ONLINE");
    await until(() => a.status.pending === 0);
    const store = await LocalStore.open();
    await until(async () => (await store.load(doc)).pending.length > 0);
    b.client.stop();
    b = replica(doc);
    await b.client.start();
    assert.ok(b.client.crdt.text().includes("OFFLINE😀"));
    b.client.setOffline(false);
    await until(
      () =>
        b.status.pending === 0 && a.client.crdt.text() === b.client.crdt.text(),
    );
    assert.ok(a.client.crdt.text().includes("ONLINE"));
    assert.ok(a.client.crdt.text().includes("OFFLINE😀"));
    const c = replica(doc);
    try {
      await c.client.start();
      await until(() => c.status.connection === "online");
      assert.equal(c.client.crdt.text(), a.client.crdt.text());
    } finally {
      c.client.stop();
    }
  } finally {
    a.client.stop();
    b.client.stop();
  }
});
test("IME gate prevents remote application from replacing uncommitted composition", async () => {
  const doc = "ime-" + crypto.randomUUID(),
    a = replica(doc),
    b = replica(doc);
  try {
    await a.client.start();
    await b.client.start();
    await until(
      () =>
        a.status.connection === "online" && b.status.connection === "online",
    );
    a.client.edit("base");
    await until(() => b.client.crdt.text() === "base");
    b.client.beginComposition();
    a.client.edit("base remote");
    await until(() => a.status.pending === 0);
    assert.equal(b.client.crdt.text(), "base");
    b.client.edit("base漢");
    b.client.endComposition();
    await until(
      () =>
        b.status.pending === 0 && a.client.crdt.text() === b.client.crdt.text(),
    );
    assert.ok(a.client.crdt.text().includes("漢"));
    assert.ok(a.client.crdt.text().includes("remote"));
  } finally {
    a.client.stop();
    b.client.endComposition();
    b.client.stop();
  }
});
test("batching >1000 operations + offline delete versus concurrent insertion", async () => {
  const doc = "batch-" + crypto.randomUUID(),
    a = replica(doc),
    b = replica(doc);
  try {
    await a.client.start();
    await b.client.start();
    await until(
      () =>
        a.status.connection === "online" && b.status.connection === "online",
    );
    a.client.edit("x".repeat(1200) + "abc");
    await until(
      () =>
        a.status.pending === 0 && b.client.crdt.text() === a.client.crdt.text(),
    );
    b.client.setOffline(true);
    b.client.edit("x".repeat(1200) + "ac");
    a.client.edit("x".repeat(1200) + "abZc");
    await until(() => a.status.pending === 0);
    b.client.setOffline(false);
    await until(
      () =>
        b.status.pending === 0 && b.client.crdt.text() === a.client.crdt.text(),
    );
    assert.equal(a.client.crdt.text(), "x".repeat(1200) + "aZc");
  } finally {
    a.client.stop();
    b.client.stop();
  }
});

test("all Unicode scalars including escaped NUL persist through PostgreSQL", async () => {
  const a = replica("unicode-" + crypto.randomUUID());
  try {
    await a.client.start();
    await until(() => a.status.connection === "online");
    a.client.edit("a\0😀b");
    await until(() => a.status.pending === 0);
    const b = replica(a.client.doc);
    try {
      await b.client.start();
      await until(() => b.status.connection === "online");
      assert.equal(b.client.crdt.text(), "a\0😀b");
    } finally {
      b.client.stop();
    }
  } finally {
    a.client.stop();
  }
});
