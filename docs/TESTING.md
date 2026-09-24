# Verification record

The completion pass also covers safe Markdown rendering, collaborator identity validation, private-document authorization, and a manual two-tab presence, formatting, offline-concurrency, and reconnect acceptance run in Chrome.

This report distinguishes passing checks from checks blocked by the desktop execution environment.

## Passed

- TypeScript unit suite: 8 tests, including 200 seeded three-replica partition/reorder/duplicate/concurrent-edit histories and safe Markdown rendering.
- Independent Go differential comparison: 100 additional randomized TypeScript histories replayed in reverse delivery order by the Go reference.
- Go CRDT: 500 permutations, atomic conflict rejection, and a 20,000-node chain (iterative traversal).
- Go PostgreSQL store tests with `-race`: durable reread, idempotence, conflicting-batch rollback, private-document authorization, and 50 concurrent writers with contiguous committed sequence numbers.
- Go WebSocket test with `-race`: commit-before-ACK, broadcast/catch-up, reconnect replay, duplicates, conflicts and document isolation.
- Four real-WebSocket TypeScript client integration tests: offline durable reload/concurrency; IME composition; 1200+ operations and deletion versus concurrent insertion; full Unicode including escaped NUL.
- Strict TypeScript checking and production build.
- `go vet ./...`.
- Connected browser two-tab acceptance: initial `Shared start.`, offline tab appends ` OFFLINE😀`, online tab appends ` ONLINE`; after offline reload and reconnect both show `Shared start. ONLINE OFFLINE😀`, with no pending edits.
- Final two-tab Chrome acceptance also passed: `Together` plus concurrent ` ONLINE` and ` OFFLINE` became exactly `Together ONLINE OFFLINE` in both tabs, with both reporting all changes synced.
- Connected browser deletion acceptance: `abc`; offline deletion of `b` versus online insertion of `X` after `b`; both converge to `aXc`.
- Real Chrome outage/reload: stopped the Go server, edited the document, reloaded Chrome from the service-worker cache, retained the exact text and 16 pending operations; after server restart it returned to “All changes synced” without losing text.
- Completion Chrome acceptance: two collaborator avatars appeared; one tab edited offline while the other edited online; reconnect produced the same 80-character document in both tabs with no pending edits; Markdown preview rendered the synchronized heading and bold text.

The database-dependent passing tests above used the persistent PGlite PostgreSQL engine over TCP, with the same Go store and WebSocket implementation. They are not a substitute for native PostgreSQL concurrent-session verification.

## Blocked in this environment

- Native PostgreSQL 17 launcher: macOS sandbox denies `shmget` during `initdb`. No native database tests could run here. `npm run db` should be run in a normal terminal.
- Full `npm test` was invoked. Unit, Go race, build and client integration stages passed against PGlite. All five Playwright test cases failed **during Chrome launch, before executing assertions**, with sandbox process errors (`SIGABRT`/`EPERM`). Their assertion results are unknown. Browser acceptance was therefore also performed through the connected browser tooling.
- Automated mobile viewport assertions remain unverified because the headless browser could not launch.

The full run log is in `work/full-test.log` and Playwright outputs are in `playwright-report/` and `test-results/` (ignored generated files).

## Correctness defects found and fixed during testing

- Unseen remote state could be applied before its editor render. Remote persistence/application order now keeps state and visible text synchronized.
- IME composition could overwrite a remote edit. Remote application is gated through composition completion.
- Empty root insertion anchors disappeared during Go JSON serialization. The anchor field now remains present.
- Prepared-statement collisions in PGlite's multiplexed fallback: its connection string selects simple query protocol. Native PostgreSQL retains the normal pgx default.
- JSON payload parameters are transmitted as JSON text, preserving compatibility with both protocol modes.
- PostgreSQL JSONB cannot store escaped NUL. Payloads are opaque JSON TEXT, validated by the Go CRDT before persistence.
- Offline navigation failed when using a cached redirected `/index.html` response. The worker now precaches the non-redirected `/` response; Chrome outage/reload retest passed.

## Run the unblocked full suite locally

From a normal VS Code terminal:

```sh
cd /Users/devjariwala/Downloads/Sync
npm run db
```

Leave the database running. In a second normal terminal:

```sh
cd /Users/devjariwala/Downloads/Sync
npm test
```

Do not set the sandbox `DATABASE_URL` if validating native PostgreSQL. The tests start an isolated Go backend on port 8087. Chrome must be installed. All five browser cases should execute their assertions; a browser-launch failure is not a passing acceptance test.
