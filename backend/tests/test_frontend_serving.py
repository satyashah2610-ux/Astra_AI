"""Hosting: the backend also serves the built web pages, so the whole app runs as one service at one address."""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app

INDEX = "<!doctype html><title>Astra Sign</title><div id=root></div>"


@pytest.fixture
def dist(tmp_path):
    folder = tmp_path / "dist"
    (folder / "assets").mkdir(parents=True)
    (folder / "pdf-assets" / "cmaps").mkdir(parents=True)
    (folder / "index.html").write_text(INDEX, encoding="utf-8")
    (folder / "assets" / "app-123.js").write_text("console.log('app')", encoding="utf-8")
    (folder / "assets" / "pdf.worker-1.mjs").write_text("// worker", encoding="utf-8")
    (folder / "pdf-assets" / "cmaps" / "Adobe.bcmap").write_bytes(b"cmap")
    (tmp_path / "secret.txt").write_text("outside the build", encoding="utf-8")
    return folder


@pytest.fixture
def client(tmp_path, dist, monkeypatch):
    monkeypatch.setenv("ASTRA_FRONTEND_DIR", str(dist))
    with TestClient(create_app(tmp_path / "data")) as client:
        yield client


@pytest.mark.parametrize("path", ["/", "/sign", "/confirm-email", "/reset-password", "/files/some/page", "/files/report.v2", "/favicon.ico"])
def test_page_addresses_get_the_app(client, path):
    response = client.get(path)
    assert response.status_code == 200 and response.text == INDEX
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["x-frame-options"] == "DENY"  # the usual security headers still apply
    assert response.headers["cache-control"] == "no-store"  # the page itself is never cached: a deploy shows at once


def test_head_requests_are_answered(client):
    assert client.head("/").status_code == 200 and client.head("/assets/app-123.js").status_code == 200


def test_built_files_are_cached(client):
    assert client.get("/assets/app-123.js").headers["cache-control"] == "public, max-age=31536000, immutable"  # names change with content
    assert client.get("/pdf-assets/cmaps/Adobe.bcmap").headers["cache-control"] == "public, max-age=86400"  # fixed names: a day


def test_built_files_are_served(client):
    script = client.get("/assets/app-123.js")
    assert script.status_code == 200 and script.text == "console.log('app')"
    assert "javascript" in script.headers["content-type"]
    assert client.get("/pdf-assets/cmaps/Adobe.bcmap").content == b"cmap"
    assert client.get("/assets/pdf.worker-1.mjs").headers["content-type"].startswith("text/javascript")  # the PDF viewer's worker


@pytest.mark.parametrize("path", ["/assets/missing.js", "/pdf-assets/cmaps/missing.bcmap", "/assets/sub"])
def test_a_missing_file_is_404_not_the_page(client, path):
    assert client.get(path).status_code == 404  # a script tag must never receive HTML


@pytest.mark.parametrize("path", ["/api/nothing-here", "/api", "/api/files/unknown/extra/parts"])
def test_unknown_api_addresses_stay_json_404s(client, path):
    response = client.get(path)
    assert response.status_code in (401, 404) and response.headers["content-type"].startswith("application/json")


@pytest.mark.parametrize("path", ["/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt"])
def test_nothing_outside_the_build_is_served(client, path):
    response = client.get(path)
    assert "outside the build" not in response.text and response.status_code in (200, 404)
    assert response.status_code == 404 or response.text == INDEX  # at most the app's own page


def test_the_api_still_works(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_without_a_build_folder_nothing_extra_is_served(tmp_path, monkeypatch):
    monkeypatch.delenv("ASTRA_FRONTEND_DIR", raising=False)
    with TestClient(create_app(tmp_path / "data")) as client:  # local development: Vite serves the pages
        assert client.get("/").status_code == 404


def test_a_build_folder_without_its_page_stops_the_app(tmp_path, monkeypatch):
    (tmp_path / "empty").mkdir()
    monkeypatch.setenv("ASTRA_FRONTEND_DIR", str(tmp_path / "empty"))
    with pytest.raises(RuntimeError, match="ASTRA_FRONTEND_DIR.*empty"):  # names the folder it checked
        create_app(tmp_path / "data")
