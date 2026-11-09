from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints, model_validator


class SignatureMark(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=100)
    page: StrictInt = Field(ge=1)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def inside_page(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("Signature boxes must stay inside the PDF page.")
        return self


class SaveMarks(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: StrictInt = Field(ge=0)
    marks: list[SignatureMark] = Field(max_length=1000)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({mark.id for mark in self.marks}) != len(self.marks):
            raise ValueError("Each signature box must have a unique ID.")
        return self



EMAIL_SHAPE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Email = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=254, pattern=EMAIL_SHAPE)]
Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class FileCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Name
    client_name: Name
    signer_name: Name
    signer_email: Email
    agreement_id: Identifier


class FileUpdate(BaseModel):
    """Partial edit of a draft file. Omitted fields are unchanged; null is not allowed."""
    model_config = ConfigDict(extra="forbid")
    version: StrictInt = Field(ge=0)
    title: Name = None
    client_name: Name = None
    signer_name: Name = None
    signer_email: Email = None
    agreement_id: Identifier = None

    @model_validator(mode="after")
    def has_changes(self):
        changes = self.model_fields_set - {"version"}
        if not changes:
            raise ValueError("Change at least one field.")
        if any(getattr(self, name) is None for name in changes):
            raise ValueError("Fields cannot be cleared.")
        return self



class SignSubmission(BaseModel):
    """What the public signing page submits. The image is checked further by signatures.py."""
    model_config = ConfigDict(extra="forbid")
    name: Name
    method: Literal["typed", "drawn"]
    image: Annotated[str, StringConstraints(min_length=1, max_length=700_000)]
    consent: Literal[True]
