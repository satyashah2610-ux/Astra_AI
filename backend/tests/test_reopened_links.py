""""Opened by signer" is recorded the first time each newly issued link is opened: after the send, a reissue or a reminder."""
from app.main import create_app
from tests.staff import StaffClient
from tests.test_reminders import FakeSender, event_types, link_in, make_due, run, sent
from tests.test_signing import auth

import pytest


@pytest.fixture
def outbox():
    return FakeSender()


@pytest.fixture
def app(tmp_path, outbox):
    return create_app(tmp_path, email_sender=outbox)


@pytest.fixture
def client(app):
    with StaffClient(app) as client:
        yield client


def open_link(client, token):
    response = client.post("/api/signing/view", headers=auth(token))
    assert response.status_code == 200, response.text
    return response.json()


def opens(client, file_id):
    return event_types(client, file_id).count("viewed")


def test_opening_the_same_link_again_adds_nothing(client):
    item, token = sent(client)
    for _ in range(3):
        open_link(client, token)
    assert opens(client, item["id"]) == 1


def test_a_reissued_link_is_recorded_when_opened(client):
    item, first = sent(client)
    open_link(client, first)
    response = client.post(f"/api/files/{item['id']}/link", json={"email": False})
    second = response.json()["signing_path"].removeprefix("/sign#")
    assert open_link(client, second)["status"] == "viewed"
    open_link(client, second)  # a reload of the new link
    types = [t for t in event_types(client, item["id"]) if t in ("viewed", "link_reissued")]
    assert types == ["viewed", "link_reissued", "viewed"]
    file = client.get(f"/api/files/{item['id']}").json()
    assert file["status"] == "viewed"


def test_the_first_open_time_is_kept(client):
    item, first = sent(client)
    open_link(client, first)
    viewed_at = client.get(f"/api/files/{item['id']}").json()["viewed_at"]
    second = client.post(f"/api/files/{item['id']}/link", json={"email": False}).json()["signing_path"].removeprefix("/sign#")
    open_link(client, second)
    assert client.get(f"/api/files/{item['id']}").json()["viewed_at"] == viewed_at  # when the client first saw it


def test_a_reminder_link_is_recorded_when_opened(client, app, outbox):
    item, first = sent(client)
    open_link(client, first)
    make_due(item["id"])
    assert run(app, outbox) == 1
    open_link(client, link_in(outbox.reminders()[0]))
    assert opens(client, item["id"]) == 2


def test_a_signed_file_records_no_more_opens(client):
    item, token = sent(client)
    open_link(client, token)
    from tests.test_signing import submission
    assert client.post("/api/signing/sign", headers=auth(token), json=submission()).status_code == 200
    open_link(client, token)
    assert opens(client, item["id"]) == 1


def test_reopening_the_original_link_after_a_reminder_adds_nothing(client, app, outbox):
    item, first = sent(client)
    open_link(client, first)
    make_due(item["id"])
    assert run(app, outbox) == 1
    open_link(client, first)  # an old tab or bookmark: the original link still works, but it was already opened
    assert opens(client, item["id"]) == 1
    open_link(client, link_in(outbox.reminders()[0]))  # the reminder's own link, opened for the first time
    assert opens(client, item["id"]) == 2


def test_the_certificate_calls_an_open_what_the_timeline_calls_it():
    from app.signed_pdf import EVENT_LABELS
    assert EVENT_LABELS["viewed"] == "Opened by signer"
