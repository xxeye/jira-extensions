"""Package the extension into pt-timeline-color.zip for distribution.

Excludes dev-only files (icon source SVG, render script, maintenance notes,
prior zip, .git/.DS_Store junk).
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "pt-timeline-color.zip")

EXCLUDE_NAMES = {
    "MAINTENANCE.md",
    "pack.py",
    "pt-timeline-color.zip",
    ".DS_Store",
}
EXCLUDE_IN_ICONS = {"render_icons.py", "icon.svg"}

if os.path.exists(OUT):
    os.remove(OUT)

count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # skip hidden dirs like .git
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if name in EXCLUDE_NAMES:
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
            if rel.startswith("icons/") and name in EXCLUDE_IN_ICONS:
                continue
            z.write(full, rel)
            print(f"+ {rel}")
            count += 1

print(f"\n{count} files -> {OUT} ({os.path.getsize(OUT)} bytes)")
