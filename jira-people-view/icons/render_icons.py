"""Render PNG icons (16/48/128) for jira-people-view extension.

Visual: 3 stacked horizontal heatmap bars (pink->red intensity) representing
3 people's workload — directly mirrors the mockup the feature is based on.
"""
from PIL import Image, ImageDraw

# Heatmap pink/red palette (matches the workload mockup)
P0 = (255, 230, 230, 255)  # very light pink
P1 = (255, 200, 200, 255)
P2 = (255, 160, 160, 255)
P3 = (255, 110, 110, 255)
P4 = (235, 80, 80, 255)    # deepest red
TRANSPARENT = (0, 0, 0, 0)
TEXT = (74, 86, 108, 255)  # subtle outline / divider

# Each row: list of (intensity, weight) defining segments along the bar.
# Intensity 0..4 -> P0..P4
ROWS = [
    [(0, 1), (1, 1), (3, 2), (4, 1), (2, 2), (1, 1)],  # row 1
    [(1, 2), (2, 1), (4, 1), (3, 2), (1, 2)],          # row 2
    [(2, 1), (3, 2), (1, 2), (2, 1), (4, 2)],          # row 3
]
COLORS = [P0, P1, P2, P3, P4]


def render(size: int) -> Image.Image:
    SS = 8
    big = size * SS
    img = Image.new("RGBA", (big, big), TRANSPARENT)
    d = ImageDraw.Draw(img)
    s = big / 24.0
    def x(v): return v * s

    # Layout: 3 bars at y = 6, 11.5, 17 (each ~3.5 high)
    bar_h = 3.5
    bar_gap_y = 5.5  # center spacing
    bar_x_start = 3
    bar_x_end = 21
    radius = 1.0

    for i, row in enumerate(ROWS):
        y_top = 5 + i * bar_gap_y
        y_bot = y_top + bar_h
        total_w = bar_x_end - bar_x_start
        weights = [w for _, w in row]
        unit = total_w / sum(weights)
        # Draw rounded outer rect first (will be overwritten by segments)
        # Use mask approach: draw on a temp image then paste with rounded mask
        bar_layer = Image.new("RGBA", (big, big), TRANSPARENT)
        bd = ImageDraw.Draw(bar_layer)
        cx = bar_x_start
        for intensity, w in row:
            seg_w = unit * w
            bd.rectangle([x(cx), x(y_top), x(cx + seg_w), x(y_bot)], fill=COLORS[intensity])
            cx += seg_w
        # Apply rounded-rectangle mask
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [x(bar_x_start), x(y_top), x(bar_x_end), x(y_bot)],
            radius=x(radius), fill=255,
        )
        img.paste(bar_layer, (0, 0), mask)

    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    for size in (16, 48, 128):
        out = render(size)
        path = f"icon{size}.png"
        out.save(path, optimize=True)
        print(f"wrote {path} ({size}x{size})")
