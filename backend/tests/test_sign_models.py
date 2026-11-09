import pytest
from pydantic import ValidationError

from app.models import SignSubmission


def valid(**overrides):
    return {"name": "Jordan Smith", "method": "typed", "image": "data:image/png;base64,AAAA", "consent": True, **overrides}


def test_valid_submission_is_trimmed():
    assert SignSubmission(**valid(name="  Jordan Smith ")).name == "Jordan Smith"


@pytest.mark.parametrize("method", ["typed", "drawn"])
def test_both_signature_methods_are_accepted(method):
    assert SignSubmission(**valid(method=method)).method == method


@pytest.mark.parametrize("changes", [
    {"consent": False}, {"consent": "yes"}, {"consent": None}, {"method": "uploaded"}, {"name": ""},
    {"name": "x" * 201}, {"image": ""}, {"image": "x" * 700_001}, {"extra": 1},
])
def test_invalid_submissions_are_rejected(changes):
    with pytest.raises(ValidationError):
        SignSubmission(**valid(**changes))


def test_consent_is_required():
    body = valid()
    del body["consent"]
    with pytest.raises(ValidationError):
        SignSubmission(**body)
