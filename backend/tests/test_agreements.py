from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.main import create_app
from tests.staff import StaffClient


def pdf_bytes(pages=2, encrypted=False):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    if encrypted:
        writer.encrypt("secret")
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


@pytest.fixture
def client(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        yield client


def upload(client, content=None, name="Agreement.pdf"):
    return client.post("/api/agreements", files={"file": (name, content if content is not None else pdf_bytes(), "application/pdf")})


def mark(**overrides):
    return {"id": "signature-1", "page": 1, "x": 0.1, "y": 0.65, "width": 0.3, "height": 0.07, **overrides}


def save(client, identifier, marks, version=0):
    return client.put(f"/api/agreements/{identifier}/marks", json={"marks": marks, "version": version})


def test_upload_read_list_and_original_pdf(client):
    original = pdf_bytes()
    response = upload(client, original)
    assert response.status_code == 201
    item = response.json()
    assert item["name"] == "Agreement"
    assert item["page_count"] == 2
    assert item["marks"] == []
    assert item["version"] == 0
    assert client.get("/api/agreements").json() == [item]
    assert client.get(f"/api/agreements/{item['id']}").json() == item
    file_response = client.get(f"/api/agreements/{item['id']}/pdf")
    assert file_response.content == original
    assert file_response.headers["content-type"] == "application/pdf"


def test_marks_can_be_saved_moved_resized_and_removed(client):
    identifier = upload(client).json()["id"]
    response = save(client, identifier, [mark(), mark(id="signature-2", page=2)])
    assert response.status_code == 200
    assert response.json()["version"] == 1
    revised = mark(x=0.4, y=0.5, width=0.4, height=0.1)
    assert save(client, identifier, [revised], version=1).json()["marks"] == [revised]
    assert save(client, identifier, [], version=2).json()["marks"] == []


def test_persistence_survives_app_restart(tmp_path):
    with StaffClient(create_app(tmp_path)) as first:
        identifier = upload(first).json()["id"]
        save(first, identifier, [mark(page=2)])
    with StaffClient(create_app(tmp_path)) as restarted:
        response = restarted.get(f"/api/agreements/{identifier}")
        assert response.json()["marks"] == [mark(page=2)]
        assert restarted.get(f"/api/agreements/{identifier}/pdf").status_code == 200


@pytest.mark.parametrize("content,name", [(b"not a pdf", "Fake.pdf"), (b"%PDF-1.7 invalid", "Broken.pdf"), (pdf_bytes(), "text.txt"), (b"", "empty.pdf"), (pdf_bytes(encrypted=True), "Locked.pdf")])
def test_rejects_invalid_uploads_without_creating_records(client, content, name):
    assert upload(client, content, name).status_code == 400
    assert client.get("/api/agreements").json() == []


@pytest.mark.parametrize("changes", [{"x": -0.1}, {"x": 0.9}, {"y": 0.99}, {"width": 0}, {"height": -0.1}, {"page": 0}, {"page": 3}, {"page": 1.5}, {"id": ""}])
def test_rejects_invalid_mark_geometry_atomically(client, changes):
    identifier = upload(client).json()["id"]
    assert save(client, identifier, [mark(**changes)]).status_code == 422
    assert client.get(f"/api/agreements/{identifier}").json()["marks"] == []


def test_duplicate_mark_ids_are_rejected(client):
    identifier = upload(client).json()["id"]
    assert save(client, identifier, [mark(), mark(page=2)]).status_code == 422


def test_stale_save_does_not_overwrite_newer_work(client):
    identifier = upload(client).json()["id"]
    save(client, identifier, [mark()])
    assert save(client, identifier, []).status_code == 409
    assert client.get(f"/api/agreements/{identifier}").json()["marks"] == [mark()]


def test_multiple_agreements_keep_their_own_marks(client):
    first = upload(client, name="First.pdf").json()["id"]
    second = upload(client, name="Second.pdf").json()["id"]
    save(client, first, [mark()])
    assert client.get(f"/api/agreements/{second}").json()["marks"] == []


def test_unknown_agreement_is_404(client):
    assert client.get("/api/agreements/missing").status_code == 404
    assert client.get("/api/agreements/missing/pdf").status_code == 404
    assert save(client, "missing", []).status_code == 404


def test_sample_is_a_real_multipage_pdf(client):
    response = client.get("/api/sample-agreement.pdf")
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-")
    assert upload(client, response.content).json()["page_count"] == 2


def test_large_upload_is_rejected(client):
    response = upload(client, b"%PDF-1.7\n" + b"x" * (20 * 1024 * 1024))
    assert response.status_code == 413


def test_rotated_page_can_be_uploaded_and_marked(client):
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792).rotate(90)
    stream = BytesIO()
    writer.write(stream)
    identifier = upload(client, stream.getvalue()).json()["id"]
    assert save(client, identifier, [mark()]).status_code == 200


def test_delete_removes_pdf_marks_and_record_after_restart(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        identifier = upload(client).json()["id"]
        save(client, identifier, [mark()])
        pdf_path = tmp_path / "uploads" / f"{identifier}.pdf"
        assert pdf_path.is_file()
        response = client.delete(f"/api/agreements/{identifier}")
        assert response.status_code == 204
        assert response.content == b""
        assert not pdf_path.exists()
        assert client.get(f"/api/agreements/{identifier}/pdf").status_code == 404
        assert save(client, identifier, [], version=1).status_code == 404
    with StaffClient(create_app(tmp_path)) as restarted:
        assert restarted.get("/api/agreements").json() == []
        assert restarted.get(f"/api/agreements/{identifier}").status_code == 404


def test_delete_does_not_change_other_agreements(client):
    first = upload(client).json()["id"]
    second = upload(client, name="Keep.pdf").json()["id"]
    save(client, second, [mark()])
    assert client.delete(f"/api/agreements/{first}").status_code == 204
    assert [a["id"] for a in client.get("/api/agreements").json()] == [second]
    assert client.get(f"/api/agreements/{second}").json()["marks"] == [mark()]
    assert client.get(f"/api/agreements/{second}/pdf").status_code == 200


def test_delete_unknown_agreement_is_404(client):
    assert client.delete("/api/agreements/missing").status_code == 404


def test_delete_cleans_up_record_when_file_already_missing(client, tmp_path):
    identifier = upload(client).json()["id"]
    (tmp_path / "uploads" / f"{identifier}.pdf").unlink()
    assert client.delete(f"/api/agreements/{identifier}").status_code == 204


def test_failed_file_deletion_keeps_agreement_and_marks(client, monkeypatch):
    identifier = upload(client).json()["id"]
    save(client, identifier, [mark()])
    def fail_unlink(*args, **kwargs):
        raise PermissionError("File in use")
    with monkeypatch.context() as patch:
        patch.setattr(Path, "unlink", fail_unlink)
        assert client.delete(f"/api/agreements/{identifier}").status_code == 503
    assert client.get(f"/api/agreements/{identifier}").json()["marks"] == [mark()]
    assert client.get(f"/api/agreements/{identifier}/pdf").status_code == 200
