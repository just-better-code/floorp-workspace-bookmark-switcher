"""Package the existing extension sources without compiling or installing them."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    "manifest.json",
    "background.js",
    "compatibility.html",
    "compatibility.css",
    "experiments/floorp.js",
    "experiments/floorp.json",
    "icons/icon.png",
    "icons/selector.svg",
    "icons/copy.svg",
    "icons/paste.svg",
    "icons/delete.svg",
    "icons/rename.svg",
    "icons/confirm.svg",
    "LICENSE",
)


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    version = manifest["version"]
    output = ROOT / "dist" / f"bookmark-toolbar-autoswitch-{version}.xpi"
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(ROOT / name, name)
    with ZipFile(output) as archive:
        assert archive.namelist() == list(FILES)
        assert archive.testzip() is None
    print(output)


if __name__ == "__main__":
    main()
