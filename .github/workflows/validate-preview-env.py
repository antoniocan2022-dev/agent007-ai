#!/usr/bin/env python3
import pathlib
import re
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: validate-preview-env.py <dotenv-file>", file=sys.stderr)
        return 2

    path = pathlib.Path(sys.argv[1])
    if not path.is_file():
        print("Preview env file is missing.", file=sys.stderr)
        return 1

    text = path.read_text(encoding="utf-8-sig")
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()

    raw_database_url = values.get("DATABASE_URL", "")
    nextauth_secret = values.get("NEXTAUTH_SECRET", "").strip()

    # Vercel's pulled dotenv file may escape or wrap the value. Validate the
    # PostgreSQL URI by locating the scheme directly rather than parsing the
    # wrapped dotenv representation with urlsplit(). Never print the value.
    match = re.search(
        r"(?i)(postgres(?:ql)?):[/\\]{2}([^\s\"']+)",
        raw_database_url,
    )
    if not match:
        print("Preview DATABASE_URL is missing or is not a valid PostgreSQL URL.", file=sys.stderr)
        print(
            f"Parsed metadata: present={bool(raw_database_url)} scheme=<unrecognized> "
            f"has_host=False has_path=False",
            file=sys.stderr,
        )
        return 1

    host_and_path = match.group(2)
    if "/" not in host_and_path or host_and_path.startswith("/"):
        print("Preview DATABASE_URL is missing or is not a valid PostgreSQL URL.", file=sys.stderr)
        print(
            "Parsed metadata: present=True scheme=postgresql has_host=False has_path=False",
            file=sys.stderr,
        )
        return 1

    if not nextauth_secret:
        print("Preview NEXTAUTH_SECRET is missing.", file=sys.stderr)
        return 1

    scheme = match.group(1).lower()
    print(
        f"Preview runtime configuration is valid: DATABASE_URL={scheme}, NEXTAUTH_SECRET=present"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
