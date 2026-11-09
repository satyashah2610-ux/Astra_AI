"""Run from the repository root with .venv/Scripts/python.exe scripts/generate_sample.py."""
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from app.sample import make_sample

destination = root / "examples" / "sample-agreement.pdf"
destination.parent.mkdir(exist_ok=True)
destination.write_bytes(make_sample())
print(destination)
