from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool, StrictInt, StringConstraints, model_validator


PRINTED_ENCODING = "cp1252"  # what the PDF's built-in font can draw (Western European)
MARK_TYPES = Literal["signature", "text", "comment"]


def no_nul(text: str) -> str:
    """PostgreSQL text can't contain NUL characters; refuse them as invalid input instead of failing later."""
    if "\x00" in text:
        raise ValueError("Text can't contain NUL characters.")
    return text


def printable(text: str) -> str:
    """Text that will be drawn on the PDF must use characters the PDF font can print."""
    try:
        text.encode(PRINTED_ENCODING)
    except UnicodeEncodeError:
        raise ValueError("This text uses characters the PDF can't print yet. Use letters and symbols from Western European languages.") from None
    return text


def check_inside_page(box, message: str) -> None:
    if box.x + box.width > 1.000001 or box.y + box.height > 1.000001:
        raise ValueError(message)


class SignatureMark(BaseModel):
    """An item on a template: a signature box for the client, company text (printed), or a comment (a note, never printed)."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=100)
    page: StrictInt = Field(ge=1)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    type: MARK_TYPES = "signature"
    text: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def valid_item(self):
        check_inside_page(self, "Signature boxes must stay inside the PDF page.")
        if self.type == "signature":
            if self.text is not None:
                raise ValueError("Signature boxes don't hold text.")
            return self
        text = no_nul((self.text or "").strip())
        if not text:
            raise ValueError("Text and comments can't be empty.")
        self.text = printable(text) if self.type == "text" else text
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

    def stored_marks(self) -> list[dict]:
        """As stored: defaults omitted, so a plain signature box keeps its original shape (no type/text keys)."""
        return [mark.model_dump(exclude_defaults=True) for mark in self.marks]

EMAIL_SHAPE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), AfterValidator(no_nul)]
Email = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=254, pattern=EMAIL_SHAPE), AfterValidator(no_nul)]
Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), AfterValidator(no_nul)]
# The staff member's note to the signer, shown in the email. Blank means no note.
Message = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000), AfterValidator(no_nul), AfterValidator(lambda text: text or None)]


class FileCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Name
    client_name: Name
    signer_name: Name
    signer_email: Email
    agreement_id: Identifier
    message: Message = None


class SendOptions(BaseModel):
    """Optional body of send / reissue link."""
    model_config = ConfigDict(extra="forbid")
    email: StrictBool = True  # email the link to the signer


class FileUpdate(BaseModel):
    """Partial edit of a draft file. Omitted fields are unchanged; null is not allowed."""
    model_config = ConfigDict(extra="forbid")
    version: StrictInt = Field(ge=0)
    title: Name = None
    client_name: Name = None
    signer_name: Name = None
    signer_email: Email = None
    agreement_id: Identifier = None
    message: Message = None

    @model_validator(mode="after")
    def has_changes(self):
        changes = self.model_fields_set - {"version"}
        if not changes:
            raise ValueError("Change at least one field.")
        if any(getattr(self, name) is None for name in changes - {"message"}):  # only the optional message can be cleared
            raise ValueError("Fields cannot be cleared.")
        return self



ITEM_TYPES = Literal["signature", "initials", "name", "date", "text", "check", "dot"]
Image = Annotated[str, StringConstraints(min_length=1, max_length=700_000)]


class SignerItem(BaseModel):
    """Something the signer placed on a page. Name and date values are filled by the server, never the browser."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=100)
    type: ITEM_TYPES
    page: StrictInt = Field(ge=1)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    text: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def valid_item(self):
        check_inside_page(self, "Items must stay inside the PDF page.")
        if self.type != "text":
            if self.text is not None:
                raise ValueError("Only text items hold text.")
            return self
        text = no_nul((self.text or "").strip())
        if not text:
            raise ValueError("Text items can't be empty.")
        self.text = printable(text)
        return self


class InitialsAdoption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: Literal["typed", "drawn"]
    image: Image


class SignSubmission(BaseModel):
    """What the public signing page submits. Images are checked further by signatures.py; pages against the document."""
    model_config = ConfigDict(extra="forbid")
    name: Name
    method: Literal["typed", "drawn"]
    image: Image
    consent: Literal[True]
    initials: InitialsAdoption | None = None
    items: list[SignerItem] = Field(default_factory=list, max_length=200)
    utc_offset_minutes: StrictInt = Field(default=0, ge=-840, le=840)  # the signer's time zone, for the Date item

    @model_validator(mode="after")
    def consistent(self):
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("Each item must have a unique ID.")
        kinds = {item.type for item in self.items}
        if "initials" in kinds and self.initials is None:
            raise ValueError("Adopt your initials before signing.")
        if "name" in kinds:
            printable(self.name)  # the name is printed into a Name item
        return self


Password = Annotated[str, StringConstraints(min_length=10, max_length=200), AfterValidator(no_nul)]


class SignupBody(BaseModel):
    """A new company and its first staff member."""
    model_config = ConfigDict(extra="forbid")
    company: Name
    name: Name
    email: Email
    password: Password


class ForgotBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: Email


class ResetBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: Annotated[str, StringConstraints(min_length=20, max_length=200), AfterValidator(no_nul)]
    password: Password


DELETE_ACCOUNT_PHRASE = "I want to delete account"


class DeleteAccountBody(BaseModel):
    """Deleting the account needs exactly this phrase: same capitals, no extra spaces."""
    model_config = ConfigDict(extra="forbid")
    confirm: Annotated[str, StringConstraints(max_length=100)]

    @model_validator(mode="after")
    def phrase_matches(self):
        if self.confirm != DELETE_ACCOUNT_PHRASE:
            raise ValueError(f'Type "{DELETE_ACCOUNT_PHRASE}" to confirm.')
        return self


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: Email
    password: Annotated[str, StringConstraints(min_length=1, max_length=200), AfterValidator(no_nul)]
