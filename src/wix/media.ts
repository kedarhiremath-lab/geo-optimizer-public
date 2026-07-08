// Image/media preservation — carry the original post's inline media into the
// optimized draft so the rewrite doesn't strip figures, photos, videos, or file
// attachments.
//
// Wix stores a blog post's inline media as top-level Ricos nodes (IMAGE, VIDEO,
// GALLERY, FILE, EMBED, GIF, AUDIO) that reference already-uploaded Wix media by
// id. We fetch the original richContent, lift those nodes out verbatim (so the
// media refs keep working — no re-upload), and interleave them through the
// optimized body across its section headings, in original order.
//
// The post's COVER image lives in a separate `media` field, not richContent — the
// update call never touches it, so the hero image is preserved automatically.

import type { RicosDocument, RicosNode } from "./ricos.js";

const MEDIA_TYPES = new Set(["IMAGE", "VIDEO", "GALLERY", "FILE", "EMBED", "GIF", "AUDIO"]);

/** Top-level media nodes from a Ricos document, in document order. */
export function extractMediaNodes(doc: RicosDocument | undefined): RicosNode[] {
  if (!doc?.nodes) return [];
  return doc.nodes.filter((n) => MEDIA_TYPES.has(n.type));
}

/** Deep-clone a node, assigning fresh ids to every non-TEXT node (avoids id collisions). */
function cloneWithNewIds(node: RicosNode, gen: () => string): RicosNode {
  const clone: RicosNode = JSON.parse(JSON.stringify(node));
  const walk = (n: RicosNode) => {
    if (n.type !== "TEXT" && typeof n.id === "string") n.id = gen();
    if (Array.isArray(n.nodes)) n.nodes.forEach(walk);
  };
  walk(clone);
  return clone;
}

/**
 * Interleave preserved media through the optimized document, spread evenly across
 * its top-level headings (in original media order). Returns a new document.
 */
export function interleaveMedia(
  optimized: RicosDocument,
  mediaNodes: RicosNode[],
  idPrefix = "media",
): RicosDocument {
  if (mediaNodes.length === 0) return optimized;

  let counter = 0;
  const gen = () => `${idPrefix}-${(counter++).toString(36)}`;
  const media = mediaNodes.map((m) => cloneWithNewIds(m, gen));

  const nodes = optimized.nodes;
  const headingIdxs = nodes.map((n, i) => (n.type === "HEADING" ? i : -1)).filter((i) => i >= 0);

  // No headings to anchor to → append media at the end.
  if (headingIdxs.length === 0) {
    return { ...optimized, nodes: [...nodes, ...media] };
  }

  // Map each media item to a heading anchor, spread evenly, and group by anchor.
  const H = headingIdxs.length;
  const N = media.length;
  const byAnchor = new Map<number, RicosNode[]>();
  media.forEach((m, i) => {
    const pos = Math.min(Math.max(Math.round(((i + 0.5) * H) / N), 0), H - 1);
    const anchor = headingIdxs[pos];
    if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
    byAnchor.get(anchor)!.push(m);
  });

  // Rebuild, inserting each anchor's media just before that heading.
  const out: RicosNode[] = [];
  nodes.forEach((n, i) => {
    if (byAnchor.has(i)) out.push(...byAnchor.get(i)!);
    out.push(n);
  });
  return { ...optimized, nodes: out };
}
