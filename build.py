"""Assemble index.html from the sources in src/. Run: python3 build.py"""
from pathlib import Path
here = Path(__file__).parent
src = here / "src"
page = (src / "page.src.html").read_text()
engine = (src / "engine.js").read_text()
diagram_js = (src / "diagram.js").read_text()
assert "</script" not in engine and "</script" not in diagram_js
page = (page.replace("/*ENGINE*/", engine)
            .replace("/*DIAGRAM_CSS*/", (src / "diagram.css").read_text())
            .replace("<!--DIAGRAM_HTML-->", (src / "diagram.html").read_text())
            .replace("/*DIAGRAM_JS*/", diagram_js))
(here / "index.html").write_text(page)
print("wrote index.html", len(page), "bytes")
