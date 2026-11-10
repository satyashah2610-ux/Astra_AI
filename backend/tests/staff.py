"""A test client that is signed in as a member of a company (staff side)."""
from fastapi.testclient import TestClient

PASSWORD = "correct horse battery staple"


class StaffClient(TestClient):
    """TestClient that creates (or logs into) a staff account as soon as it is made."""

    def __init__(self, app, *args, company="Test Company", email="staff@example.com", name="Sam Staff", **kwargs):
        super().__init__(app, *args, **kwargs)
        self.account = sign_in(self, company=company, email=email, name=name)


def sign_in(client: TestClient, company="Test Company", email="staff@example.com", name="Sam Staff", password=PASSWORD) -> dict:
    response = client.post("/api/auth/signup", json={"company": company, "name": name, "email": email, "password": password})
    if response.status_code == 409:  # the account already exists (e.g. after an app restart): log in instead
        response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code in (200, 201), response.text
    return response.json()
