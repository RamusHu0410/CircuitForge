"""The scene (app/core/scene.py): the generated schematic as drawing data, with a net on everything."""

import pytest

from app.config import Settings
from app.core.geometry import to_screen
from app.schemas.circuit import GenerateRequest
from app.services.generation_service import GenerationService

PROMPTS = [
    "red LED on 5V at 10mA",
    "voltage divider 12V to 5V",
    "555 timer blinking a blue LED at 2 Hz on 9V",
    "transistor switch for a 12V lamp",
    "3.3V LDO from 5V with power LED",
    "low-pass filter at 1kHz",
    "Two-player football game with two joysticks and LEDs for game state and scoring",
    "red LED blinks when the button is pressed once, green LED blinks if it's pressed twice within 0.5 s",
]


@pytest.fixture(scope="module")
def service() -> GenerationService:
    return GenerationService(Settings(erc_enabled=False))


def _key(p: tuple[float, float]) -> tuple[int, int]:
    return round(p[0] * 100), round(p[1] * 100)


@pytest.mark.parametrize("prompt", PROMPTS)
def test_scene_matches_the_circuit(service: GenerationService, prompt: str) -> None:
    response = service.generate(GenerateRequest(prompt=prompt))
    scene = response.scene
    assert scene is not None
    spec_nets = {n.name for n in response.circuit.nets}

    # Every component, with every connected pin on the net the circuit says.
    assert {c.ref for c in scene.components} == {c.ref for c in response.circuit.components}
    for comp in scene.components:
        assert comp.kind and comp.lib_id in scene.library
        assert set(comp.pin_nets.values()) <= spec_nets

    # Wires touching a pin carry that pin's net; nothing is left without a net.
    pin_net = {}
    for comp in scene.components:
        lib = scene.library[comp.lib_id]
        for pin in lib.pins:
            if pin.number in comp.pin_nets:
                dx, dy = to_screen(pin.x, pin.y, comp.rot, comp.mirror)
                pin_net[_key((comp.x + dx, comp.y + dy))] = comp.pin_nets[pin.number]
    assert scene.wires
    for wire in scene.wires:
        assert wire.net in spec_nets, wire
        for end in (wire.a, wire.b):
            if _key(end) in pin_net:
                assert pin_net[_key(end)] == wire.net
    for junction in scene.junctions:
        assert junction.net in spec_nets
    for label in scene.labels:
        assert label.net in spec_nets

    # Power symbols are real nets; the ERC-only PWR_FLAGs are gone.
    assert "power:PWR_FLAG" not in scene.library
    for port in scene.ports:
        assert port.net in spec_nets

    x0, y0, x1, y1 = scene.bbox
    assert x1 > x0 and y1 > y0
    for wire in scene.wires:
        for x, y in (wire.a, wire.b):
            assert x0 <= x <= x1 and y0 <= y <= y1


def test_no_dangling_flag_stubs(service: GenerationService) -> None:
    scene = service.generate(GenerateRequest(prompt="555 timer blinking a blue LED at 2 Hz on 9V")).scene
    assert scene is not None
    ends: dict[tuple[int, int], int] = {}
    for w in scene.wires:
        for p in (w.a, w.b):
            ends[_key(p)] = ends.get(_key(p), 0) + 1
    attached = {_key((p.x, p.y)) for p in scene.ports} | {_key((lb.x, lb.y)) for lb in scene.labels}
    for comp in scene.components:
        for pin in scene.library[comp.lib_id].pins:
            dx, dy = to_screen(pin.x, pin.y, comp.rot, comp.mirror)
            attached.add(_key((comp.x + dx, comp.y + dy)))
    dead = [k for k, n in ends.items() if n == 1 and k not in attached]
    assert dead == []
