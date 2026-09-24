import assert from "node:assert/strict";
import { CRDT, type Op } from "../../src/core/crdt";
export function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
export function scenario(seed: number) {
  const rand = random(seed);
  const replicas = [new CRDT("a"), new CRDT("b"), new CRDT("c")];
  const log: Op[] = [];
  for (let i = 0; i < 120; i++) {
    const r = replicas[Math.floor(rand() * 3)];
    if (rand() < 0.3) r.apply(log.filter(() => rand() < 0.5));
    const chars = [...r.text()];
    const pos = Math.floor(rand() * (chars.length + 1));
    if (rand() < 0.35 && chars.length)
      chars.splice(Math.min(pos, chars.length - 1), 1);
    else chars.splice(pos, 0, ["x", "y", "😀", "\n"][Math.floor(rand() * 4)]);
    log.push(...r.edit(chars.join("")));
  }
  for (const r of replicas) {
    const shuffled = [...log, ...log.slice(0, 20)];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    r.apply(shuffled);
  }
  assert.equal(replicas[0].text(), replicas[1].text());
  assert.equal(replicas[1].text(), replicas[2].text());
  return { ops: log, text: replicas[0].text() };
}
