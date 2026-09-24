import { CRDT, type Op } from "../core/crdt";
import { LocalStore } from "./storage";
export type Status = {
  connection: "connecting" | "online" | "offline" | "error";
  pending: number;
  cursor: number;
  error?: string;
};
export type Collaborator = { client: string; name: string };
type Callbacks = {
  change: () => void;
  status: (s: Status) => void;
  presence?: (users: Collaborator[]) => void;
};
export class SyncClient {
  readonly clientId = crypto.randomUUID();
  readonly crdt = new CRDT(this.clientId);
  private stopped = false;
  private online = () => this.connect();
  private offline = () => this.disconnect();
  private composition: Promise<void> = Promise.resolve();
  private releaseComposition?: () => void;
  private storage!: LocalStore;
  private pending = new Map<string, Op>();
  private durable = new Set<string>();
  private cursor = 0;
  private ws?: WebSocket;
  private queue: Promise<void> = Promise.resolve();
  private ready = false;
  private inFlight = false;
  private retry = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private connection: Status["connection"] = "connecting";
  private error?: string;
  private manuallyOffline = false;
  constructor(readonly doc: string, private callbacks: Callbacks, private key = "") {}
  private displayName() {
    const storage = globalThis.localStorage;
    let name = storage?.getItem("syncforge-name");
    if (!name) {
      name = `Guest ${this.clientId.slice(0, 4).toUpperCase()}`;
      storage?.setItem("syncforge-name", name);
    }
    return name.slice(0, 40);
  }
  async start() {
    this.storage = await LocalStore.open();
    const state = await this.storage.load(this.doc);
    this.crdt.apply(state.ops);
    for (const op of state.pending) {
      this.pending.set(op.id, op);
      this.durable.add(op.id);
    }
    this.cursor = state.cursor;
    this.manuallyOffline =
      sessionStorage.getItem(`offline:${this.doc}`) === "true";
    this.callbacks.change();
    window.addEventListener("online", this.online);
    window.addEventListener("offline", this.offline);
    this.connect();
  }
  stop() {
    this.stopped = true;
    window.removeEventListener("online", this.online);
    window.removeEventListener("offline", this.offline);
    this.disconnect();
  }
  beginComposition() {
    this.composition = new Promise((resolve) => {
      this.releaseComposition = resolve;
    });
  }
  endComposition() {
    this.releaseComposition?.();
    this.releaseComposition = undefined;
  }
  edit(text: string) {
    if (this.error) throw Error(this.error);
    const ops = this.crdt.edit(text);
    if (!ops.length) return;
    for (const op of ops) this.pending.set(op.id, op);
    this.notify();
    this.enqueue(async () => {
      await this.storage.saveLocal(this.doc, ops);
      for (const op of ops) this.durable.add(op.id);
      this.notify();
      this.flush();
    });
  }
  setOffline(value: boolean) {
    this.manuallyOffline = value;
    sessionStorage.setItem(`offline:${this.doc}`, String(value));
    if (value) this.disconnect();
    else this.connect();
  }
  isOffline() {
    return this.manuallyOffline;
  }
  private notify() {
    this.callbacks.status({
      connection: this.connection,
      pending: this.pending.size,
      cursor: this.cursor,
      error: this.error,
    });
  }
  private fail(e: unknown) {
    this.error = e instanceof Error ? e.message : String(e);
    this.connection = "error";
    this.ws?.close();
    this.notify();
  }
  private enqueue(action: () => Promise<void>) {
    this.queue = this.queue.then(action).catch((e) => this.fail(e));
  }
  private disconnect() {
    clearTimeout(this.timer);
    const old = this.ws;
    this.ws = undefined;
    old?.close();
    this.ready = false;
    this.inFlight = false;
    this.connection = this.error ? "error" : "offline";
    this.notify();
  }
  private connect() {
    if (this.stopped || this.error) return;
    if (this.manuallyOffline || !navigator.onLine) {
      this.disconnect();
      return;
    }
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    clearTimeout(this.timer);
    this.connection = "connecting";
    this.notify();
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${scheme}//${location.host}/ws?doc=${encodeURIComponent(this.doc)}&after=${this.cursor}&client=${encodeURIComponent(this.clientId)}&name=${encodeURIComponent(this.displayName())}&key=${encodeURIComponent(this.key)}`,
    );
    this.ws = ws;
    this.ready = false;
    this.inFlight = false;
    ws.onmessage = (event) =>
      this.enqueue(async () => {
        await this.composition;
        if (this.ws !== ws) return;
        const m = JSON.parse(event.data);
        if (m.type === "ops") {
          const ops: Op[] = m.entries.map((e: { op: Op }) => e.op);
          await this.storage.saveRemote(this.doc, ops, m.cursor);
          await this.composition;
          this.crdt.apply(ops);
          this.cursor = m.cursor;
          this.callbacks.change();
        } else if (m.type === "ack") {
          await this.storage.acknowledge(this.doc, m.ids);
          for (const id of m.ids) {
            this.pending.delete(id);
            this.durable.delete(id);
          }
          this.inFlight = false;
        } else if (m.type === "ready") {
          this.ready = true;
          this.retry = 0;
          this.connection = "online";
        } else if (m.type === "presence") {
          this.callbacks.presence?.(m.users);
        } else if (m.type === "error") {
          throw Error(m.error);
        }
        this.notify();
        this.flush();
      });
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.ready = false;
      this.inFlight = false;
      this.connection = this.error ? "error" : "offline";
      this.notify();
      if (!this.stopped && !this.manuallyOffline && !this.error)
        this.timer = setTimeout(
          () => this.connect(),
          Math.min(5000, 250 * 2 ** Math.min(this.retry++, 5)) +
            Math.random() * 100,
        );
    };
    ws.onerror = () => ws.close();
  }
  private flush() {
    if (
      !this.ready ||
      this.inFlight ||
      this.ws?.readyState !== WebSocket.OPEN ||
      this.error
    )
      return;
    const batch = [...this.pending.values()]
      .filter((op) => this.durable.has(op.id))
      .slice(0, 500);
    if (!batch.length) return;
    this.inFlight = true;
    this.ws.send(JSON.stringify({ type: "push", ops: batch }));
  }
}
