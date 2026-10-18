"""Read back the connectivity KiCad sees in a generated schematic.

Exports the netlist with `kicad-cli sch export netlist` and returns each net
as a set of (reference, pin) pairs. Used by tests to prove the drawn schematic
is wired exactly as the CircuitSpec describes.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from app.core import sexpr
from app.schemas.circuit import SchematicFiles


def export_nets(files: SchematicFiles, kicad_cli: str, timeout_s: float = 60.0) -> dict[str, frozenset[tuple[str, str]]]:
    with tempfile.TemporaryDirectory(prefix="kicad-ai-net-") as tmp:
        folder = Path(tmp)
        (folder / f"{files.name}.kicad_sch").write_text(files.schematic, encoding="utf-8")
        (folder / f"{files.name}.kicad_pro").write_text(files.project, encoding="utf-8")
        out = folder / "net.net"
        subprocess.run(
            [kicad_cli, "sch", "export", "netlist", "--format", "kicadsexpr", "-o", str(out),
             str(folder / f"{files.name}.kicad_sch")],
            cwd=folder, capture_output=True, text=True, timeout=timeout_s, check=True,
        )
        tree = sexpr.loads(out.read_text(encoding="utf-8"))

    nets: dict[str, frozenset[tuple[str, str]]] = {}
    nets_node = sexpr.child(tree, "nets")
    # Every pin we marked no-connect shows up in KiCad as its own one-pin "unconnected-(...)" net.
    for net in sexpr.children(nets_node or [], "net"):
        name_node = sexpr.child(net, "name")
        name = str(name_node[1]) if name_node else "?"
        nodes = set()
        for node in sexpr.children(net, "node"):
            ref = sexpr.child(node, "ref")
            pin = sexpr.child(node, "pin")
            if ref and pin and not str(ref[1]).startswith("#"):
                nodes.add((str(ref[1]), str(pin[1])))
        if nodes and not (name.lstrip("/").startswith("unconnected-") and len(nodes) == 1):
            nets[name.lstrip("/")] = frozenset(nodes)
    return nets
