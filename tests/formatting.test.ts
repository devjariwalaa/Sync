import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSelection } from "../src/client/formatting";
import { renderMarkdown } from "../src/client/markdown";
test("bold selection renders immediately and toggles off without lost text", () => {
  const b = formatSelection("hello world", 6, 11, "**");
  assert.equal(b.text, "hello **world**");
  assert.match(renderMarkdown(b.text), /<strong>world<\/strong>/);
  assert.deepEqual(formatSelection(b.text, b.start, b.end, "**"), {
    text: "hello world",
    start: 6,
    end: 11,
  });
});
test("empty italic selection leaves caret inside markers for the next keystroke", () => {
  const b = formatSelection("hello ", 6, 6, "_");
  assert.equal(b.start, 7);
  assert.equal(b.end, 7);
  assert.match(
    renderMarkdown(b.text.slice(0, b.start) + "world" + b.text.slice(b.end)),
    /<em>world<\/em>/,
  );
});
test("heading applies to start of current line and toggles", () => {
  const b = formatSelection("first\nsecond", 9, 9, "# ", true);
  assert.equal(b.text, "first\n# second");
  assert.equal(
    formatSelection(b.text, b.start, b.end, "# ", true).text,
    "first\nsecond",
  );
});
