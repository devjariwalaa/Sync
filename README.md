# SyncForge

SyncForge is a local-first collaborative text editor built to keep edits safe through network loss, concurrent changes, and reconnects. It uses an operation-based CRDT so multiple clients can edit independently and still arrive at the same document without overwriting each other.

[Live frontend demo](https://syncprojectum.vercel.app/) · [Protocol notes](docs/PROTOCOL.md) · [Testing record](docs/TESTING.md)

## What it does

- Synchronizes edits between browser tabs through WebSockets.
- Stores unsent changes in IndexedDB so editing continues offline.
- Replays queued operations after reconnecting and deduplicates retries.
- Persists committed operations in PostgreSQL before acknowledging them.
- Implements the CRDT independently in TypeScript and Go for differential testing.
- Shows active collaborators and a safe Markdown preview while edits remain local-first.
- Supports capability-protected private documents whose secret stays in the shared URL.

## Tech stack

TypeScript, Vite, IndexedDB, Service Workers, Go, PostgreSQL, WebSockets, Playwright, and Node's test runner.

## How it works

Each inserted character receives an immutable Lamport-based ID. Deletes create tombstones instead of removing history, and concurrent insertions use a deterministic ordering rule. Because every client applies the same set of immutable operations, delivery order and duplicate messages do not change the final text.

Local operations are written to IndexedDB before they are sent. The Go server validates each batch, commits it to PostgreSQL, and then returns an acknowledgement. If the connection drops before the acknowledgement arrives, the browser safely retries the same operations.

More detail is available in [the protocol notes](docs/PROTOCOL.md).

## Run locally

You will need Node.js 22.12 or newer and Go 1.25 or newer.

Install dependencies:

```bash
npm ci
```

Start the development PostgreSQL database in one terminal:

```bash
npm run db
```

Build and start SyncForge in another terminal:

```bash
npm run build
npm run server
```

Open [http://127.0.0.1:8080/?doc=my-notebook](http://127.0.0.1:8080/?doc=my-notebook) in two browser tabs. Use a different `doc` value to create another document.

To use an existing PostgreSQL database:

```bash
DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require' npm run server
```

## Tests

Start PostgreSQL, then run the complete suite:

```bash
npm test
```

The suite covers randomized CRDT convergence, TypeScript/Go differential checks, database atomicity, concurrent writers, WebSocket catch-up, offline replay, Unicode and IME input, large batches, and two-browser-tab convergence.

Individual checks are also available:

```bash
npm run test:unit
npm run test:go
npm run test:sync
npm run test:e2e
```

See [the testing record](docs/TESTING.md) for the scenarios exercised during development.

## Project structure

```text
src/core/          TypeScript CRDT
src/client/        IndexedDB persistence and sync client
internal/crdt/     Independent Go CRDT
internal/store/    PostgreSQL operation store
internal/server/   HTTP and WebSocket server
cmd/               Go entry points
tests/             TypeScript and browser tests
docs/              Protocol and verification notes
```

## Current scope

SyncForge is a portfolio-ready application. The collaborative workflow, offline queue, reconnect logic, persistence layer, live presence, Markdown formatting, and private document links are implemented. User accounts and destructive CRDT history compaction are outside the current scope; retained immutable history is what lets devices reconnect safely after an unlimited offline period.

The live Vercel demo serves the frontend and offline editor, so it intentionally displays an offline connection state. Running realtime collaboration requires the Go WebSocket server and PostgreSQL database described above.
