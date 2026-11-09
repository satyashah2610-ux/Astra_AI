import pytest
from pydantic import ValidationError

from app.models import SaveMarks, SignatureMark, SignerItem, SignSubmission
from tests.test_agreements import mark


# --- template marks: signature boxes, company text, comments ---------------------------------------

def test_mark_without_type_is_a_signature_box_and_keeps_its_stored_shape():
    saved = SaveMarks(version=0, marks=[mark()])
    assert saved.marks[0].type == "signature"
    assert saved.stored_marks() == [mark()]  # legacy shape: no type/text keys for plain signature boxes


def test_text_and_comment_marks_keep_their_type_and_trimmed_text():
    saved = SaveMarks(version=0, marks=[mark(id="t", type="text", text="  Project: Riverside  "), mark(id="c", type="comment", text="Tick your plan")])
    assert saved.stored_marks() == [mark(id="t", type="text", text="Project: Riverside"), mark(id="c", type="comment", text="Tick your plan")]


@pytest.mark.parametrize("changes", [
    {"type": "text"}, {"type": "text", "text": "   "}, {"type": "comment", "text": ""}, {"type": "text", "text": "x" * 1001},
    {"type": "signature", "text": "not allowed"}, {"type": "checkbox"}, {"type": "text", "text": "सत्य"},
])
def test_invalid_template_marks_are_rejected(changes):
    with pytest.raises(ValidationError):
        SignatureMark(**mark(**changes))


def test_comments_may_use_any_script_because_they_are_never_printed():
    assert SignatureMark(**mark(type="comment", text="कृपया यहाँ टिक करें")).text == "कृपया यहाँ टिक करें"


def test_printed_text_accepts_western_european_characters():
    assert SignatureMark(**mark(type="text", text="Café Müller – €5")).text == "Café Müller – €5"


# --- items the signer places ------------------------------------------------------------------------

def item(**overrides):
    return {"id": "i1", "type": "check", "page": 1, "x": .5, "y": .5, "width": .03, "height": .02, **overrides}


def submission(**overrides):
    return {"name": "Jordan Smith", "method": "typed", "image": "data:image/png;base64,AAAA", "consent": True, **overrides}


@pytest.mark.parametrize("kind", ["signature", "initials", "name", "date", "check", "dot"])
def test_items_without_text_are_valid(kind):
    assert SignerItem(**item(type=kind)).type == kind


def test_text_item_requires_trimmed_printable_text():
    assert SignerItem(**item(type="text", text="  Unit 4B  ")).text == "Unit 4B"


@pytest.mark.parametrize("changes", [
    {"type": "text"}, {"type": "text", "text": " "}, {"type": "text", "text": "x" * 501}, {"type": "text", "text": "王小明"},
    {"type": "check", "text": "x"}, {"type": "stamp"}, {"x": .99, "width": .05}, {"page": 0}, {"page": True}, {"extra": 1},
    {"width": 0}, {"x": float("nan")},
])
def test_invalid_items_are_rejected(changes):
    with pytest.raises(ValidationError):
        SignerItem(**item(**changes))


def test_submission_defaults_to_no_items():
    body = SignSubmission(**submission())
    assert body.items == [] and body.initials is None and body.utc_offset_minutes == 0


@pytest.mark.parametrize("changes", [
    {"items": [item(), item()]},  # duplicate ids
    {"items": [item(id=f"i{n}") for n in range(201)]},
    {"items": [item(type="initials")]},  # initials placed but not adopted
    {"utc_offset_minutes": 841}, {"utc_offset_minutes": -841},
    {"items": [item(type="name")], "name": "王小明"},  # the name will be printed
])
def test_invalid_submissions_are_rejected(changes):
    with pytest.raises(ValidationError):
        SignSubmission(**submission(**changes))


def test_initials_items_with_adopted_initials_are_valid():
    body = SignSubmission(**submission(items=[item(type="initials")], initials={"method": "typed", "image": "data:image/png;base64,AAAA"}))
    assert body.initials.method == "typed"


def test_unprintable_name_is_fine_when_no_name_item_is_placed():
    assert SignSubmission(**submission(name="王小明")).name == "王小明"
