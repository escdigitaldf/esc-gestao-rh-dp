from __future__ import annotations

import re
import sys
from pathlib import Path

from pglast import parse_sql


MIGRATIONS_DIR = Path("supabase/migrations")
VERSION_PATTERN = re.compile(r"^(\d{12}|\d{14})_[a-z0-9_]+\.sql$")


def main() -> int:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("No SQL migrations found.", file=sys.stderr)
        return 1

    seen: set[str] = set()
    failures: list[str] = []

    for path in files:
        match = VERSION_PATTERN.match(path.name)
        if not match:
            failures.append(f"{path}: filename must start with a 14-digit timestamp and description")
            continue
        version = match.group(1)
        if version in seen:
            failures.append(f"{path}: duplicate migration version {version}")
            continue
        seen.add(version)

        try:
            parse_sql(path.read_text(encoding="utf-8"))
        except Exception as exc:  # parser exceptions include the SQL location
            failures.append(f"{path}: {exc}")

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1

    print(f"Validated {len(files)} migration files: top-level PostgreSQL syntax and unique version names.")
    print("Note: PL/pgSQL function bodies still require execution against a PostgreSQL test database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
