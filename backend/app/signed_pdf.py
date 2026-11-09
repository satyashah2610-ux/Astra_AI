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
from reportlab.pdfgen import canvas
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

EVENT_LABELS = {"created": "Created", "sent": "Sent", "link_reissued": "Link reissued", "viewed": "Viewed", "signed": "Signed"}
METHOD_LABELS = {"typed": "Typed", "drawn": "Drawn"}
SIGNATURE_MAX_WIDTH, SIGNATURE_MAX_HEIGHT = 2.2 * inch, 0.9 * inch  # signature on the certificate page


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

def stamp_page(page, marks, signature_png: bytes) -> None:
    """Draw the signature upright inside each box, as the viewer will display the page."""
    cropbox, rotation = page_box(page), normalize_rotation(page.rotation)
    llx, lly, urx, ury = cropbox
    width, height = (urx - llx, ury - lly) if rotation in (0, 180) else (ury - lly, urx - llx)
    stream = BytesIO()
    overlay = canvas.Canvas(stream, pagesize=(max(float(page.mediabox.right), 1.0), max(float(page.mediabox.top), 1.0)))
    image = ImageReader(BytesIO(signature_png))  # decoded once, reused for every box
    for mark in marks:
        # Anchor at the box's displayed bottom-left corner, in a frame turned against the page rotation.
        x, y = display_point(mark["x"], mark["y"] + mark["height"], cropbox, rotation)
        overlay.saveState()
        overlay.translate(x, y)
        overlay.rotate(rotation)
        overlay.drawImage(image, 0, 0, mark["width"] * width, mark["height"] * height,
                          mask="auto", preserveAspectRatio=True, anchor="c")
        overlay.restoreState()
    overlay.save()
    page.merge_page(PdfReader(stream).pages[0])


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

def build_signed_pdf(original: bytes, marks: list, signature_png: bytes, certificate: Certificate) -> bytes:
    writer = PdfWriter()
    writer.append(PdfReader(BytesIO(original)))
    for number, page in enumerate(writer.pages, start=1):
        page_marks = [mark for mark in marks if mark["page"] == number]
        if page_marks:
            stamp_page(page, page_marks, signature_png)
    writer.append(PdfReader(BytesIO(certificate_page(certificate, signature_png))))
    writer.add_metadata({"/Title": f"{certificate.document_name} (signed)", "/Producer": "Astra Sign"})
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()
