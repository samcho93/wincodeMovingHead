#!/usr/bin/env python3
"""pdf-pages.py - turn a PDF (manual or drawing) into something an agent can read.

    python tools/pdf-pages.py <file.pdf> <out-dir> [dpi]

Writes <out-dir>/text.txt (the text layer, page by page) and <out-dir>/pNN.png (every page rendered).
Scanned manuals have no text layer: text.txt is then almost empty and the PNG pages must be read instead.
Needs PyMuPDF (pip install pymupdf).
"""
import os
import sys

try:
    import fitz
except ImportError:  # user-site installs are hidden when python runs isolated
    import site
    site.addsitedir(site.getusersitepackages())
    import fitz


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    pdf, out = sys.argv[1], sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 110
    os.makedirs(out, exist_ok=True)
    doc = fitz.open(pdf)
    chars = 0
    with open(os.path.join(out, "text.txt"), "w", encoding="utf-8") as f:
        for i, page in enumerate(doc):
            text = page.get_text()
            chars += len(text.strip())
            f.write(f"\n===== PAGE {i + 1} =====\n{text}")
            page.get_pixmap(dpi=dpi).save(os.path.join(out, f"p{i + 1:02d}.png"))
    kind = "text layer present" if chars > 200 * len(doc) else "little or no text layer - read the page images"
    print(f"{len(doc)} pages -> {out} ({chars} characters of text: {kind})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
