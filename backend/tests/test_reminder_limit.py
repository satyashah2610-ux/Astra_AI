"""Reminders stop after seven: one a day for the seven days after a link is emailed."""
import pytest

from app.main import create_app
from tests.staff import StaffClient
from tests.test_reminders import FakeSender, event_types, make_due, run, sent


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


def remind_all(client, app, outbox, file_id, times):
    """Make the file's reminder due and run the reminder check, `times` times. Returns how many were sent."""
    total = 0
    for _ in range(times):
        if client.get(f"/api/files/{file_id}").json()["next_reminder_at"] is None:
            break
        make_due(file_id)
        total += run(app, outbox)
    return total


def test_reminders_stop_after_seven(client, app, outbox):
    item, _ = sent(client)
    assert remind_all(client, app, outbox, item["id"], 10) == 7
    file = client.get(f"/api/files/{item['id']}").json()
    assert file["reminders_sent"] == 7
    assert file["next_reminder_at"] is None  # no "Next" date shown after the last one
    assert run(app, outbox) == 0


def test_the_seventh_reminder_is_still_sent(client, app, outbox):
    item, _ = sent(client)
    assert remind_all(client, app, outbox, item["id"], 6) == 6
    assert client.get(f"/api/files/{item['id']}").json()["next_reminder_at"] is not None


def test_emailing_a_reissued_link_starts_a_new_seven(client, app, outbox):
    item, _ = sent(client)
    remind_all(client, app, outbox, item["id"], 7)
    client.post(f"/api/files/{item['id']}/link", json={"email": True})
    assert client.get(f"/api/files/{item['id']}").json()["next_reminder_at"] is not None
    assert remind_all(client, app, outbox, item["id"], 10) == 7
    assert event_types(client, item["id"]).count("reminder_sent") == 14


def test_a_reminder_held_back_by_the_daily_allowance_doesnt_count(client, app, outbox, monkeypatch):
    allowance = {"open": False}
    monkeypatch.setattr("app.reminders.take_email_slot", lambda *args: allowance["open"])
    item, _ = sent(client)
    for _ in range(10):
        make_due(item["id"])
        run(app, outbox)
    allowance["open"] = True
    assert remind_all(client, app, outbox, item["id"], 10) == 7


def test_files_already_being_reminded_get_what_is_left_of_seven_for_their_current_link(empty_database, tmp_path, monkeypatch):
    import shutil
    import psycopg
    from app import migrations

    before = tmp_path / "before"
    before.mkdir()
    for path in sorted(migrations.MIGRATIONS_DIR.glob("*.sql")):
        if path.stem < "0010":
            shutil.copy(path, before)
    real = migrations.MIGRATIONS_DIR
    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", before)
    with psycopg.connect(empty_database) as connection:
        migrations.migrate(connection)
        connection.execute("INSERT INTO organizations (id, name, created_at) VALUES ('o', 'Co', 'now')")
        history = {
            "reissued": ["sent"] + ["reminder_sent"] * 6 + ["link_reissued", "reminder_sent"],  # 1 since the new link
            "failures": ["sent"] + ["reminder_sent"] * 5 + ["reminder_failed"] * 2,  # failed attempts count too
            "fresh": ["sent"],
        }
        for file_id, events in history.items():
            connection.execute("""INSERT INTO files (id, title, client_name, signer_name, signer_email, agreement_id, status,
                                  created_at, updated_at, organization_id, remind_at) VALUES (%s, 't', 'c', 's', 'e@x.example', 'a', 'sent', 'now', 'now', 'o', '2026-01-01')""",
                               (file_id,))
            for event in events:
                connection.execute("INSERT INTO file_events (file_id, type, at) VALUES (%s, %s, 'now')", (file_id, event))
        connection.commit()
        monkeypatch.setattr(migrations, "MIGRATIONS_DIR", real)
        assert migrations.migrate(connection)[0] == "0010_reminder_limit"  # later migrations follow it
        left = {r[0]: (r[1], r[2]) for r in connection.execute("SELECT id, reminders_left, remind_at FROM files")}
    assert left == {"reissued": (6, "2026-01-01"), "failures": (0, None), "fresh": (7, "2026-01-01")}
