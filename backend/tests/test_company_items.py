"""The company can tick, dot, name, date, initial and sign the agreement too: placed on the template, printed when sent."""
from io import BytesIO

import pytest
from pypdf import PdfReader

from app.main import create_app
from app.signed_pdf import print_text_marks
from app.signing import signing_date
from tests.signature_images import data_url, png_bytes
from tests.staff import StaffClient
from tests.test_agreements import mark, pdf_bytes, save, upload
from tests.test_files import create_file, token_from
from tests.test_item_stamping import path_bounds
from tests.test_signed_pdf import image_rects, text_pdf

SIGNATURE = mark(id="s1", y=.85)
CHECK = mark(id="k1", type="check", x=.1, y=.1, width=.03, height=.02)
DOT = mark(id="d1", type="dot", x=.2, y=.1, width=.03, height=.02)
NAME = mark(id="n1", type="name", text="Alex Morgan", y=.2)
DATE = mark(id="dt1", type="date", y=.3)
INITIALS = mark(id="i1", type="initials", image=data_url(), x=.1, y=.4, width=.07, height=.05)
COMPANY_SIGNATURE = mark(id="cs1", type="company_signature", image=data_url(), y=.5)
COMPANY = [CHECK, DOT, NAME, DATE, INITIALS, COMPANY_SIGNATURE]


@pytest.fixture
def client(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        yield client


# --- printing (unit) --------------------------------------------------------------------------------------

def test_company_items_are_printed_onto_the_document():
    printed = PdfReader(BytesIO(print_text_marks(text_pdf(pages=1), [*COMPANY, SIGNATURE], date_text="11 Nov 2026"))).pages[0]
    text = printed.extract_text()
    assert "Alex Morgan" in text and "11 Nov 2026" in text
    assert len(image_rects(printed)) == 2  # initials and the company's signature; the client's box stays empty
    assert path_bounds(printed) is not None  # the tick and the dot


def test_a_template_with_only_a_tick_is_still_printed():
    original = text_pdf(pages=1)
    assert print_text_marks(original, [CHECK]) != original


# --- templates (integration) ---------------------------------------------------------------------------------

def test_company_items_are_saved_with_the_template(client):
    agreement = upload(client).json()
    response = save(client, agreement["id"], [*COMPANY, SIGNATURE])
    assert response.status_code == 200, response.text
    assert client.get(f"/api/agreements/{agreement['id']}").json()["marks"] == [*COMPANY, SIGNATURE]


@pytest.mark.parametrize("bad", [
    mark(type="date", text="Tomorrow"),                       # the date is printed when sent, never typed
    mark(type="check", text="x"),
    mark(type="dot", image=data_url()),
    mark(type="name"),                                        # a name item needs the name
    mark(type="name", text="王小明"),                          # ...that the PDF can print
    mark(type="initials"),                                    # initials and signatures need the adopted image
    mark(type="company_signature"),
    mark(type="company_signature", image="data:image/png;base64,bm90IGEgcG5n"),
    mark(type="company_signature", image=data_url(png_bytes(size=(5, 5)))),
    mark(type="text", text="Fee", image=data_url()),          # only initials and signatures carry an image
    mark(image=data_url()),                                   # the client's box is signed by the client
])
def test_invalid_company_items_are_rejected(client, bad):
    agreement = upload(client).json()
    response = save(client, agreement["id"], [bad])
    assert response.status_code == 422, response.text
    assert client.get(f"/api/agreements/{agreement['id']}").json()["marks"] == []


def test_a_template_with_only_company_items_cannot_be_sent(client):
    agreement = upload(client).json()
    save(client, agreement["id"], COMPANY)
    item = create_file(client, agreement["id"]).json()
    assert client.post(f"/api/files/{item['id']}/send").status_code == 409  # the client still has nowhere to sign


# --- sending (integration) -----------------------------------------------------------------------------------

def send(client, offset=0):
    agreement = upload(client, pdf_bytes(pages=1)).json()
    assert save(client, agreement["id"], [*COMPANY, SIGNATURE]).status_code == 200
    item = create_file(client, agreement["id"]).json()
    sent = client.post(f"/api/files/{item['id']}/send", json={"email": False, "utc_offset_minutes": offset})
    assert sent.status_code == 200, sent.text
    return item["id"], {"X-Signing-Token": token_from(sent.json()["signing_path"])}


def test_sending_prints_company_items_dated_in_the_senders_time_zone(client):
    file_id, auth = send(client, offset=840)
    page = PdfReader(BytesIO(client.get(f"/api/files/{file_id}/pdf").content)).pages[0]
    assert "Alex Morgan" in page.extract_text()
    assert signing_date(840) in page.extract_text()
    assert len(image_rects(page)) == 2


def test_the_signer_sees_only_their_own_box(client):
    _, auth = send(client)
    view = client.get("/api/signing", headers=auth).json()
    assert [m["id"] for m in view["marks"]] == ["s1"]
    assert view["comments"] == []


def test_the_send_time_zone_is_checked(client):
    agreement = upload(client).json()
    save(client, agreement["id"], [SIGNATURE])
    item = create_file(client, agreement["id"]).json()
    assert client.post(f"/api/files/{item['id']}/send", json={"utc_offset_minutes": 5000}).status_code == 422
