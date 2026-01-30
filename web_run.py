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
        stdout_reconf = getattr(sys.stdout, "reconfigure", None)
        if callable(stdout_reconf):
            stdout_reconf(encoding="utf-8")
        stderr_reconf = getattr(sys.stderr, "reconfigure", None)
        if callable(stderr_reconf):
            stderr_reconf(encoding="utf-8")
    except Exception:
        pass

    import uvicorn

    uvicorn.run("simgame.webapp:app", host="127.0.0.1", port=8000, reload=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
