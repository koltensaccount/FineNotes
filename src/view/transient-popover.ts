/** One transient tool popup per document; persistent panels and modals stay independent. */
const active = new WeakMap<Document, {owner: object; close: () => void}>();
export function claimTransient(doc: Document, owner: object, close: () => void): () => void {
  const previous = active.get(doc);
  if (previous && previous.owner !== owner) previous.close();
  active.set(doc, {owner, close});
  return () => {if (active.get(doc)?.owner === owner) active.delete(doc);};
}
export function presetActivation(selected: string | null, id: string, editor: string | null): "select" | "open" | "close" {
  if (selected !== id) return "select";
  if (editor === id) return "close";
  if (editor !== null) return "select";
  return "open";
}

export function dismissTransient(doc: Document): void { active.get(doc)?.close(); }
