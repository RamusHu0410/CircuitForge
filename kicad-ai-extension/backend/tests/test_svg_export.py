import re

import pytest

from app.core.svg_export import crop_to_content

SAMPLE = """<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="297.0022mm" height="210.0072mm" viewBox="0.0000 0.0000 297.0022 210.0072">
<g><path d="M 20 30 L 60 30 L 60 50" /><path d="M 100.5 80 L 110 90" /><circle cx="70" cy="40" r="2"/></g>
</svg>"""


def view_box(svg: str) -> list[float]:
    return [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]


def test_crops_to_the_drawing_with_padding() -> None:
    svg = crop_to_content(SAMPLE, padding_mm=5)
    x, y, w, h = view_box(svg)
    assert (x, y) == (15, 25)  # min x 20, min y 30, minus the padding
    assert (w, h) == (pytest.approx(110 - 20 + 10), pytest.approx(90 - 30 + 10))  # x from 20 to 110, y from 30 to 90, plus padding
    assert 'width="' not in svg.split(">", 2)[1] and "mm" not in svg.split(">", 2)[1]  # scales with its container
    assert "preserveAspectRatio" in svg and svg.count("<svg") == 1 and "<path" in svg


def test_leaves_empty_drawings_alone() -> None:
    empty = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
    assert crop_to_content(empty) == empty
