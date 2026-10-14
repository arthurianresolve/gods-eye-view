/** Update a DOM text node only when the rendered value actually changed. */
export function setTextIfChanged(node, value) {
  if (!node) return false;
  const next = String(value ?? '');
  if (node.textContent === next) return false;
  node.textContent = next;
  return true;
}
