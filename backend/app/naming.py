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
