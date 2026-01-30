from __future__ import annotations

import sys
from pathlib import Path


def _bootstrap_src() -> None:
    root = Path(__file__).resolve().parent
    src = root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))


def main() -> int:
    _bootstrap_src()

    # Best-effort: make Windows console UTF-8 friendly.
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    from simgame.main import main as game_main

    return game_main()


if __name__ == "__main__":
    raise SystemExit(main())
