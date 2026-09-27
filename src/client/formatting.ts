/** Apply or remove Markdown while keeping the inner text selected for typing. */
export function formatSelection(
  text: string,
  start: number,
  end: number,
  marker: string,
  heading = false,
) {
  if (heading) {
    const line = text.lastIndexOf("\n", start - 1) + 1;
    const remove = text.slice(line).startsWith(marker);
    const delta = remove ? -marker.length : marker.length;
    return {
      text:
        text.slice(0, line) +
        (remove ? text.slice(line + marker.length) : marker + text.slice(line)),
      start: Math.max(line, start + delta),
      end: Math.max(line, end + delta),
    };
  }
  const wrapped =
    start >= marker.length &&
    text.slice(start - marker.length, start) === marker &&
    text.slice(end, end + marker.length) === marker;
  if (wrapped)
    return {
      text:
        text.slice(0, start - marker.length) +
        text.slice(start, end) +
        text.slice(end + marker.length),
      start: start - marker.length,
      end: end - marker.length,
    };
  return {
    text:
      text.slice(0, start) +
      marker +
      text.slice(start, end) +
      marker +
      text.slice(end),
    start: start + marker.length,
    end: end + marker.length,
  };
}
