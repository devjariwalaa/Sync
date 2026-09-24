/** RGA: descending Lamport sibling order; a tombstone never hides descendants. */
export type Op =
  | { id: string; kind: "insert"; after: string; value: string }
  | { id: string; kind: "delete"; target: string };
export const ROOT = "";
const pattern = /^([1-9][0-9]{0,14}):([a-zA-Z0-9_-]{1,64})$/;
export function clock(id: string): number {
  const m = pattern.exec(id);
  if (!m) throw new Error("Invalid operation ID");
  return Number(m[1]);
}
export function compare(a: string, b: string): number {
  const n = clock(a) - clock(b);
  return n || (a < b ? -1 : a > b ? 1 : 0);
}
export function validate(op: Op): void {
  if (!op || typeof op.id !== "string") throw new Error("Invalid operation");
  clock(op.id);
  if (op.kind === "insert") {
    if (
      typeof op.value !== "string" ||
      [...op.value].length !== 1 ||
      /[\uD800-\uDFFF]/u.test(op.value)
    )
      throw new Error("Insert must contain one Unicode scalar");
    if (
      typeof op.after !== "string" ||
      (op.after !== ROOT && clock(op.after) >= clock(op.id))
    )
      throw new Error("Parent must precede insertion");
  } else if (op.kind === "delete") {
    if (typeof op.target !== "string" || clock(op.target) >= clock(op.id))
      throw new Error("Target must precede deletion");
  } else throw new Error("Unknown operation");
}
export function equal(a: Op, b: Op): boolean {
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    (a.kind === "insert" && b.kind === "insert"
      ? a.after === b.after && a.value === b.value
      : a.kind === "delete" && b.kind === "delete" && a.target === b.target)
  );
}
export class CRDT {
  private ops = new Map<string, Op>();
  private time = 0;
  constructor(readonly actor: string) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(actor)) throw new Error("Invalid actor");
  }
  apply(batch: Op[]): void {
    const staged = new Map<string, Op>();
    for (const op of batch) {
      validate(op);
      const old = staged.get(op.id) ?? this.ops.get(op.id);
      if (old && !equal(old, op)) throw new Error("Conflicting operation ID");
      staged.set(op.id, op);
    }
    for (const [id, op] of staged) {
      this.ops.set(id, { ...op });
      this.time = Math.max(this.time, clock(id));
    }
  }
  all(): Op[] {
    return [...this.ops.values()].map((op) => ({ ...op }));
  }
  visible(): { id: string; value: string }[] {
    const children = new Map<string, Extract<Op, { kind: "insert" }>[]>();
    const deleted = new Set<string>();
    for (const op of this.ops.values())
      if (op.kind === "delete") deleted.add(op.target);
      else {
        const list = children.get(op.after) ?? [];
        list.push(op);
        children.set(op.after, list);
      }
    for (const list of children.values())
      list.sort((a, b) => compare(b.id, a.id));
    const stack = [...(children.get(ROOT) ?? [])].reverse();
    const out: { id: string; value: string }[] = [];
    while (stack.length) {
      const n = stack.pop()!;
      if (!deleted.has(n.id)) out.push({ id: n.id, value: n.value });
      const list = children.get(n.id) ?? [];
      for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
    }
    return out;
  }
  text(): string {
    return this.visible()
      .map((n) => n.value)
      .join("");
  }
  edit(next: string): Op[] {
    const old = this.visible(),
      chars = [...next];
    let start = 0,
      end = 0;
    while (
      start < old.length &&
      start < chars.length &&
      old[start].value === chars[start]
    )
      start++;
    while (
      end < old.length - start &&
      end < chars.length - start &&
      old[old.length - 1 - end].value === chars[chars.length - 1 - end]
    )
      end++;
    const batch: Op[] = [];
    const id = () => `${++this.time}:${this.actor}`;
    for (const n of old.slice(start, old.length - end))
      batch.push({ kind: "delete", id: id(), target: n.id });
    let after = start ? old[start - 1].id : ROOT;
    for (const value of chars.slice(start, chars.length - end)) {
      const op: Op = { kind: "insert", id: id(), after, value };
      batch.push(op);
      after = op.id;
    }
    this.apply(batch);
    return batch;
  }
}
