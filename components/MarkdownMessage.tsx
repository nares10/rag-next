"use client";

import MarkdownIt from "markdown-it";
import DOMPurify from "isomorphic-dompurify";
import type { Citation } from "@/lib/chat-types";

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
});

interface MarkdownMessageProps {
  text: string;
  citations?: Citation[];
  /** Pointer or focus reached an inline `[n]` chip; null when it left. */
  onCitationHover?: (citation: Citation | null, anchor: DOMRect | null) => void;
  onCitationClick?: (citation: Citation) => void;
}

/**
 * Turns the model's `[n]` markers into chips that name their source.
 *
 * Walks the parsed document's text nodes rather than running a regex over the HTML
 * string: a bare replace also matches inside attribute values and code spans, which
 * splices markup into an `href` and leaves output DOMPurify has never inspected.
 * `<code>`, `<pre>` and link text are skipped so a literal `[1]` in a code sample or URL
 * stays as the author wrote it.
 */
function linkCitations(html: string, citations: Citation[]): string {
  // This component is prerendered on the server, where there is no DOMParser. Citations
  // only exist on messages that have streamed in the browser, so the fallback is never
  // what the user ends up seeing.
  if (typeof DOMParser === "undefined") return html;

  const byNumber = new Map(citations.map((citation) => [citation.n, citation]));
  const document = new DOMParser().parseFromString(html, "text/html");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;

    if (node.parentElement?.closest("code, pre, a")) continue;
    if (/\[\d{1,3}\]/.test(node.data)) targets.push(node);
  }

  for (const node of targets) {
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;

    for (const match of node.data.matchAll(/\[(\d{1,3})\]/g)) {
      const citation = byNumber.get(Number(match[1]));

      if (!citation || match.index === undefined) continue;

      fragment.append(node.data.slice(lastIndex, match.index));

      const chip = document.createElement("sup");
      const label = [citation.title, citation.heading].filter(Boolean).join(" › ");

      chip.className = "citation-chip";
      chip.dataset.citation = String(citation.n);
      chip.setAttribute("role", "button");
      chip.setAttribute("tabindex", "0");
      chip.setAttribute("aria-label", `Source ${citation.n}: ${citation.page === null ? label : `${label}, page ${citation.page}`}`);
      chip.textContent = String(citation.n);
      fragment.append(chip);

      lastIndex = match.index + match[0].length;
    }

    fragment.append(node.data.slice(lastIndex));
    node.replaceWith(fragment);
  }

  return document.body.innerHTML;
}

export default function MarkdownMessage({ text, citations, onCitationHover, onCitationClick }: MarkdownMessageProps) {
  const html = md.render(text);
  const safeHtml = DOMPurify.sanitize(html);
  const withCitations = citations?.length ? linkCitations(safeHtml, citations) : safeHtml;

  // The chips are plain DOM inside sanitized HTML, so events are delegated from here.
  const citationAt = (target: EventTarget | null) => {
    const chip = target instanceof Element ? target.closest<HTMLElement>("[data-citation]") : null;
    const citation = chip ? citations?.find((item) => item.n === Number(chip.dataset.citation)) : undefined;

    return chip && citation ? { chip, citation } : null;
  };

  const enter = (event: React.SyntheticEvent) => {
    const hit = citationAt(event.target);
    if (hit) onCitationHover?.(hit.citation, hit.chip.getBoundingClientRect());
  };

  const leave = (event: React.SyntheticEvent) => {
    if (citationAt(event.target)) onCitationHover?.(null, null);
  };

  return (
    <div
      className="prose max-w-none"
      onMouseOver={enter}
      onMouseOut={leave}
      onFocus={enter}
      onBlur={leave}
      onClick={(event) => {
        const hit = citationAt(event.target);
        if (hit) onCitationClick?.(hit.citation);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const hit = citationAt(event.target);
        if (!hit) return;
        event.preventDefault();
        onCitationClick?.(hit.citation);
      }}
      dangerouslySetInnerHTML={{ __html: withCitations }}
    />
  );
}
