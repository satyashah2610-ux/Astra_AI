import pytest
from pydantic import ValidationError
from app.models import SignatureMark, SaveMarks
from app.main import validate_pdf
from fastapi import HTTPException
from test_agreements import pdf_bytes, mark


@pytest.mark.parametrize('changes', [{'x': float('nan')}, {'width': float('inf')}, {'page': True}, {'page': '1'}, {'unexpected': 'value'}])
def test_invalid_values_are_rejected_by_model(changes):
    with pytest.raises(ValidationError):
        SignatureMark(**mark(**changes))


def test_exact_page_edges_are_valid():
    field = SignatureMark(**mark(x=.7, width=.3, y=.9, height=.1))
    assert field.x == .7


def test_duplicate_ids_are_invalid():
    with pytest.raises(ValidationError):
        SaveMarks(version=0, marks=[mark(), mark(page=2)])


@pytest.mark.parametrize('pages', [0, 101])
def test_page_count_limit(pages):
    with pytest.raises(HTTPException) as error:
        validate_pdf(pdf_bytes(pages=pages))
    assert error.value.status_code == 400
