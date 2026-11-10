"""Check-then-write races: a request must not act on data deleted while it was waiting.

Each test holds the app's write lock from a second connection, deletes the agreement inside
that transaction, starts the request, and only then commits. A handler that checks before
taking the write lock sees the stale row and acts on it; a correct one waits and sees the delete.
"""
import os
import threading
import time

from fastapi.testclient import TestClient

import psycopg

from app.database import write_lock
from app.main import create_app
from tests.staff import StaffClient
from tests.test_agreements import mark, save, upload
from tests.test_files import file_body


def race(tmp_path, agreement_id, send):
    """Delete the agreement in a held transaction while `send` runs; return send's response."""
    holder = psycopg.connect(os.environ["DATABASE_URL"])  # a transaction starts with the first statement
    write_lock(holder)
    holder.execute("DELETE FROM agreements WHERE id = %s", (agreement_id,))
    result = {}
    worker = threading.Thread(target=lambda: result.setdefault("response", send()))
    worker.start()
    time.sleep(0.5)  # let the request reach its check while the delete is still uncommitted
    holder.commit()
    holder.close()
    worker.join(timeout=20)
    return result["response"]


def test_file_cannot_be_created_for_an_agreement_deleted_mid_request(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        agreement = upload(client).json()
        response = race(tmp_path, agreement["id"], lambda: client.post("/api/files", json=file_body(agreement["id"])))
        assert response.status_code == 422
        assert client.get("/api/files").json() == []


def test_saving_marks_on_an_agreement_deleted_mid_request_is_404_not_a_conflict(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        agreement = upload(client).json()
        response = race(tmp_path, agreement["id"], lambda: save(client, agreement["id"], [mark()]))
        assert response.status_code == 404
