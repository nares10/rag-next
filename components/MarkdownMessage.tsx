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
}

const CITATION_CLASS =
  "ml-0.5 cursor-help rounded bg-zinc-700 px-1 py-0.5 text-[10px] font-medium text-zinc-100 no-underline";

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

      chip.className = CITATION_CLASS;
      chip.title = citation.page === null ? label : `${label} (p.${citation.page})`;
      chip.textContent = String(citation.n);
      fragment.append(chip);

      lastIndex = match.index + match[0].length;
    }

    fragment.append(node.data.slice(lastIndex));
    node.replaceWith(fragment);
  }

  return document.body.innerHTML;
}

export default function MarkdownMessage({ text, citations }: MarkdownMessageProps) {
  const html = md.render(text);
  const safeHtml = DOMPurify.sanitize(html);
  const withCitations = citations?.length ? linkCitations(safeHtml, citations) : safeHtml;

  return (
    <div
      className="prose prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: withCitations }}
    />
  );
}
