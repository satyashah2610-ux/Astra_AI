import re
from io import BytesIO

import pytest
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, RectangleObject
from reportlab.pdfgen import canvas

from app.signed_pdf import Certificate, build_signed_pdf, display_box_to_user
from tests.signature_images import png_bytes

EVENTS = [
    {"type": "created", "at": "2026-11-09T10:00:00+00:00", "ip": None, "user_agent": None},
    {"type": "sent", "at": "2026-11-09T10:05:00+00:00", "ip": None, "user_agent": None},
    {"type": "link_reissued", "at": "2026-11-09T10:06:00+00:00", "ip": None, "user_agent": None},
    {"type": "viewed", "at": "2026-11-09T11:00:00+00:00", "ip": "203.0.113.7", "user_agent": "Mozilla/5.0 (Phone)"},
    {"type": "signed", "at": "2026-11-09T11:02:30+00:00", "ip": "203.0.113.7", "user_agent": "Mozilla/5.0 (Phone)"},
]


def certificate(**overrides):
    values = dict(document_name="MIND client agreement", document_sha256="a" * 64, file_id="file-123",
                  signer_name="Jordan Smith", signer_email="jordan@example.com", signature_name="Jordan A. Smith",
                  method="drawn", consent_text="I agree to sign this agreement electronically.",
                  signed_at="2026-11-09T11:02:30+00:00", ip="203.0.113.7", user_agent="Mozilla/5.0 (Phone)",
                  events=EVENTS, generated_at="2026-11-09T11:02:31+00:00")
    return Certificate(**{**values, **overrides})


def text_pdf(pages=2, size=(612, 792)):
    """A PDF whose pages carry identifiable text."""
    stream = BytesIO()
    doc = canvas.Canvas(stream, pagesize=size)
    for number in range(1, pages + 1):
        doc.drawString(72, size[1] - 72, f"Original page {number} text")
        doc.showPage()
    doc.save()
    return stream.getvalue()


def shaped_pdf(rotation=0, cropbox=None, size=(612, 792)):
    writer = PdfWriter()
    page = writer.add_blank_page(width=size[0], height=size[1])
    if cropbox:
        page.cropbox = RectangleObject(cropbox)
    if rotation:
        page[NameObject("/Rotate")] = __import__("pypdf").generic.NumberObject(rotation)
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


def box(**overrides):
    return {"id": "box-1", "page": 1, "x": .1, "y": .6, "width": .3, "height": .1, **overrides}


# --- reading where images were actually drawn ----------------------------------------------------

def multiply(m, n):
    a, b, c, d, e, f = m
    p, q, r, s, t, u = n
    return (a * p + b * r, a * q + b * s, c * p + d * r, c * q + d * s, e * p + f * r + t, e * q + f * s + u)


def image_rects(page):
    """User-space bounding boxes of every image drawn on a page, from its content stream."""
    xobjects = page["/Resources"].get("/XObject", {})
    ctm, stack, rects = (1, 0, 0, 1, 0, 0), [], []
    for operands, operator in page.get_contents().operations:
        if operator == b"q":
            stack.append(ctm)
        elif operator == b"Q":
            ctm = stack.pop()
        elif operator == b"cm":
            ctm = multiply(tuple(float(v) for v in operands), ctm)
        elif operator == b"Do" and xobjects[operands[0]].get_object().get("/Subtype") == "/Image":
            a, b, c, d, e, f = ctm
            xs = [e, a + e, c + e, a + c + e]
            ys = [f, b + f, d + f, b + d + f]
            rects.append((min(xs), min(ys), max(xs), max(ys)))
    return rects


def inside(inner, outer, tolerance=0.5):
    return (inner[0] >= outer[0] - tolerance and inner[1] >= outer[1] - tolerance
            and inner[2] <= outer[2] + tolerance and inner[3] <= outer[3] + tolerance)


def flat(text):
    return re.sub(r"\s+", "", text)


# --- coordinate mapping ----------------------------------------------------------------------------

@pytest.mark.parametrize("rotation,expected", [
    (0, (61.2, 316.8, 244.8, 396.0)),     # x .1-.4 of 612, y .5-.6 from top of 792
    (90, (306.0, 79.2, 367.2, 316.8)),    # displayed 792 wide x 612 tall: u runs up user y, v runs along user x
    (180, (367.2, 396.0, 550.8, 475.2)),  # upside down: u runs along -x, v runs up user y
    (270, (244.8, 475.2, 306.0, 712.8)),  # u runs down user y, v runs along -x
])
def test_display_box_maps_to_user_space_for_each_rotation(rotation, expected):
    rect = display_box_to_user({"x": .1, "y": .5, "width": .3, "height": .1}, (0, 0, 612, 792), rotation)
    assert rect == pytest.approx(expected)


def test_display_box_respects_an_offset_crop_box():
    rect = display_box_to_user({"x": 0, "y": 0, "width": .5, "height": .5}, (50, 60, 550, 760), 0)
    assert rect == pytest.approx((50, 410, 300, 760))


def test_rotation_is_normalized():
    base = display_box_to_user({"x": .1, "y": .5, "width": .3, "height": .1}, (0, 0, 612, 792), 90)
    assert display_box_to_user({"x": .1, "y": .5, "width": .3, "height": .1}, (0, 0, 612, 792), -270) == pytest.approx(base)
    assert display_box_to_user({"x": .1, "y": .5, "width": .3, "height": .1}, (0, 0, 612, 792), 450) == pytest.approx(base)


# --- stamping -----------------------------------------------------------------------------------------

def test_signature_is_stamped_inside_each_box_and_nowhere_else():
    marks = [box(page=2), box(id="box-2", page=2, y=.8)]
    signed = PdfReader(BytesIO(build_signed_pdf(text_pdf(pages=2), marks, png_bytes(), certificate())))
    assert image_rects(signed.pages[0]) == []
    rects = image_rects(signed.pages[1])
    assert len(rects) == 2
    for mark, rect in zip(marks, sorted(rects, key=lambda r: -r[3])):
        assert inside(rect, display_box_to_user(mark, (0, 0, 612, 792), 0))


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_signature_lands_in_the_box_on_rotated_pages(rotation):
    signed = PdfReader(BytesIO(build_signed_pdf(shaped_pdf(rotation), [box()], png_bytes(), certificate())))
    rects = image_rects(signed.pages[0])
    assert len(rects) == 1
    assert inside(rects[0], display_box_to_user(box(), (0, 0, 612, 792), rotation))
    assert signed.pages[0].rotation % 360 == rotation


def test_signature_lands_in_the_box_with_an_offset_crop_box():
    crop = (50, 60, 550, 760)
    signed = PdfReader(BytesIO(build_signed_pdf(shaped_pdf(cropbox=crop), [box()], png_bytes(), certificate())))
    assert inside(image_rects(signed.pages[0])[0], display_box_to_user(box(), crop, 0))


def test_original_pages_and_text_are_preserved():
    signed = PdfReader(BytesIO(build_signed_pdf(text_pdf(pages=3), [box(page=3)], png_bytes(), certificate())))
    assert len(signed.pages) == 4
    for number in range(1, 4):
        assert f"Original page {number} text" in signed.pages[number - 1].extract_text()


# --- certificate page ----------------------------------------------------------------------------

def test_certificate_page_records_the_evidence():
    signed = PdfReader(BytesIO(build_signed_pdf(text_pdf(pages=1), [box()], png_bytes(), certificate())))
    page = signed.pages[-1]
    text = page.extract_text()
    for expected in ["Certificate of completion", "MIND client agreement", "Jordan Smith", "jordan@example.com",
                     "Jordan A. Smith", "Drawn", "I agree to sign this agreement electronically.", "203.0.113.7",
                     "Mozilla/5.0 (Phone)", "file-123", "2026-11-09 11:02:30 UTC"]:
        assert flat(expected) in flat(text), expected
    assert "a" * 64 in flat(text)
    for label in ["Created", "Sent", "Link reissued", "Opened by signer", "Signed"]:
        assert label in text
    assert len(image_rects(page)) == 1  # the adopted signature is shown on the certificate too


def test_certificate_labels_signing_email_events():
    events = EVENTS[:2] + [{"type": "email_sent", "at": "2026-11-09T10:05:01+00:00", "ip": None, "user_agent": None},
                           {"type": "email_failed", "at": "2026-11-09T10:06:01+00:00", "ip": None, "user_agent": None}] + EVENTS[2:]
    text = PdfReader(BytesIO(build_signed_pdf(text_pdf(pages=1), [box()], png_bytes(), certificate(events=events)))).pages[-1].extract_text()
    text = " ".join(text.split())  # a long label wraps in its narrow column
    assert "Email sent" in text and "Email not delivered" in text
    assert "email_sent" not in text and "email_failed" not in text


@pytest.mark.parametrize("size", [(20, 1000), (2000, 10)])  # extreme shapes the signing API accepts
def test_certificate_fits_any_accepted_signature_shape(size):
    signed = PdfReader(BytesIO(build_signed_pdf(text_pdf(pages=1), [box()], png_bytes(size), certificate())))
    assert len(signed.pages) == 2  # one certificate page; a tall signature must not break the layout


def test_certificate_prints_untrusted_text_literally():
    signed = PdfReader(BytesIO(build_signed_pdf(text_pdf(pages=1), [box()], png_bytes(),
                                                certificate(signature_name="Jordan <b>&amp; Co</b>", document_name="A & B <i>"))))
    text = signed.pages[-1].extract_text()
    assert flat("Jordan <b>&amp; Co</b>") in flat(text)
    assert flat("A & B <i>") in flat(text)


def test_signed_pdf_metadata_names_the_product_and_document():
    signed = PdfReader(BytesIO(build_signed_pdf(text_pdf(pages=1), [box()], png_bytes(), certificate())))
    assert signed.metadata.producer == "Astra Sign"
    assert signed.metadata.title == "MIND client agreement (signed)"


def image_axes(page):
    """For each image drawn on a page, the user-space direction of the image's own left-to-right axis."""
    xobjects = page["/Resources"].get("/XObject", {})
    ctm, stack, axes = (1, 0, 0, 1, 0, 0), [], []
    for operands, operator in page.get_contents().operations:
        if operator == b"q":
            stack.append(ctm)
        elif operator == b"Q":
            ctm = stack.pop()
        elif operator == b"cm":
            ctm = multiply(tuple(float(v) for v in operands), ctm)
        elif operator == b"Do" and xobjects[operands[0]].get_object().get("/Subtype") == "/Image":
            a, b = ctm[0], ctm[1]
            length = (a * a + b * b) ** 0.5
            axes.append((round(a / length, 6), round(b / length, 6)))
    return axes


@pytest.mark.parametrize("rotation,reading_direction", [(0, (1, 0)), (90, (0, 1)), (180, (-1, 0)), (270, (0, -1))])
def test_signature_reads_left_to_right_as_displayed(rotation, reading_direction):
    # A viewer turns the page clockwise by /Rotate; the signature's own x-axis must point to the displayed right.
    signed = PdfReader(BytesIO(build_signed_pdf(shaped_pdf(rotation), [box()], png_bytes(), certificate())))
    assert image_axes(signed.pages[0]) == [pytest.approx(reading_direction, abs=1e-6)]
