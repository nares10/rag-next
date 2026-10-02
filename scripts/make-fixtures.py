#!/usr/bin/env python3
"""Regenerates the binary test fixtures in tests/fixtures.

They are built by hand rather than exported from an office suite so they stay tiny,
deterministic, and readable in a diff-free sense: what the extraction tests assert is
exactly what is written here. Run from the repo root:

    python3 scripts/make-fixtures.py
"""
import pathlib
import zipfile

FIXTURES = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures"


def build_pdf(pages):
    """A minimal uncompressed PDF: catalog, page tree, one content stream per page."""
    objects = {}
    page_ids = [3 + 2 * i for i in range(len(pages))]
    content_ids = [pid + 1 for pid in page_ids]
    font_id = page_ids[-1] + 2

    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    kids = " ".join(f"{pid} 0 R" for pid in page_ids).encode()
    objects[2] = b"<< /Type /Pages /Kids [" + kids + b"] /Count " + str(len(pages)).encode() + b" >>"

    for pid, cid, lines in zip(page_ids, content_ids, pages):
        objects[pid] = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents "
            + str(cid).encode()
            + b" 0 R /Resources << /Font << /F1 " + str(font_id).encode() + b" 0 R >> >> >>"
        )
        body = [b"BT", b"/F1 12 Tf", b"14 TL", b"72 720 Td"]
        for line in lines:
            escaped = line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
            body.append(b"(" + escaped.encode("latin-1") + b") Tj T*")
        body.append(b"ET")
        stream = b"\n".join(body)
        objects[cid] = (
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"
        )

    objects[font_id] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += str(num).encode() + b" 0 obj\n" + objects[num] + b"\nendobj\n"

    xref_at = len(out)
    count = max(objects) + 1
    out += b"xref\n0 " + str(count).encode() + b"\n0000000000 65535 f \n"
    for num in range(1, count):
        out += f"{offsets.get(num, 0):010d} 00000 n \n".encode()
    out += (
        b"trailer\n<< /Size " + str(count).encode() + b" /Root 1 0 R >>\nstartxref\n"
        + str(xref_at).encode() + b"\n%%EOF\n"
    )
    return bytes(out)


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


def paragraph(text, style=None):
    props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f'<w:p>{props}<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'


def build_docx(path, paragraphs):
    body = "".join(paragraph(text, style) for text, style in paragraphs)
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", RELS)
        archive.writestr("word/document.xml", document)


def main():
    FIXTURES.mkdir(parents=True, exist_ok=True)

    (FIXTURES / "handbook.pdf").write_bytes(
        build_pdf([
            [
                "Employee Handbook",
                "",
                "Expenses",
                "Receipts must be filed within 30 days of purchase.",
                "Reimbursement is paid with the following month's salary.",
            ],
            [
                "Travel",
                "Economy class is the default for flights under six hours.",
                "Hotel stays above 200 euros per night need written approval.",
            ],
        ])
    )

    build_docx(
        FIXTURES / "remote-work.docx",
        [
            ("Remote Work Policy", "Heading1"),
            ("Equipment", "Heading2"),
            ("The company provides a laptop and one external monitor to every remote employee.", None),
            ("Hardware is replaced on a three year cycle.", None),
            ("Working hours", "Heading2"),
            ("Core hours are 10:00 to 16:00 in the employee's local time zone.", None),
        ],
    )

    for name in ("handbook.pdf", "remote-work.docx"):
        print(name, (FIXTURES / name).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
