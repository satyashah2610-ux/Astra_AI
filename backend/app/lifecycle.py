"""File status state machine: draft -> sent -> viewed -> signed."""
from enum import StrEnum


class FileStatus(StrEnum):
    DRAFT = "draft"
    SENT = "sent"
    VIEWED = "viewed"
    SIGNED = "signed"


_ALLOWED = {
    FileStatus.DRAFT: {FileStatus.SENT},
    FileStatus.SENT: {FileStatus.VIEWED, FileStatus.SIGNED},
    FileStatus.VIEWED: {FileStatus.SIGNED},
    FileStatus.SIGNED: set(),
}


def can_transition(current: str, target: str) -> bool:
    return FileStatus(target) in _ALLOWED[FileStatus(current)]
