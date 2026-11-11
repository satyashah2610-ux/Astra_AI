"""Renaming an agreement: a taken name gets " (1)", " (2)"... like an upload does."""
import pytest

from app.main import create_app
from tests.staff import StaffClient
from tests.test_agreements import mark, save, upload


@pytest.fixture
def client(tmp_path):
    with StaffClient(create_app(tmp_path)) as client:
        yield client


def rename(client, identifier, name):
    return client.patch(f"/api/agreements/{identifier}", json={"name": name})


def test_rename_is_saved_and_keeps_the_boxes(client):
    agreement = upload(client).json()
    save(client, agreement["id"], [mark()])
    response = rename(client, agreement["id"], "  Kitchen remodel contract  ")
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Kitchen remodel contract"
    stored = client.get(f"/api/agreements/{agreement['id']}").json()
    assert stored["name"] == "Kitchen remodel contract"
    assert stored["marks"] == [mark()] and stored["version"] == 1  # unsaved box edits in the editor stay saveable


def test_a_taken_name_gets_a_number(client):
    taken = upload(client, name="Services.pdf").json()
    first, second = upload(client, name="First.pdf").json(), upload(client, name="Second.pdf").json()
    assert rename(client, first["id"], "services").json()["name"] == "services (1)"  # case is ignored
    assert rename(client, second["id"], "Services").json()["name"] == "Services (2)"
    assert client.get(f"/api/agreements/{taken['id']}").json()["name"] == "Services"


def test_keeping_its_own_name_adds_no_number(client):
    agreement = upload(client, name="Services.pdf").json()
    assert rename(client, agreement["id"], "SERVICES").json()["name"] == "SERVICES"


@pytest.mark.parametrize("name", ["", "   ", "x" * 201, "bad\x00name"])
def test_invalid_names_are_refused(client, name):
    agreement = upload(client).json()
    assert rename(client, agreement["id"], name).status_code == 422
    assert client.get(f"/api/agreements/{agreement['id']}").json()["name"] == agreement["name"]


def test_an_unknown_agreement_is_404(client):
    assert rename(client, "missing", "Anything").status_code == 404


def test_another_company_cannot_rename_it_and_names_are_per_company(tmp_path):
    app = create_app(tmp_path)
    with StaffClient(app, company="Alpha Ltd", email="a@alpha.example") as alpha, \
         StaffClient(app, company="Beta Ltd", email="b@beta.example") as beta:
        mine = upload(alpha, name="Services.pdf").json()
        theirs = upload(beta, name="Other.pdf").json()
        assert rename(beta, mine["id"], "Hijacked").status_code == 404
        assert alpha.get(f"/api/agreements/{mine['id']}").json()["name"] == "Services"
        assert rename(beta, theirs["id"], "Services").json()["name"] == "Services"  # another company's name is not taken
