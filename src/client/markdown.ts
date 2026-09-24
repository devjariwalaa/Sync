const escapeHTML = (value: string) =>
  value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

function inline(value: string): string {
  return escapeHTML(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function renderMarkdown(source: string): string {
  const lines = source.split("\n");
  const output: string[] = [];
  let inCode = false;
  let inList = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inList) { output.push("</ul>"); inList = false; }
      output.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { output.push(`${escapeHTML(line)}\n`); continue; }
    const list = /^[-*] (.*)$/.exec(line);
    if (list) {
      if (!inList) { output.push("<ul>"); inList = true; }
      output.push(`<li>${inline(list[1])}</li>`);
      continue;
    }
    if (inList) { output.push("</ul>"); inList = false; }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    else if (/^> /.test(line)) output.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    else if (line) output.push(`<p>${inline(line)}</p>`);
    else output.push("<br>");
  }
  if (inList) output.push("</ul>");
  if (inCode) output.push("</code></pre>");
  return output.join("");
}
