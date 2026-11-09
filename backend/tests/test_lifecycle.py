import itertools

import pytest

from app.lifecycle import FileStatus, can_transition

ALLOWED = {
    (FileStatus.DRAFT, FileStatus.SENT),
    (FileStatus.SENT, FileStatus.VIEWED),
    (FileStatus.SENT, FileStatus.SIGNED),
    (FileStatus.VIEWED, FileStatus.SIGNED),
}


def test_status_values_match_database_strings():
    assert [status.value for status in FileStatus] == ["draft", "sent", "viewed", "signed"]


@pytest.mark.parametrize("current,target", sorted(ALLOWED))
def test_allowed_transitions(current, target):
    assert can_transition(current, target)


@pytest.mark.parametrize("current,target", [pair for pair in itertools.product(FileStatus, repeat=2) if pair not in ALLOWED])
def test_every_other_transition_is_rejected(current, target):
    assert not can_transition(current, target)


def test_accepts_plain_strings_from_the_database():
    assert can_transition("draft", "sent")
    assert not can_transition("signed", "draft")
