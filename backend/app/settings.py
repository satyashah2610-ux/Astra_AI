"""Configuration from the environment, with git-ignored .env files as a local-development convenience."""
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILES = (".env.local", ".env")  # earlier files win


def read_env_file(path: Path) -> dict[str, str]:
    """KEY=value lines (comments, blank lines and `export ` ignored; surrounding quotes removed). Missing file: {}."""
    values: dict[str, str] = {}
    if not Path(path).is_file():
        return values
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def load_env_files(root: Path | None = None) -> None:
    """Fill in settings missing from the environment. A variable that is already set is never overridden."""
    folder = Path(root or os.environ.get("ASTRA_ENV_DIR") or REPO_ROOT)
    for name in ENV_FILES:
        for key, value in read_env_file(folder / name).items():
            os.environ.setdefault(key, value)


def setting(name: str, *files: str) -> str | None:
    """A setting from the environment, else from the first of these repo-root env files that sets it."""
    if os.environ.get(name):
        return os.environ[name]
    for file in files:
        value = read_env_file(REPO_ROOT / file).get(name)
        if value:
            return value
    return None


def app_database_url() -> str | None:
    """The DATABASE_URL the app itself would use (environment, then every env file the app loads)."""
    return setting("DATABASE_URL", *ENV_FILES)


def same_database_server(first: str, second: str | None) -> bool:
    """True if two connection strings reach the same server (Neon's pooled and direct hosts count as one)."""
    if not second:
        return False
    from psycopg.conninfo import conninfo_to_dict

    def server(url: str) -> tuple[str, str]:
        info = conninfo_to_dict(url)
        return (info.get("host") or "").lower().replace("-pooler", ""), str(info.get("port") or "5432")
    return server(first) == server(second)
