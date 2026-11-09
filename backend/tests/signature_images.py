"""Test helpers that build signature images like a browser canvas would."""
import base64
from io import BytesIO

from PIL import Image, ImageDraw


def png_bytes(size=(400, 120), mode="RGBA"):
    image = Image.new(mode, size, (0, 0, 0, 0) if mode == "RGBA" else 255)
    ImageDraw.Draw(image).line([(10, size[1] - 20), (size[0] - 10, 15)], fill=(20, 30, 40, 255) if mode == "RGBA" else 0, width=4)
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def data_url(content=None):
    return "data:image/png;base64," + base64.b64encode(content if content is not None else png_bytes()).decode()
