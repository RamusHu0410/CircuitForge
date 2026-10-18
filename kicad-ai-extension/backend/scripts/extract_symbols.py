"""Regenerate app/templates/kicad_symbols.kicad_sym from an installed KiCad.

    cd backend
    python scripts/extract_symbols.py [/path/to/kicad/symbols]

Default path is KiCad's macOS app bundle. The symbols are part of the
official KiCad libraries (CC-BY-SA 4.0 with an exception that allows use in
designs); see https://www.kicad.org/libraries/license/.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.component_registry import all_lib_ids  # noqa: E402
from app.core.symbol_library import VENDORED_SYMBOLS, extract  # noqa: E402

DEFAULT_DIR = Path("/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols")


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DIR
    VENDORED_SYMBOLS.parent.mkdir(parents=True, exist_ok=True)
    VENDORED_SYMBOLS.write_text(extract(source, all_lib_ids()), encoding="utf-8")
    print(f"wrote {len(all_lib_ids())} symbols to {VENDORED_SYMBOLS}")


if __name__ == "__main__":
    main()
