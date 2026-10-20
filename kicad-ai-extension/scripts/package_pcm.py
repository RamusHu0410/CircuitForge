"""Build the CircuitForge package for KiCad's Plugin and Content Manager (PCM).

    python3 kicad-ai-extension/scripts/package_pcm.py              # builds the UI, then the package
    python3 kicad-ai-extension/scripts/package_pcm.py --skip-ui    # use dist/ as it is
    python3 kicad-ai-extension/scripts/package_pcm.py --vendor-dev # only fill plugin/vendor/ (symlinked dev install)

Reads kicad-ai-extension/pcm/metadata.json; the last entry in "versions" is the one being built. Writes:

    kicad-ai-extension/build/pcm/<identifier>-<version>.zip   upload this (e.g. as a GitHub release asset)
    kicad-ai-extension/build/pcm/metadata.json                goes in packages/<identifier>/ of
                                                              gitlab.com/kicad/addons/metadata

and records the zip's download_url, sha256 and sizes in pcm/metadata.json, so the version history the
addons repo needs stays in git. Test the zip first: KiCad > Plugin and Content Manager > Install from File...

To release an update: add a new entry (higher "version") at the end of "versions", run this again,
upload the zip, and send the new build/pcm/metadata.json to the addons repo.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

EXT_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = EXT_DIR.parent
PCM_DIR = EXT_DIR / "pcm"
METADATA = PCM_DIR / "metadata.json"
OUT_DIR = EXT_DIR / "build" / "pcm"

# Patterns from the PCM schema (https://go.kicad.org/pcm/schemas/v1).
IDENTIFIER_RE = re.compile(r"^[a-zA-Z][-a-zA-Z0-9.]{0,98}[a-zA-Z0-9]$")
VERSION_RE = re.compile(r"^\d{1,4}(\.\d{1,4}(\.\d{1,6})?)?$")
DOWNLOAD_FIELDS = ("download_url", "download_sha256", "download_size", "install_size")
SKIP_NAMES = {"__pycache__", ".DS_Store", ".pytest_cache", ".venv", "config.json"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".log"}
# The HTTP server (FastAPI) isn't installed in the plugin; the window talks to the engine directly.
SERVER_ONLY = {"api", "main.py"}
# Bundled into plugins/vendor/: proxy_tools has no wheel, and KiCad installs requirements.txt with
# --only-binary :all:, so pip can't install pywebview there. pywebview's other dependencies are in
# plugin/requirements.txt. Keep these pins in step with backend/requirements.txt.
VENDORED = ("pywebview==6.2.1", "proxy_tools==0.1.0")
VENDORED_MODULES = ("webview", "proxy_tools")
VENDOR_NOTICE = """Bundled third-party code (see plugin/requirements.txt for why):

- webview/      pywebview 6.2.1, BSD 3-Clause License, https://github.com/r0x0r/pywebview (LICENSE-pywebview)
- proxy_tools/  proxy_tools 0.1.0, MIT License, https://github.com/jtushman/proxy_tools
"""
ZIP_DATE = (2020, 1, 1, 0, 0, 0)  # fixed timestamps: the same sources give the same zip


class PackageError(Exception):
    pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--skip-ui", action="store_true", help="don't run `npm run build`; package dist/ as it is")
    parser.add_argument("--download-url", help="where the zip will be published (default: a GitHub release v<version>)")
    parser.add_argument("--vendor-dev", action="store_true", help="only bundle pywebview into plugin/vendor/ for a dev install")
    parser.add_argument(
        "--allow-placeholders", action="store_true", help="build even with TODO author/license (KiCad will refuse to install it)"
    )
    args = parser.parse_args(argv)
    try:
        if args.vendor_dev:
            vendor(EXT_DIR / "plugin" / "vendor")
            print(f"bundled {', '.join(VENDORED)} into {EXT_DIR / 'plugin' / 'vendor'}")
            return 0
        build(args.skip_ui, args.download_url, args.allow_placeholders)
    except PackageError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def build(skip_ui: bool, download_url: str | None, allow_placeholders: bool) -> None:
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    check_metadata(metadata, allow_placeholders)
    entry = metadata["versions"][-1]
    identifier, version = metadata["identifier"], entry["version"]

    dist = REPO_DIR / "dist"
    if not skip_ui:
        print("building the UI (npm run build)...")
        npm = shutil.which("npm") or "npm"
        if subprocess.run([npm, "run", "build"], cwd=REPO_DIR).returncode != 0:
            raise PackageError("`npm run build` failed")
    if not (dist / "index.html").is_file():
        raise PackageError(f"no built UI in {dist}; run `npm install && npm run build` in {REPO_DIR}")

    # Layout KiCad expects: metadata.json, plugins/ (becomes the plugin folder), resources/icon.png.
    vendor_dir = OUT_DIR / "vendor"
    vendor(vendor_dir)

    files: dict[str, Path] = {}
    add_tree(files, EXT_DIR / "plugin", "plugins", skip={"vendor"})
    add_tree(files, vendor_dir, "plugins/vendor")
    add_tree(files, EXT_DIR / "backend" / "app", "plugins/app", skip=SERVER_ONLY)
    add_tree(files, dist, "plugins/web")
    files["resources/icon.png"] = PCM_DIR / "icon.png"

    package_meta = copy.deepcopy(metadata)
    package_meta["versions"] = [{k: v for k, v in entry.items() if k not in DOWNLOAD_FIELDS}]
    package_meta_bytes = (json.dumps(package_meta, indent=2) + "\n").encode("utf-8")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = OUT_DIR / f"{identifier}-{version}.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        write_entry(archive, "metadata.json", package_meta_bytes)
        for name in sorted(files):
            write_entry(archive, name, files[name].read_bytes())

    install_size = len(package_meta_bytes) + sum(p.stat().st_size for p in files.values())
    entry["download_sha256"] = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    entry["download_size"] = zip_path.stat().st_size
    entry["install_size"] = install_size
    entry["download_url"] = download_url or default_download_url(metadata, version, zip_path.name)

    text = json.dumps(metadata, indent=2, ensure_ascii=False) + "\n"
    METADATA.write_text(text, encoding="utf-8")
    (OUT_DIR / "metadata.json").write_text(text, encoding="utf-8")

    print(f"\npackage:  {zip_path}  ({entry['download_size'] / 1e6:.1f} MB, {len(files) + 1} files)")
    print(f"sha256:   {entry['download_sha256']}")
    print(f"upload to {entry['download_url']}")
    print(f"metadata: {OUT_DIR / 'metadata.json'}  ->  packages/{identifier}/metadata.json in gitlab.com/kicad/addons/metadata")
    print("test it:  KiCad > Plugin and Content Manager > Install from File...")


def check_metadata(metadata: dict, allow_placeholders: bool) -> None:
    for field in ("name", "description", "description_full", "identifier", "type", "author", "license", "resources", "versions"):
        if field not in metadata:
            raise PackageError(f"pcm/metadata.json is missing {field!r}")
    if not IDENTIFIER_RE.match(metadata["identifier"]):
        raise PackageError(f"identifier {metadata['identifier']!r} doesn't match the PCM pattern")
    plugin_id = json.loads((EXT_DIR / "plugin" / "plugin.json").read_text(encoding="utf-8"))["identifier"]
    if plugin_id != metadata["identifier"]:
        raise PackageError(f"plugin/plugin.json identifier {plugin_id!r} differs from pcm/metadata.json {metadata['identifier']!r}")
    if len(metadata["name"]) > 200 or len(metadata["description"]) > 500 or len(metadata["description_full"]) > 5000:
        raise PackageError("name, description or description_full is too long (200 / 500 / 5000)")
    if any(tag != tag.lower() for tag in metadata.get("tags", [])):
        raise PackageError("tags must be lowercase")

    placeholders = [f for f in ("license",) if str(metadata[f]).startswith("TODO")]
    if str(metadata["author"].get("name", "")).startswith("TODO"):
        placeholders.append("author.name")
    if placeholders and not allow_placeholders:
        raise PackageError(f"fill in {', '.join(placeholders)} in {METADATA} (or pass --allow-placeholders for a test build)")

    versions = metadata["versions"]
    if not versions:
        raise PackageError('"versions" is empty; add an entry for the version to build')
    for entry in versions:
        if not VERSION_RE.match(str(entry.get("version", ""))):
            raise PackageError(f"bad version {entry.get('version')!r} (use major.minor.patch)")
        for field in ("status", "kicad_version"):
            if field not in entry:
                raise PackageError(f"version {entry['version']} is missing {field!r}")
    numbers = [tuple(int(n) for n in e["version"].split(".")) for e in versions]
    if numbers != sorted(set(numbers)):
        raise PackageError("versions must be unique and in increasing order; add new versions at the end")


def vendor(dest: Path) -> None:
    """Install the pinned pure-Python packages pip can't install inside KiCad into `dest`."""
    shutil.rmtree(dest, ignore_errors=True)
    staging = dest.with_name(dest.name + ".pip")
    shutil.rmtree(staging, ignore_errors=True)
    command = [sys.executable, "-m", "pip", "install", "--quiet", "--no-deps", "--no-compile", "--target", str(staging), *VENDORED]
    if subprocess.run(command).returncode != 0:
        raise PackageError(f"could not download {', '.join(VENDORED)} (pip install --target failed)")
    dest.mkdir(parents=True)
    for module in VENDORED_MODULES:
        shutil.copytree(staging / module, dest / module, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    licenses = sorted(staging.glob("pywebview-*.dist-info/licenses/LICENSE*")) + sorted(staging.glob("pywebview-*.dist-info/LICENSE*"))
    if not licenses:
        raise PackageError("pywebview's LICENSE file wasn't found")
    shutil.copy(licenses[0], dest / "LICENSE-pywebview")
    (dest / "NOTICE.txt").write_text(VENDOR_NOTICE, encoding="utf-8")
    shutil.rmtree(staging)


def add_tree(files: dict[str, Path], source: Path, prefix: str, skip: set[str] = frozenset()) -> None:
    if not source.is_dir():
        raise PackageError(f"missing {source}")
    for path in sorted(source.rglob("*")):
        rel = path.relative_to(source)
        if any(part in SKIP_NAMES for part in rel.parts) or path.suffix in SKIP_SUFFIXES or not path.is_file():
            continue
        if rel.parts[0] in skip:
            continue
        files[f"{prefix}/{rel.as_posix()}"] = path


def write_entry(archive: zipfile.ZipFile, name: str, data: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, data)


def default_download_url(metadata: dict, version: str, file_name: str) -> str:
    homepage = metadata.get("resources", {}).get("homepage", "").rstrip("/")
    if not homepage.startswith("https://github.com/"):
        raise PackageError("pass --download-url (resources.homepage isn't a GitHub repo)")
    return f"{homepage}/releases/download/v{version}/{file_name}"


if __name__ == "__main__":
    sys.exit(main())
