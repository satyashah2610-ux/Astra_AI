import base64

import pytest

from app.signatures import MAX_SIGNATURE_BYTES, SignatureImageError, decode_signature_png
from tests.signature_images import data_url, png_bytes


def test_accepts_a_real_png_and_returns_its_bytes():
    content = png_bytes()
    assert decode_signature_png(data_url(content)) == content


def test_accepts_greyscale_png():
    assert decode_signature_png(data_url(png_bytes(mode="L")))


@pytest.mark.parametrize("value", [
    "",
    "image/png;base64," + base64.b64encode(png_bytes()).decode(),
    "data:image/jpeg;base64," + base64.b64encode(png_bytes()).decode(),
    "data:image/png;base64,not*valid*base64",
    data_url(b"GIF89a not a png"),
    data_url(b"\x89PNG\r\n\x1a\n" + b"corrupt body" * 10),
    data_url(png_bytes(size=(5, 5))),
    data_url(png_bytes(size=(4000, 200))),
    data_url(png_bytes(size=(400, 3000))),
])
def test_rejects_invalid_signature_images(value):
    with pytest.raises(SignatureImageError):
        decode_signature_png(value)


def test_rejects_oversize_data_before_decoding():
    oversize = b"\x89PNG\r\n\x1a\n" + b"0" * MAX_SIGNATURE_BYTES
    with pytest.raises(SignatureImageError):
        decode_signature_png(data_url(oversize))
