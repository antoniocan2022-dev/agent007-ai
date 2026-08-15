#!/usr/bin/env python3
import pathlib
import re
import sys
from urllib.parse import urlsplit


def unwrap(value: str) -> str:
    value = value.strip()
    for _ in range(3):
        previous = value
        if len(value) >= 4 and value[:2] in {r'\"', r"\'"} and value[-2:] == value[:2]:
            value = value[2:-2].strip()
        elif len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1].strip()
        value = re.sub(r'\\([:/@?&#=])', r'\1', value)
        if value == previous:
            break
    return value


def main() -> int:
    if len(sys.argv) != 2:
        print('Usage: validate-preview-env.py <dotenv-file>', file=sys.stderr)
        return 2

    path = pathlib.Path(sys.argv[1])
    if not path.is_file():
        print('Preview env file is missing.', file=sys.stderr)
        return 1

    text = path.read_text(encoding='utf-8-sig')
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = unwrap(value)

    database_url = values.get('DATABASE_URL', '')
    nextauth_secret = values.get('NEXTAUTH_SECRET', '').strip()

    match = re.search(r'(postgres(?:ql)?):/{2}', database_url, flags=re.IGNORECASE)
    if match:
        database_url = database_url[match.start():]

    parsed = urlsplit(database_url)
    if parsed.scheme.lower() not in {'postgres', 'postgresql'} or not parsed.netloc or not parsed.path:
        print('Preview DATABASE_URL is missing or is not a valid PostgreSQL URL.', file=sys.stderr)
        print(
            f'Parsed metadata: present={bool(database_url)} scheme={parsed.scheme or "<none>"} '
            f'has_host={bool(parsed.netloc)} has_path={bool(parsed.path)}',
            file=sys.stderr,
        )
        return 1

    if not nextauth_secret:
        print('Preview NEXTAUTH_SECRET is missing.', file=sys.stderr)
        return 1

    print('Preview runtime configuration is valid: DATABASE_URL=postgresql, NEXTAUTH_SECRET=present')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
