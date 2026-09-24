import { SyncClient, type Collaborator, type Status } from "./client/sync";
import { renderMarkdown } from "./client/markdown";
import "./style.css";
const query = new URLSearchParams(location.search);
const doc = query.get("doc") ?? "welcome";
const accessKey = query.get("key") ?? "";
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(doc)) {
  document.querySelector("#app")!.textContent =
    "Invalid document link. Use a document name with 1–80 letters, numbers, underscores or hyphens.";
  throw Error("Invalid document ID");
}
document.querySelector("#app")!.innerHTML = `
<aside class="sidebar"><a class="brand" href="/"> <span class="brandmark">S<span>↗</span></span> SyncForge</a><div class="workspace">PERSONAL WORKSPACE <span>⌘</span></div><nav><a class="active" href="?doc=${doc}"><span>▤</span> Shared notebook <span class="nav-dot"></span></a><button id="new-private" class="new-document">＋ Private document</button></nav><div class="sidebar-bottom"><div class="local-icon">↔</div><strong>Your ideas travel with you.</strong><p>Keep writing, even offline.<br>We’ll bring everything together.</p><span class="build-tag">LOCAL-FIRST · V1.0</span></div></aside>
<main><header><div class="breadcrumb">Workspace <span>/</span> Shared notebook</div><div class="header-right"><div id="presence" class="presence" aria-label="Active collaborators"></div><span id="connection" class="connection">Connecting</span><button id="share" class="button">Copy document link <span>↗</span></button></div></header>
<div class="document-shell"><div class="eyebrow"><span class="tiny-square"></span> A SHARED SPACE FOR IDEAS</div><div class="title-row"><h1>Shared notebook<span>.</span></h1><span class="doc-symbol">✳</span></div><div class="document-meta"><span id="document-id"></span><span class="separator">·</span><span>Plain text, endless possibilities</span></div>
<div class="toolbar"><div class="format-tools"><button type="button" data-wrap="**" aria-label="Bold"><b>B</b></button><button type="button" data-wrap="_" aria-label="Italic"><i>I</i></button><button type="button" data-prefix="# " aria-label="Heading">H</button><button id="preview-toggle" type="button">Preview</button></div><div class="toolbar-right"><span id="saved" role="status">Opening local notebook…</span><span class="lock">◇</span></div></div>
<label class="sr-only" for="editor">Document content</label><textarea id="editor" spellcheck="false" placeholder="Start with a thought. Build on it together.\n\nOpen this document in another tab to write side by side." disabled></textarea>
<article id="preview" class="preview" hidden></article>
<footer class="editor-footer"><span><span id="words">0 words</span><span class="separator">·</span><span id="characters">0 characters</span></span><span>MADE FOR WORKING TOGETHER</span></footer>
<div class="sync-card"><div class="sync-icon">⇄</div><div class="sync-copy"><strong id="sync-title">Everything, in sync.</strong><p id="sync-detail">Edits are saved on this device and shared when connected.</p></div><button id="toggle" class="button secondary">Go offline <span>↗</span></button></div><p class="hint">Try it out: open this link in two tabs. Go offline in one, edit in both, then reconnect.</p><div id="error" role="alert" hidden></div></div></main>`;
document.querySelector("#document-id")!.textContent = `Document / ${doc}`;
const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;
const preview = document.querySelector<HTMLElement>("#preview")!;
const previewToggle = document.querySelector<HTMLButtonElement>("#preview-toggle")!;
let rendered: { id: string; value: string }[] = [];
let composing = false;
let deferred = false;
function counts() {
  const text = editor.value;
  document.querySelector("#words")!.textContent =
    `${text.trim() ? text.trim().split(/\s+/u).length : 0} words`;
  document.querySelector("#characters")!.textContent =
    `${[...text].length} characters`;
}
function updatePreview() { preview.innerHTML = renderMarkdown(editor.value); }
function showPresence(users: Collaborator[]) {
  const holder = document.querySelector("#presence")!;
  holder.innerHTML = "";
  for (const user of users.slice(0, 4)) {
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = user.name.trim().slice(0, 1).toUpperCase() || "?";
    avatar.title = user.client === client.clientId ? `${user.name} (you)` : user.name;
    holder.append(avatar);
  }
  if (users.length > 4) holder.append(`+${users.length - 4}`);
}
// Anchor the selection to character identities so remote insertions do not move
// the caret to an unrelated position. Deleted anchors fall back to prior survivors.
function render() {
  if (composing) {
    deferred = true;
    return;
  }
  const old = rendered;
  const next = client.crdt.visible();
  const mapOffset = (offset: number) => {
    let units = 0,
      index = 0;
    while (index < old.length && units < offset) {
      units += old[index].value.length;
      index++;
    }
    for (let i = index - 1; i >= 0; i--) {
      const at = next.findIndex((n) => n.id === old[i].id);
      if (at >= 0)
        return next.slice(0, at + 1).reduce((s, n) => s + n.value.length, 0);
    }
    return 0;
  };
  const start = mapOffset(editor.selectionStart),
    end = mapOffset(editor.selectionEnd);
  const focused = document.activeElement === editor;
  const direction = editor.selectionDirection;
  editor.value = next.map((n) => n.value).join("");
  if (focused) editor.setSelectionRange(start, end, direction);
  rendered = next;
  counts();
  updatePreview();
}
function status(s: Status) {
  const badge = document.querySelector("#connection")!;
  badge.textContent =
    s.connection === "online"
      ? "Live sync"
      : s.connection === "connecting"
        ? "Connecting"
        : s.connection === "error"
          ? "Needs attention"
          : "Offline";
  badge.className = `connection ${s.connection}`;
  document.querySelector("#saved")!.textContent = s.pending
    ? `${s.pending} pending edit${s.pending === 1 ? "" : "s"}`
    : s.connection === "online"
      ? "All changes synced"
      : "Saved on this device";
  document.querySelector("#sync-title")!.textContent =
    s.connection === "online"
      ? "Everything, in sync."
      : "Your ideas don’t need a connection.";
  document.querySelector("#sync-detail")!.textContent = s.pending
    ? "Your pending edits will sync automatically when connected."
    : "Edits are saved on this device and shared when connected.";
  toggle.textContent = client.isOffline() ? "Reconnect ↗" : "Go offline ↗";
  if (s.error) {
    const box = document.querySelector<HTMLElement>("#error")!;
    box.hidden = false;
    box.textContent = `Sync stopped: ${s.error}. Keep this tab open and copy your text before reloading.`;
    editor.disabled = true;
  }
}
const client = new SyncClient(doc, { change: render, status, presence: showPresence }, accessKey);
function edit() {
  try {
    client.edit(editor.value);
    rendered = client.crdt.visible();
    counts();
  } catch (e) {
    document.querySelector<HTMLElement>("#error")!.hidden = false;
    document.querySelector("#error")!.textContent = String(e);
  }
}
document.querySelectorAll<HTMLButtonElement>("[data-wrap], [data-prefix]").forEach((button) =>
  button.addEventListener("click", () => {
    const start = editor.selectionStart, end = editor.selectionEnd;
    const wrap = button.dataset.wrap;
    const prefix = button.dataset.prefix;
    editor.setRangeText(wrap ? `${wrap}${editor.value.slice(start, end)}${wrap}` : `${prefix}${editor.value.slice(start, end)}`, start, end, "end");
    edit(); editor.focus();
  }),
);
previewToggle.addEventListener("click", () => {
  const showing = preview.hidden;
  preview.hidden = !showing; editor.hidden = showing;
  previewToggle.textContent = showing ? "Edit" : "Preview";
  if (showing) updatePreview();
});
editor.addEventListener("input", () => {
  if (!composing) edit();
});
editor.addEventListener("compositionstart", () => {
  composing = true;
  client.beginComposition();
});
editor.addEventListener("compositionend", () => {
  composing = false;
  edit();
  client.endComposition();
  if (deferred) {
    deferred = false;
    render();
  }
});
toggle.addEventListener("click", () => client.setOffline(!client.isOffline()));
document.querySelector("#share")!.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    document.querySelector("#share")!.textContent = "Link copied ✓";
  } catch {
    document.querySelector("#share")!.textContent = "Copy the address bar link";
  }
});
document.querySelector("#new-private")!.addEventListener("click", async () => {
  const id = prompt("Name your private document", `notes-${crypto.randomUUID().slice(0, 6)}`)?.trim();
  if (!id) return;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) { alert("Use letters, numbers, underscores, or hyphens."); return; }
  const response = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  if (!response.ok) { alert(await response.text()); return; }
  const created = await response.json();
  location.href = `/?doc=${encodeURIComponent(created.id)}&key=${encodeURIComponent(created.key)}`;
});
client
  .start()
  .then(() => {
    editor.disabled = false;
  })
  .catch((e) => {
    document.querySelector<HTMLElement>("#error")!.hidden = false;
    document.querySelector("#error")!.textContent =
      `Cannot open local storage: ${e}`;
  });
if (import.meta.env.PROD && "serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(console.error);
