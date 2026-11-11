"""Build the signed document: stamp the signature into every box and append a certificate page.

Pure functions: bytes and plain data in, PDF bytes out. Nothing here touches storage.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from xml.sax.saxutils import escape

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .signatures import decode_signature_png

EVENT_LABELS = {"created": "Created", "sent": "Sent", "link_reissued": "Link reissued", "viewed": "Viewed", "signed": "Signed",
                "email_sent": "Email sent", "email_failed": "Email not delivered", "reminder_sent": "Reminder sent",
                "reminder_failed": "Reminder not delivered", "signed_notice_sent": "Company notified",
                "signed_notice_failed": "Company notice not delivered"}
METHOD_LABELS = {"typed": "Typed", "drawn": "Drawn"}
SIGNATURE_MAX_WIDTH, SIGNATURE_MAX_HEIGHT = 2.2 * inch, 0.9 * inch  # signature on the certificate page
SIGNER_INK, COMPANY_INK = "#1d2c4d", "#111111"
TEXT_FONT = "Helvetica"


@dataclass(frozen=True)
class Certificate:
    document_name: str
    document_sha256: str
    file_id: str
    signer_name: str
    signer_email: str
    signature_name: str
    method: str
    consent_text: str
    signed_at: str
    ip: str | None
    user_agent: str | None
    events: list
    generated_at: str
    signer_items: tuple = ()


@dataclass(frozen=True)
class Stamp:
    """One thing to draw in a box on a page: an image (signature, initials), text, a tick or a dot."""
    kind: str  # "image" | "text" | "check" | "dot"
    page: int
    box: dict  # x, y, width, height as fractions of the displayed page
    image: bytes | None = None
    text: str | None = None
    ink: str = SIGNER_INK


def mark_type(mark: dict) -> str:
    """Template marks saved before text and comments existed have no type: they are signature boxes."""
    return mark.get("type") or "signature"


# --- coordinates ------------------------------------------------------------------------------------

def normalize_rotation(rotation) -> int:
    """PDF /Rotate as 0, 90, 180 or 270 (clockwise, as viewers display it)."""
    return (round(int(rotation) / 90) * 90) % 360


def display_point(u: float, v: float, cropbox, rotation: int) -> tuple[float, float]:
    """A point given as fractions of the displayed page (top-left origin) -> PDF user space."""
    llx, lly, urx, ury = cropbox
    w, h = urx - llx, ury - lly
    rotation = normalize_rotation(rotation)
    if rotation == 0:
        return llx + u * w, ury - v * h
    if rotation == 90:
        return llx + v * w, lly + u * h
    if rotation == 180:
        return urx - u * w, lly + v * h
    return urx - v * w, ury - u * h


def display_box_to_user(box, cropbox, rotation) -> tuple[float, float, float, float]:
    """A signature box (fractions of the displayed page) -> (x0, y0, x1, y1) in PDF user space."""
    corners = [display_point(box["x"], box["y"], cropbox, rotation),
               display_point(box["x"] + box["width"], box["y"] + box["height"], cropbox, rotation)]
    xs, ys = [c[0] for c in corners], [c[1] for c in corners]
    return min(xs), min(ys), max(xs), max(ys)


def page_box(page) -> tuple[float, float, float, float]:
    crop = page.cropbox  # what PDF.js displays (defaults to the media box)
    return float(crop.left), float(crop.bottom), float(crop.right), float(crop.top)


# --- stamping ---------------------------------------------------------------------------------------

def wrap(text: str, size: float, width: float) -> list[str]:
    """Greedy word wrap for Helvetica at `size`; words longer than the line are split."""
    lines: list[str] = []
    for paragraph in text.splitlines() or [""]:
        line = ""
        for word in paragraph.split(" "):
            candidate = f"{line} {word}" if line else word
            if stringWidth(candidate, TEXT_FONT, size) <= width:
                line = candidate
                continue
            if line:
                lines.append(line)
            while stringWidth(word, TEXT_FONT, size) > width and len(word) > 1:
                cut = max(1, next((i for i in range(len(word), 0, -1) if stringWidth(word[:i], TEXT_FONT, size) <= width), 1))
                lines.append(word[:cut])
                word = word[cut:]
            line = word
        lines.append(line)
    return lines


def draw_text(overlay, text: str, width: float, height: float, ink: str) -> None:
    """Text inside a width x height box: wrapped, shrunk until it fits, centred vertically."""
    pad = min(2.0, width * 0.05, height * 0.1)
    size = max(4.0, min(height * 0.7, 14.0))
    while True:
        lines = wrap(text, size, width - 2 * pad)
        if len(lines) * size * 1.2 <= height - pad or size <= 4.0:
            break
        size -= 0.5
    block = len(lines) * size * 1.2
    baseline = height - (height - block) / 2 - size  # first line, block centred in the box
    overlay.setFillColor(colors.HexColor(ink))
    overlay.setFont(TEXT_FONT, size)
    for line in lines:
        overlay.drawString(pad, baseline, line)
        baseline -= size * 1.2


def draw_check(overlay, width: float, height: float, ink: str) -> None:
    side = min(width, height) * 0.9
    ox, oy = (width - side) / 2, (height - side) / 2
    overlay.setStrokeColor(colors.HexColor(ink))
    overlay.setLineWidth(max(0.8, side * 0.12))
    overlay.setLineCap(1)
    overlay.setLineJoin(1)
    path = overlay.beginPath()
    path.moveTo(ox + side * .15, oy + side * .5)
    path.lineTo(ox + side * .4, oy + side * .22)
    path.lineTo(ox + side * .88, oy + side * .82)
    overlay.drawPath(path, stroke=1, fill=0)


def draw_dot(overlay, width: float, height: float, ink: str) -> None:
    overlay.setFillColor(colors.HexColor(ink))
    overlay.circle(width / 2, height / 2, min(width, height) * 0.3, stroke=0, fill=1)


def stamp_page(page, stamps: list[Stamp]) -> None:
    """Draw each stamp upright inside its box, as the viewer will display the page."""
    cropbox, rotation = page_box(page), normalize_rotation(page.rotation)
    llx, lly, urx, ury = cropbox
    width, height = (urx - llx, ury - lly) if rotation in (0, 180) else (ury - lly, urx - llx)
    stream = BytesIO()
    overlay = canvas.Canvas(stream, pagesize=(max(float(page.mediabox.right), 1.0), max(float(page.mediabox.top), 1.0)))
    images: dict[bytes, ImageReader] = {}  # each image decoded once, reused for every box
    for stamp in stamps:
        box = stamp.box
        w, h = box["width"] * width, box["height"] * height
        # Anchor at the box's displayed bottom-left corner, in a frame turned against the page rotation.
        x, y = display_point(box["x"], box["y"] + box["height"], cropbox, rotation)
        overlay.saveState()
        overlay.translate(x, y)
        overlay.rotate(rotation)
        if stamp.kind == "image":
            reader = images.get(stamp.image)
            if reader is None:
                reader = images[stamp.image] = ImageReader(BytesIO(stamp.image))
            overlay.drawImage(reader, 0, 0, w, h, mask="auto", preserveAspectRatio=True, anchor="c")
        elif stamp.kind == "text":
            draw_text(overlay, stamp.text or "", w, h, stamp.ink)
        elif stamp.kind == "check":
            draw_check(overlay, w, h, stamp.ink)
        elif stamp.kind == "dot":
            draw_dot(overlay, w, h, stamp.ink)
        else:
            raise ValueError(f"Unknown stamp kind: {stamp.kind}")
        overlay.restoreState()
    overlay.save()
    page.merge_page(PdfReader(stream).pages[0])


def apply_stamps(writer: PdfWriter, stamps: list[Stamp]) -> None:
    for number, page in enumerate(writer.pages, start=1):
        on_page = [stamp for stamp in stamps if stamp.page == number]
        if on_page:
            stamp_page(page, on_page)


def company_stamps(marks: list, date_text: str) -> list[Stamp]:
    """What the company filled in on the template. Comments and the client's signature boxes are not printed."""
    stamps, images = [], {}  # each adopted image decoded once, however many pages carry it
    for mark in marks:
        kind, box = mark_type(mark), dict(page=mark["page"], box=mark, ink=COMPANY_INK)
        if kind in ("text", "name"):
            stamps.append(Stamp(kind="text", text=mark["text"], **box))
        elif kind == "date":
            stamps.append(Stamp(kind="text", text=date_text, **box))
        elif kind in ("check", "dot"):
            stamps.append(Stamp(kind=kind, **box))
        elif kind in ("initials", "company_signature"):
            if mark["image"] not in images:
                images[mark["image"]] = decode_signature_png(mark["image"])
            stamps.append(Stamp(kind="image", image=images[mark["image"]], **box))
    return stamps


def print_text_marks(original: bytes, marks: list, date_text: str = "") -> bytes:
    """The document as sent: the company's items (text, name, date, ticks, initials, signature) printed onto it."""
    stamps = company_stamps(marks, date_text)
    if not stamps:
        return original
    writer = PdfWriter()
    writer.append(PdfReader(BytesIO(original)))
    apply_stamps(writer, stamps)
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


# --- certificate --------------------------------------------------------------------------------------

def utc(iso: str | None) -> str:
    if not iso:
        return ""
    return datetime.fromisoformat(iso).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def certificate_page(certificate: Certificate, signature_png: bytes) -> bytes:
    ink, muted, line = colors.HexColor("#25342d"), colors.HexColor("#6c786f"), colors.HexColor("#dfe5dc")
    title = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=ink)
    heading = ParagraphStyle("heading", fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=ink, spaceBefore=12, spaceAfter=4)
    body = ParagraphStyle("body", fontName="Helvetica", fontSize=8.5, leading=11, textColor=ink)
    label = ParagraphStyle("label", parent=body, textColor=muted)
    mono = ParagraphStyle("mono", parent=body, fontName="Courier", fontSize=8)

    def text(value, style=body):
        return Paragraph(escape(str(value or "—")), style)  # untrusted values are printed literally

    def details(rows):
        table = Table([[text(name, label), value] for name, value in rows], colWidths=[1.7 * inch, 5.1 * inch])
        table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, line),
                                   ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
        return table

    image_width, image_height = ImageReader(BytesIO(signature_png)).getSize()
    scale = min(SIGNATURE_MAX_WIDTH / image_width, SIGNATURE_MAX_HEIGHT / image_height)  # fit; a tall image must not overflow the page
    signature = Image(BytesIO(signature_png), width=image_width * scale, height=image_height * scale)

    timeline = Table([[text("Event", label), text("Time (UTC)", label), text("IP address", label), text("Browser", label)]]
                     + [[text(EVENT_LABELS.get(event["type"], event["type"])), text(utc(event["at"])), text(event.get("ip")),
                         text(event.get("user_agent"))] for event in certificate.events],
                     colWidths=[1.1 * inch, 1.6 * inch, 1.1 * inch, 3.0 * inch], repeatRows=1)
    timeline.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, line),
                                  ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))

    completed = []
    if certificate.signer_items:
        items = Table([[text("Page", label), text("Item", label), text("Value", label)]]
                      + [[text(page), text(kind), text(value)] for page, kind, value in certificate.signer_items],
                      colWidths=[0.7 * inch, 1.5 * inch, 4.6 * inch], repeatRows=1)
        items.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, line),
                                   ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        completed = [Paragraph("Completed by the signer", heading), items]

    story = [
        Paragraph("Certificate of completion", title),
        text(f"Astra Sign · generated {utc(certificate.generated_at)}", label),
        Spacer(1, 6),
        Paragraph("Document", heading),
        details([("Document", text(certificate.document_name)), ("File reference", text(certificate.file_id)),
                 ("Status", text("Completed: signed by all signers")),
                 ("SHA-256 of sent document", text(certificate.document_sha256, mono))]),
        Paragraph("Signer", heading),
        details([("Name on file", text(certificate.signer_name)), ("Email", text(certificate.signer_email)),
                 ("Signed as", text(certificate.signature_name)), ("Method", text(METHOD_LABELS.get(certificate.method, certificate.method))),
                 ("Signature", signature), ("Signed at", text(utc(certificate.signed_at))),
                 ("IP address", text(certificate.ip)), ("Browser", text(certificate.user_agent))]),
        *completed,
        Paragraph("Consent to sign electronically", heading),
        text(f"“{certificate.consent_text}”"),
        Paragraph("Timeline", heading),
        timeline,
        Spacer(1, 10),
        text("This page is part of the signed document. The SHA-256 value above identifies the exact document that "
             "was sent for signature; the signature was placed on that document.", label),
    ]
    stream = BytesIO()
    SimpleDocTemplate(stream, pagesize=letter, leftMargin=0.85 * inch, rightMargin=0.85 * inch,
                      topMargin=0.8 * inch, bottomMargin=0.8 * inch, title="Certificate of completion").build(story)
    return stream.getvalue()


# --- whole document ------------------------------------------------------------------------------------

def build_signed_pdf(original: bytes, marks: list, signature_png: bytes, certificate: Certificate, stamps=()) -> bytes:
    """Signature into every signature box, plus the signer's own items, then the certificate page."""
    writer = PdfWriter()
    writer.append(PdfReader(BytesIO(original)))
    boxes = [Stamp(kind="image", page=mark["page"], box=mark, image=signature_png) for mark in marks if mark_type(mark) == "signature"]
    apply_stamps(writer, boxes + list(stamps))
    writer.append(PdfReader(BytesIO(certificate_page(certificate, signature_png))))
    writer.add_metadata({"/Title": f"{certificate.document_name} (signed)", "/Producer": "Astra Sign"})
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()
