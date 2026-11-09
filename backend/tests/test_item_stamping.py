import re
from io import BytesIO

import pytest
from pypdf import PdfReader

from app.signed_pdf import Stamp, build_signed_pdf, display_box_to_user, print_text_marks
from tests.signature_images import png_bytes
from tests.test_signed_pdf import certificate, image_rects, inside, multiply, shaped_pdf, text_pdf

BOX = {"x": .2, "y": .4, "width": .3, "height": .05}


def path_bounds(page):
    """Bounding box (user space) of path points drawn on a page. Rectangles are skipped: merging pages adds a page-size clip `re`."""
    ctm, stack, xs, ys = (1, 0, 0, 1, 0, 0), [], [], []

    def add(x, y):
        a, b, c, d, e, f = ctm
        xs.append(a * x + c * y + e)
        ys.append(b * x + d * y + f)

    for operands, operator in page.get_contents().operations:
        values = [float(v) for v in operands] if operator in (b"cm", b"m", b"l", b"c") else []
        if operator == b"q":
            stack.append(ctm)
        elif operator == b"Q":
            ctm = stack.pop()
        elif operator == b"cm":
            ctm = multiply(tuple(values), ctm)
        elif operator in (b"m", b"l"):
            add(*values)
        elif operator == b"c":
            for i in range(0, 6, 2):
                add(values[i], values[i + 1])
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def text_positions(page):
    """(text, x, y) of every text run, in user space."""
    runs = []

    def visit(text, cm, tm, *_):
        if text.strip():
            x, y = tm[4], tm[5]
            runs.append((text, x * cm[0] + y * cm[2] + cm[4], x * cm[1] + y * cm[3] + cm[5]))

    page.extract_text(visitor_text=visit)
    return runs


def stamped(kind, rotation=0, **extra):
    stamp = Stamp(kind=kind, page=1, box=BOX, **extra)
    signed = build_signed_pdf(shaped_pdf(rotation), [], png_bytes(), certificate(), stamps=[stamp])
    return PdfReader(BytesIO(signed)).pages[0]


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("kind", ["check", "dot"])
def test_ticks_and_dots_are_drawn_inside_their_box(kind, rotation):
    bounds = path_bounds(stamped(kind, rotation))
    assert bounds is not None
    assert inside(bounds, display_box_to_user(BOX, (0, 0, 612, 792), rotation), tolerance=1.5)


def test_tick_and_dot_look_different():
    tick, dot = stamped("check").get_contents().get_data(), stamped("dot").get_contents().get_data()
    assert b" c\n" in dot or b" c " in dot  # curves: a filled circle
    assert tick != dot


@pytest.mark.parametrize("rotation", [0, 90])
def test_text_is_printed_inside_its_box(rotation):
    page = stamped("text", rotation, text="Unit 4B, Riverside")
    assert "Unit 4B, Riverside" in page.extract_text()
    rect = display_box_to_user(BOX, (0, 0, 612, 792), rotation)
    for _, x, y in text_positions(page):
        assert rect[0] - 1 <= x <= rect[2] + 1 and rect[1] - 1 <= y <= rect[3] + 1


def test_long_text_wraps_and_shrinks_to_stay_inside_the_box():
    words = "The client confirms the site address and access arrangements described in schedule two".split()
    box = {"x": .1, "y": .1, "width": .25, "height": .06}
    signed = build_signed_pdf(shaped_pdf(), [], png_bytes(), certificate(), stamps=[Stamp(kind="text", page=1, box=box, text=" ".join(words))])
    page = PdfReader(BytesIO(signed)).pages[0]
    text = re.sub(r"\s+", " ", page.extract_text())
    assert all(word in text for word in words)
    rect = display_box_to_user(box, (0, 0, 612, 792), 0)
    runs = text_positions(page)
    assert len(runs) > 1  # wrapped onto several lines
    assert all(rect[1] - 1 <= y <= rect[3] + 1 for _, _, y in runs)


@pytest.mark.parametrize("rotation", [0, 270])
def test_image_items_are_placed_inside_their_box(rotation):
    rects = image_rects(stamped("image", rotation, image=png_bytes((200, 120))))
    assert len(rects) == 1
    assert inside(rects[0], display_box_to_user(BOX, (0, 0, 612, 792), rotation))


def test_stamps_only_touch_their_own_page():
    signed = build_signed_pdf(text_pdf(pages=2), [], png_bytes(), certificate(), stamps=[Stamp(kind="text", page=2, box=BOX, text="Only on two")])
    reader = PdfReader(BytesIO(signed))
    assert "Only on two" not in reader.pages[0].extract_text()
    assert "Only on two" in reader.pages[1].extract_text()


def test_certificate_lists_what_the_signer_completed():
    cert = certificate(signer_items=(("1", "Tick", "✓"), ("2", "Text", "Unit 4B"), ("2", "Date signed", "09 Nov 2026")))
    signed = build_signed_pdf(text_pdf(pages=2), [], png_bytes(), cert)
    reader = PdfReader(BytesIO(signed))
    page = " ".join(p.extract_text() for p in reader.pages[2:])  # the certificate may run to more than one page
    assert "Completed by the signer" in page
    for value in ["Tick", "Unit 4B", "Date signed", "09 Nov 2026"]:
        assert value in page


# --- company text printed at send ---------------------------------------------------------------------

def test_company_text_is_printed_and_comments_and_boxes_are_not():
    marks = [{"id": "t", "page": 1, "type": "text", "text": "Project: Riverside", **BOX},
             {"id": "c", "page": 1, "type": "comment", "text": "Please tick your plan", "x": .5, "y": .7, "width": .2, "height": .05},
             {"id": "s", "page": 1, "x": .1, "y": .8, "width": .3, "height": .06}]
    printed = PdfReader(BytesIO(print_text_marks(text_pdf(pages=1), marks)))
    text = printed.pages[0].extract_text()
    assert "Project: Riverside" in text
    assert "Original page 1 text" in text
    assert "Please tick your plan" not in text
    assert image_rects(printed.pages[0]) == []
    assert len(printed.pages) == 1


def test_printing_without_text_marks_returns_the_original_unchanged():
    original = text_pdf(pages=1)
    assert print_text_marks(original, [{"id": "s", "page": 1, **BOX}]) == original
