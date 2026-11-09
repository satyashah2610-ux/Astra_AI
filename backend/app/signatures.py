"""Validation of signature images submitted from the public signing page."""
import base64
import binascii
from io import BytesIO

from PIL import Image

MAX_SIGNATURE_BYTES = 512 * 1024
PREFIX = "data:image/png;base64,"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MIN_SIZE = (20, 10)
MAX_SIZE = (2000, 1000)


class SignatureImageError(ValueError):
    pass


def decode_signature_png(data_url: str) -> bytes:
    """Return the PNG bytes of a `data:image/png;base64,...` URL, or raise SignatureImageError."""
    if not isinstance(data_url, str) or not data_url.startswith(PREFIX):
        raise SignatureImageError("The signature must be a PNG image.")
    encoded = data_url[len(PREFIX):]
    if len(encoded) > (MAX_SIGNATURE_BYTES + 2) // 3 * 4:
        raise SignatureImageError("The signature image is too large.")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise SignatureImageError("The signature image could not be read.") from exc
    if len(content) > MAX_SIGNATURE_BYTES:
        raise SignatureImageError("The signature image is too large.")
    if not content.startswith(PNG_MAGIC):
        raise SignatureImageError("The signature must be a PNG image.")
    try:
        with Image.open(BytesIO(content)) as image:
            width, height = image.size  # header only; checked before any full decode
            if image.format != "PNG":
                raise SignatureImageError("The signature must be a PNG image.")
            if not (MIN_SIZE[0] <= width <= MAX_SIZE[0] and MIN_SIZE[1] <= height <= MAX_SIZE[1]):
                raise SignatureImageError("The signature image has an unexpected size.")
            image.verify()
        with Image.open(BytesIO(content)) as image:
            image.load()  # full decode catches corrupt pixel data that verify() misses
    except SignatureImageError:
        raise
    except Exception as exc:
        raise SignatureImageError("The signature image could not be read.") from exc
    return content
