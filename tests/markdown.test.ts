import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/client/markdown";

test("Markdown preview renders formatting and escapes executable HTML", () => {
  const html = renderMarkdown("# Hello\n\n**bold** _kind_ `code`\n- one\n- two\n<script>alert(1)</script>");
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>kind<\/em>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("Markdown preview permits web links but not script URLs", () => {
  const html = renderMarkdown("[safe](https://example.com) [bad](javascript:alert(1))");
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /href="javascript:/);
});
