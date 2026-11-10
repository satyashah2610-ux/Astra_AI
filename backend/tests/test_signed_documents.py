from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

import app.signed_documents as signed_documents
from app.main import create_app
from tests.staff import StaffClient
from tests.signature_images import data_url
from tests.test_agreements import pdf_bytes
from tests.test_files import create_file, prepared_agreement, token_from


@pytest.fixture
def client(tmp_path):
    with StaffClient(create_app(tmp_path), headers={"User-Agent": "Test Browser"}) as client:
        yield client


def sent(client, pages=2):
    item = create_file(client, prepared_agreement(client, pdf_bytes(pages=pages))["id"]).json()
    token = token_from(client.post(f"/api/files/{item['id']}/send").json()["signing_path"])
    return item, {"X-Signing-Token": token}


def sign(client, auth):
    response = client.post("/api/signing/sign", headers=auth, json={"name": "Jordan Smith", "method": "drawn", "image": data_url(), "consent": True})
    assert response.status_code == 200
    return response


def staff_pdf(client, item):
    return client.get(f"/api/files/{item['id']}/signed.pdf")


def signer_pdf(client, auth):
    return client.get("/api/signing/signed.pdf", headers=auth)


def test_no_signed_pdf_before_signing(client):
    item, auth = sent(client)
    assert staff_pdf(client, item).status_code == 404
    assert signer_pdf(client, auth).status_code == 404


def test_staff_and_signer_download_the_same_signed_pdf(client):
    item, auth = sent(client, pages=2)
    sign(client, auth)
    staff, signer = staff_pdf(client, item), signer_pdf(client, auth)
    assert staff.status_code == signer.status_code == 200
    assert staff.headers["content-type"] == "application/pdf"
    assert "attachment" in staff.headers["content-disposition"]
    assert "signed.pdf" in staff.headers["content-disposition"]
    assert staff.content == signer.content
    reader = PdfReader(BytesIO(staff.content))
    assert len(reader.pages) == 3  # two original pages + the certificate
    assert "Certificate of completion" in reader.pages[-1].extract_text()
    assert "Jordan Smith" in reader.pages[-1].extract_text()


def test_downloads_are_byte_identical(client):
    item, auth = sent(client)
    sign(client, auth)
    first = staff_pdf(client, item)
    assert first.status_code == 200 and first.content.startswith(b"%PDF")
    assert staff_pdf(client, item).content == first.content == signer_pdf(client, auth).content


def test_signature_survives_a_build_failure_and_the_next_download_builds_it(client, monkeypatch):
    item, auth = sent(client)
    real = signed_documents.build_signed_pdf

    def broken(*args, **kwargs):
        raise ValueError("unusual PDF")

    monkeypatch.setattr(signed_documents, "build_signed_pdf", broken)
    sign(client, auth)
    assert client.get(f"/api/files/{item['id']}").json()["status"] == "signed"
    monkeypatch.setattr(signed_documents, "build_signed_pdf", real)
    response = staff_pdf(client, item)
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF")


def test_build_failure_on_download_is_a_clear_error(client, monkeypatch):
    item, auth = sent(client)
    monkeypatch.setattr(signed_documents, "build_signed_pdf", lambda *a, **k: (_ for _ in ()).throw(ValueError("bad")))
    sign(client, auth)
    response = staff_pdf(client, item)
    assert response.status_code == 503
    assert "could not be created" in response.json()["detail"]


def test_deleted_template_does_not_affect_the_signed_pdf(client):
    item, auth = sent(client)
    client.delete(f"/api/agreements/{item['agreement_id']}")
    sign(client, auth)
    assert staff_pdf(client, item).status_code == 200


def test_signed_pdf_survives_restart(tmp_path):
    with StaffClient(create_app(tmp_path)) as first:
        item, auth = sent(first)
        sign(first, auth)
        before = staff_pdf(first, item)
        assert before.status_code == 200 and before.content.startswith(b"%PDF")
    with StaffClient(create_app(tmp_path)) as restarted:
        assert staff_pdf(restarted, item).content == before.content


def test_unknown_file_and_bad_link_are_404(client):
    assert client.get("/api/files/missing/signed.pdf").status_code == 404
    assert client.get("/api/signing/signed.pdf", headers={"X-Signing-Token": "nope"}).status_code == 404
