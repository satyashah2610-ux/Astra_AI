import hashlib
from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.main import create_app
from tests.staff import StaffClient
from tests import db
from tests.signature_images import data_url, png_bytes
from tests.test_agreements import mark, pdf_bytes, save, upload
from tests.test_files import create_file, token_from

TEXT = mark(id="t1", type="text", text="Project: Riverside", y=.1)
COMMENT = mark(id="c1", type="comment", text="Please tick your payment plan", y=.3)
SIGNATURE = mark(id="s1", page=2, y=.8)


@pytest.fixture
def client(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        yield client


def template(client, marks):
    agreement = upload(client, pdf_bytes(pages=2)).json()
    response = save(client, agreement["id"], marks)
    assert response.status_code == 200, response.text
    return agreement


def send(client, marks=(TEXT, COMMENT, SIGNATURE)):
    agreement = template(client, list(marks))
    item = create_file(client, agreement["id"]).json()
    sent = client.post(f"/api/files/{item['id']}/send")
    assert sent.status_code == 200, sent.text
    return agreement, sent.json()["file"], {"X-Signing-Token": token_from(sent.json()["signing_path"])}


def signer_item(**overrides):
    return {"id": "i1", "type": "check", "page": 1, "x": .5, "y": .5, "width": .03, "height": .02, **overrides}


def sign(client, auth, **overrides):
    body = {"name": "Jordan Smith", "method": "drawn", "image": data_url(), "consent": True, **overrides}
    return client.post("/api/signing/sign", headers=auth, json=body)


# --- templates and sending -------------------------------------------------------------------------

def test_template_keeps_text_and_comments_and_legacy_boxes_keep_their_shape(client):
    agreement = template(client, [TEXT, COMMENT, SIGNATURE])
    assert client.get(f"/api/agreements/{agreement['id']}").json()["marks"] == [TEXT, COMMENT, SIGNATURE]


@pytest.mark.parametrize("bad", [mark(type="text"), mark(type="text", text="王小明"), mark(type="pen")])
def test_invalid_template_items_are_rejected(client, bad):
    agreement = upload(client).json()
    assert save(client, agreement["id"], [bad]).status_code == 422


def test_sending_prints_company_text_into_the_frozen_document(client):
    agreement, sent, _ = send(client)
    snapshot = client.get(f"/api/files/{sent['id']}/pdf").content
    text = PdfReader(BytesIO(snapshot)).pages[0].extract_text()
    assert "Project: Riverside" in text
    assert "Please tick your payment plan" not in text
    assert sent["document_sha256"] == hashlib.sha256(snapshot).hexdigest()
    assert snapshot != client.get(f"/api/agreements/{agreement['id']}/pdf").content
    assert sent["field_count"] == 1  # signature boxes only


def test_signer_sees_comments_and_only_signature_boxes(client):
    _, _, auth = send(client)
    view = client.get("/api/signing", headers=auth).json()
    assert [m["id"] for m in view["marks"]] == ["s1"]
    assert view["comments"] == [{"id": "c1", "page": 1, "x": COMMENT["x"], "y": .3, "width": COMMENT["width"], "height": COMMENT["height"], "text": "Please tick your payment plan"}]


def test_text_or_comment_alone_is_not_enough_to_send(client):
    agreement = template(client, [TEXT, COMMENT])
    item = create_file(client, agreement["id"]).json()
    response = client.post(f"/api/files/{item['id']}/send")
    assert response.status_code == 409
    assert "signature box" in response.json()["detail"].lower()


# --- signer items ------------------------------------------------------------------------------------

def test_signer_items_are_stored_stamped_and_listed(client, tmp_path):
    _, sent, auth = send(client)
    items = [signer_item(id="tick"), signer_item(id="dot", type="dot", y=.6), signer_item(id="txt", type="text", text="Unit 4B", width=.2),
             signer_item(id="nm", type="name", page=2, y=.7, width=.25), signer_item(id="dt", type="date", page=2, y=.75, width=.15),
             signer_item(id="ini", type="initials", page=2, y=.1, width=.06, height=.03), signer_item(id="sig", type="signature", y=.9, width=.25, height=.05)]
    initials = png_bytes((160, 80))
    response = sign(client, auth, items=items, initials={"method": "drawn", "image": data_url(initials)}, utc_offset_minutes=0)
    assert response.status_code == 200, response.text
    row = db.row("SELECT items, initials_method, initials_sha256, date_text FROM signer_items WHERE file_id = %s", (sent["id"],))
    assert [i["id"] for i in __import__("json").loads(row[0])] == [i["id"] for i in items]
    assert row[1] == "drawn" and row[2] == hashlib.sha256(initials).hexdigest()
    assert (tmp_path / "signatures" / f"{sent['id']}-initials.png").read_bytes() == initials
    signed = PdfReader(BytesIO(client.get(f"/api/files/{sent['id']}/signed.pdf").content))
    page_two = signed.pages[1].extract_text()
    assert "Unit 4B" in signed.pages[0].extract_text()
    assert "Jordan Smith" in page_two and row[3] in page_two
    certificate = " ".join(p.extract_text() for p in signed.pages[2:])  # pages after the 2-page document
    assert "Completed by the signer" in certificate
    for label in ["Tick", "Dot", "Text", "Name", "Date signed", "Initials", "Signature"]:
        assert label in certificate


@pytest.mark.parametrize("offset", [-840, 0, 840])
def test_date_item_uses_the_signers_local_date_filled_by_the_server(client, tmp_path, offset):
    _, sent, auth = send(client)
    expected = (datetime.now(timezone.utc) + timedelta(minutes=offset)).strftime("%d %b %Y")
    assert sign(client, auth, items=[signer_item(type="date", width=.15)], utc_offset_minutes=offset).status_code == 200
    assert db.value("SELECT date_text FROM signer_items WHERE file_id = %s", (sent["id"],)) == expected


@pytest.mark.parametrize("changes", [
    {"items": [signer_item(page=3)]},  # the document has 2 pages
    {"items": [signer_item(type="text", text="王小明")]},
    {"items": [signer_item(type="initials")]},  # initials not adopted
    {"items": [signer_item(type="initials")], "initials": {"method": "drawn", "image": data_url(b"not a png")}},
])
def test_invalid_signer_items_change_nothing(client, tmp_path, changes):
    _, sent, auth = send(client)
    assert sign(client, auth, **changes).status_code == 422
    assert client.get(f"/api/files/{sent['id']}").json()["status"] == "sent"
    assert db.value("SELECT COUNT(*) FROM signer_items") == 0


def test_signing_without_items_still_works_and_stores_an_empty_list(client, tmp_path):
    _, sent, auth = send(client, marks=(SIGNATURE,))
    assert sign(client, auth).status_code == 200
    assert client.get(f"/api/files/{sent['id']}/signed.pdf").status_code == 200


# --- code review regressions ------------------------------------------------------------------------

def test_send_explains_a_template_that_cannot_be_printed_and_changes_nothing(client, tmp_path, monkeypatch):
    import app.files

    def broken(*args, **kwargs):
        raise ValueError("unusual PDF structure")

    agreement = template(client, [TEXT, SIGNATURE])
    item = create_file(client, agreement["id"]).json()
    monkeypatch.setattr(app.files, "print_text_marks", broken)
    response = client.post(f"/api/files/{item['id']}/send")
    assert response.status_code == 422
    assert "could not be printed" in response.json()["detail"]
    assert client.get(f"/api/files/{item['id']}").json()["status"] == "draft"
    assert not (tmp_path / "documents" / f"{item['id']}.pdf").exists()


def test_a_template_item_on_a_missing_page_is_described_as_an_item(client):
    agreement = upload(client, pdf_bytes(pages=2)).json()
    response = save(client, agreement["id"], [mark(id="t", type="text", text="Fee", page=3)])
    assert response.status_code == 422
    assert "item" in response.json()["detail"].lower()
    assert "signature box" not in response.json()["detail"].lower()
