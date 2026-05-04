"""Package the extension into jira-people-view.zip for distribution."""
import os
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "jira-people-view.zip")

EXCLUDE_NAMES = {
    "pack.py",
    "jira-people-view.zip",
    ".DS_Store",
}
EXCLUDE_IN_ICONS = {"render_icons.py", "icon.svg"}

if os.path.exists(OUT):
    os.remove(OUT)

count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "screenshots"]
        for name in filenames:
            if name in EXCLUDE_NAMES:
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
            if rel.startswith("icons/") and name in EXCLUDE_IN_ICONS:
                continue
            if rel.startswith("screenshots/"):
                continue
            if rel.endswith(".md"):
                continue
            z.write(full, rel)
            print(f"+ {rel}")
            count += 1

print(f"\n{count} files -> {OUT} ({os.path.getsize(OUT)} bytes)")
