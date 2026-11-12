"""How the link reaches the client: emailed (with or without reminders) or shared by staff. The timeline says which."""
import pytest

from app.main import create_app
from tests.staff import StaffClient
from tests.test_files import file_body, prepared_agreement
from tests.test_reminders import FakeSender, event_types


@pytest.fixture
def outbox():
    return FakeSender()


@pytest.fixture
def client(tmp_path, outbox):
    with StaffClient(create_app(tmp_path, email_sender=outbox)) as client:
        yield client


def send(client, **options):
    item = client.post("/api/files", json=file_body(prepared_agreement(client)["id"])).json()
    response = client.post(f"/api/files/{item['id']}/send", json=options)
    assert response.status_code == 200, response.text
    return response.json()["file"]


def test_an_emailed_link_is_sent_by_email_in_the_timeline(client):
    item = send(client, email=True)
    types = event_types(client, item["id"])
    assert "sent" in types and "link_created" not in types


def test_a_link_shared_by_staff_is_link_created_not_sent(client):
    item = send(client, email=False)
    types = event_types(client, item["id"])
    assert "link_created" in types and "sent" not in types
    file = client.get(f"/api/files/{item['id']}").json()
    assert file["status"] == "sent"  # the file itself is out of drafts and waiting for the client


def test_an_email_that_could_not_go_out_is_link_created(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:  # email isn't set up: staff must share the link
        item = send(client, email=True)
        assert "link_created" in event_types(client, item["id"])


def test_reminders_are_on_by_default_for_an_emailed_link(client):
    item = send(client, email=True)
    assert client.get(f"/api/files/{item['id']}").json()["next_reminder_at"] is not None


def test_staff_can_email_the_link_without_reminders(client, outbox):
    item = send(client, email=True, reminders=False)
    file = client.get(f"/api/files/{item['id']}").json()
    assert file["next_reminder_at"] is None
    assert "sent" in event_types(client, item["id"])  # still emailed


def test_a_reissued_link_can_be_emailed_without_reminders(client):
    item = send(client, email=True)
    response = client.post(f"/api/files/{item['id']}/link", json={"email": True, "reminders": False})
    assert response.status_code == 200, response.text
    assert client.get(f"/api/files/{item['id']}").json()["next_reminder_at"] is None


def test_reminders_must_be_true_or_false(client):
    item = client.post("/api/files", json=file_body(prepared_agreement(client)["id"])).json()
    assert client.post(f"/api/files/{item['id']}/send", json={"email": True, "reminders": "yes"}).status_code == 422


def test_the_certificate_names_a_link_shared_by_staff():
    from app.signed_pdf import EVENT_LABELS
    assert EVENT_LABELS["sent"] == "Sent by email"
    assert EVENT_LABELS["link_created"] == "Link created, not emailed"


def test_earlier_sends_without_an_email_become_link_created(empty_database, tmp_path, monkeypatch):
    import shutil
    import psycopg
    from app import migrations

    before = tmp_path / "before"
    before.mkdir()
    for path in sorted(migrations.MIGRATIONS_DIR.glob("*.sql")):
        if path.stem < "0011":
            shutil.copy(path, before)
    real = migrations.MIGRATIONS_DIR
    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", before)
    with psycopg.connect(empty_database) as connection:
        migrations.migrate(connection)
        connection.execute("INSERT INTO organizations (id, name, created_at) VALUES ('o', 'Co', 'now')")
        history = {
            "emailed": ["created", "sent", "email_sent"],
            "bounced": ["created", "sent", "email_failed"],
            "shared": ["created", "sent", "viewed"],
            "shared_then_emailed_reissue": ["created", "sent", "link_reissued", "email_sent"],
        }
        for file_id, events in history.items():
            connection.execute("""INSERT INTO files (id, title, client_name, signer_name, signer_email, agreement_id, status,
                                  created_at, updated_at, organization_id) VALUES (%s, 't', 'c', 's', 'e@x.example', 'a', 'sent', 'now', 'now', 'o')""",
                               (file_id,))
            for event in events:
                connection.execute("INSERT INTO file_events (file_id, type, at) VALUES (%s, %s, 'now')", (file_id, event))
        connection.commit()
        monkeypatch.setattr(migrations, "MIGRATIONS_DIR", real)
        applied = migrations.migrate(connection)
        assert applied[0].startswith("0011")
        first = {r[0]: r[1] for r in connection.execute(
            "SELECT DISTINCT ON (file_id) file_id, type FROM file_events WHERE type IN ('sent', 'link_created') ORDER BY file_id, id")}
    assert first == {"emailed": "sent", "bounced": "sent", "shared": "link_created", "shared_then_emailed_reissue": "link_created"}
