import pytest
from pydantic import ValidationError

from app.models import FileCreate, FileUpdate


def valid(**overrides):
    return {"title": "Smith kitchen remodel", "client_name": "Smith Family", "signer_name": "Jordan Smith",
            "signer_email": "jordan@example.com", "agreement_id": "agreement-1", **overrides}


def test_whitespace_is_trimmed():
    model = FileCreate(**valid(title="  Smith job  ", signer_email=" jordan@example.com "))
    assert model.title == "Smith job"
    assert model.signer_email == "jordan@example.com"


@pytest.mark.parametrize("changes", [
    {"title": ""}, {"title": "   "}, {"client_name": ""}, {"signer_name": ""},
    {"title": "x" * 201}, {"client_name": "x" * 201}, {"signer_name": "x" * 201},
    {"signer_email": "not-an-email"}, {"signer_email": "a@b"}, {"signer_email": "a b@example.com"},
    {"signer_email": "x" * 250 + "@example.com"}, {"agreement_id": ""}, {"unexpected": "field"},
])
def test_invalid_file_fields_are_rejected(changes):
    with pytest.raises(ValidationError):
        FileCreate(**valid(**changes))


def test_update_accepts_partial_changes():
    update = FileUpdate(version=0, signer_name=" Alex Smith ")
    assert update.signer_name == "Alex Smith"
    assert update.model_dump(exclude_unset=True, exclude={"version"}) == {"signer_name": "Alex Smith"}


@pytest.mark.parametrize("body", [{"version": 0}, {"signer_name": "Alex"}, {"version": -1, "title": "x"},
                                  {"version": 0, "title": None}, {"version": 0, "status": "signed"}])
def test_invalid_updates_are_rejected(body):
    with pytest.raises(ValidationError):
        FileUpdate(**body)
