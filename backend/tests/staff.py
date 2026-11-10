"""A test client that is signed in as a member of a company (staff side)."""
from fastapi.testclient import TestClient

from tests import db

PASSWORD = "correct horse battery staple"


class StaffClient(TestClient):
    """TestClient that creates (or logs into) a staff account as soon as it is made."""

    def __init__(self, app, *args, company="Test Company", email="staff@example.com", name="Sam Staff", **kwargs):
        super().__init__(app, *args, **kwargs)
        self.account = sign_in(self, company=company, email=email, name=name)


def sign_in(client: TestClient, company="Test Company", email="staff@example.com", name="Sam Staff", password=PASSWORD) -> dict:
    """Create the account (unless it already exists, e.g. after an app restart), then log in: sign-up alone doesn't."""
    created = client.post("/api/auth/signup", json={"company": company, "name": name, "email": email, "password": password})
    assert created.status_code in (201, 409), created.text
    # When the app emails confirmation links, mark the account confirmed as if the link was opened (tested in test_login_protection).
    db.execute("UPDATE users SET email_confirmed_at = created_at WHERE lower(email) = lower(%s) AND email_confirmed_at IS NULL", (email,))
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()
