# Test fixtures

Small, hand-built documents with known content, used by `tests/rag/extract.test.ts`,
`tests/rag/ingest.test.ts` and the upload route tests.

- `handbook.pdf` — two pages. Page 1 covers expenses, page 2 travel; the split matters
  because PDF chunks carry the page number they came from.
- `remote-work.docx` — a minimal OOXML package (`[Content_Types].xml`, `_rels/.rels`,
  `word/document.xml`) with Heading1/Heading2 paragraphs, which must survive as markdown
  headings so the chunker can see sections.

Regenerate with `python3 scripts/make-fixtures.py`. They are built by hand rather than
exported from an office suite so they stay tiny and deterministic.

Note: pdf.js logs `Warning: Indexing all PDF objects` for `handbook.pdf` — it rebuilds the
object index instead of trusting the hand-written xref table. Extraction is unaffected,
and the recovery path is more permissive than the normal one, so a real PDF that parses
through the strict path works too.
