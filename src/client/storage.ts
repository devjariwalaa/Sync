import type { Op } from "../core/crdt";
type Stored = { key: string; doc: string; op: Op };
export class LocalStore {
  private constructor(private db: IDBDatabase) {}
  static open(): Promise<LocalStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("syncforge-v1", 1);
      req.onupgradeneeded = () => {
        for (const name of ["ops", "outbox"]) {
          const s = req.result.createObjectStore(name, { keyPath: "key" });
          s.createIndex("doc", "doc");
        }
        req.result.createObjectStore("cursors");
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(new LocalStore(req.result));
    });
  }
  private transaction(
    names: string[],
    action: (tx: IDBTransaction) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(names, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Storage transaction aborted"));
      try {
        action(tx);
      } catch (e) {
        tx.abort();
        reject(e);
      }
    });
  }
  async load(
    doc: string,
  ): Promise<{ ops: Op[]; pending: Op[]; cursor: number }> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["ops", "outbox", "cursors"], "readonly");
      const ops = tx.objectStore("ops").index("doc").getAll(doc),
        pending = tx.objectStore("outbox").index("doc").getAll(doc),
        cursor = tx.objectStore("cursors").get(doc);
      tx.oncomplete = () =>
        resolve({
          ops: ops.result.map((r: Stored) => r.op),
          pending: pending.result.map((r: Stored) => r.op),
          cursor: cursor.result ?? 0,
        });
      tx.onerror = () => reject(tx.error);
    });
  }
  saveLocal(doc: string, ops: Op[]) {
    return this.transaction(["ops", "outbox"], (tx) => {
      for (const op of ops) {
        const row: Stored = { key: `${doc}/${op.id}`, doc, op };
        tx.objectStore("ops").put(row);
        tx.objectStore("outbox").put(row);
      }
    });
  }
  saveRemote(doc: string, ops: Op[], cursor: number) {
    return this.transaction(["ops", "cursors"], (tx) => {
      for (const op of ops)
        tx.objectStore("ops").put({ key: `${doc}/${op.id}`, doc, op });
      const store = tx.objectStore("cursors");
      const request = store.get(doc);
      request.onsuccess = () =>
        store.put(Math.max(request.result ?? 0, cursor), doc);
    });
  }
  acknowledge(doc: string, ids: string[]) {
    return this.transaction(["outbox"], (tx) => {
      for (const id of ids) tx.objectStore("outbox").delete(`${doc}/${id}`);
    });
  }
}
