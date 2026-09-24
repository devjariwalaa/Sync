# Protocol and correctness

## Operation model

An operation ID is `counter:actor`, where counter is a positive decimal integer of at most 15 digits and actor uses 1–64 ASCII letters, digits, hyphens or underscores. Each browser runtime generates a new random actor ID and advances its Lamport counter above every observed operation.

Insert: `{id, kind: "insert", after, value}`. Empty `after` is the root. `value` is one Unicode scalar. A referenced parent's clock must be strictly less than the insertion clock.

Delete: `{id, kind: "delete", target}`. The target's clock must be strictly less than the deletion clock. Deletion adds a tombstone; it does not remove descendants. Go serializes an empty `after` field on deletes as well; this has no semantic effect.

Sibling insertions are sorted by descending numeric counter, then descending ASCII ID. A depth-first traversal emits non-tombstoned scalars. Missing dependencies can arrive later. Strictly decreasing parent clocks exclude cycles. Equal IDs and equal payloads are idempotent; conflicting payloads are rejected atomically. Duplicate and out-of-order delivery do not affect the final text.

## Durable delivery

1. Local edits update the visible CRDT immediately.
2. One IndexedDB transaction saves immutable operations and outbox entries.
3. Only completed local transactions become eligible for transmission.
4. The client sends at most 500 operations in a batch and waits for an ACK before sending the next batch.
5. PostgreSQL locks the document row, validates/deduplicates the entire batch, assigns sequential document positions and commits.
6. Only after commit does the server acknowledge operation IDs.
7. The browser removes acknowledged IDs from its outbox, retaining the immutable operation history.

A disconnect at any stage is safe to retry. Lost ACKs cause duplicate delivery, not duplicate text. Existing operation IDs cannot be overwritten. Payload JSON is stored as TEXT so escaped U+0000 is preserved (PostgreSQL JSONB rejects that scalar).

## WebSocket messages

Connect to `/ws?doc=NAME&after=CURSOR`.

Client: `{type:"push", ops:[...]}`.

Server:

- `{type:"ops", entries:[{seq,op},...], cursor:N}`: ordered catch-up, at most 1000 entries per frame.
- `{type:"ready",cursor:N}`: catch-up has reached the current tail.
- `{type:"ack",ids:[...],cursor:0}`: those IDs committed; this is **not** a catch-up cursor.
- `{type:"error",error:"...",cursor:0}`: the batch was rejected and the outbox is retained.

Operation frames and their cursor are persisted atomically before the client advances its in-memory cursor. Acknowledgements do not advance cursors. Multiple tabs may share durable history; actor identities remain distinct. Cursor writes take the maximum within an IndexedDB transaction.

The server queries committed operations every 100 ms, and immediately after append. This avoids a subscribe/catch-up gap and works across backend instances without process-local broadcasting. Per-document row locking aligns sequence order with commit order; an early sequence cannot commit after a later one and be skipped.

## Editor consistency

Remote persistence is awaited **before** applying the operations and rendering synchronously. Thus a keystroke cannot diff stale visible text against unseen remote changes. During IME composition, remote application waits until the local composition has generated its operations. Caret positions are anchored to surviving character identities across remote renders.

## Offline application shell

The production build precaches hashed assets and `/`. It deliberately does not precache `/index.html`, because Go's static file server redirects that route; serving a redirected cached response can fail an offline navigation. Failed navigations return the cached root HTML. API/WebSocket requests are never intercepted. Service-worker caches are versioned and old caches removed on activation.
