import sqlite3


def unique_name(base: str, used: set[str]) -> str:
    """Choose the first free display name from a set of case-folded names."""
    base = base[:200]
    candidate = base
    number = 1
    while candidate.casefold() in used:
        suffix = f" ({number})"
        candidate = base[:200 - len(suffix)] + suffix
        number += 1
    return candidate


def ensure_unique_names(db: sqlite3.Connection) -> None:
    """Repair legacy duplicates once, preserving oldest names and existing suffixes."""
    db.execute("BEGIN IMMEDIATE")
    rows = db.execute("SELECT id, name FROM agreements ORDER BY created_at, id").fetchall()
    reserved = {row['name'].casefold() for row in rows}
    seen = set()
    for row in rows:
        key = row['name'].casefold()
        if key in seen:
            name = unique_name(row['name'], reserved)
            db.execute("UPDATE agreements SET name = ? WHERE id = ?", (name, row['id']))
            reserved.add(name.casefold())
        seen.add(key)
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS agreements_unique_name ON agreements(name COLLATE NOCASE)")
