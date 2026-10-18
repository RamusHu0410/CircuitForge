"""Electronic components the generator may use.

Each kind maps to one official KiCad symbol and a default footprint, plus
friendly pin aliases (e.g. LED "A"/"anode" -> pin 2). Pin numbers and electrical
types come from the vendored KiCad symbol itself, never from this file.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Power nets drawn with KiCad power symbols (net name -> lib_id).
POWER_SYMBOLS: dict[str, str] = {
    "GND": "power:GND",
    "+3V3": "power:+3V3",
    "+5V": "power:+5V",
    "+9V": "power:+9V",
    "+12V": "power:+12V",
    "VCC": "power:VCC",
}
PWR_FLAG = "power:PWR_FLAG"


@dataclass(frozen=True)
class ComponentKind:
    kind: str
    lib_id: str
    ref_prefix: str
    description: str
    footprint: str
    default_value: str
    pin_aliases: dict[str, str] = field(default_factory=dict)  # alias (lowercase) -> pin number
    optional_pins: frozenset[str] = frozenset()  # power-input pins that may stay unconnected


COMPONENT_KINDS: dict[str, ComponentKind] = {
    k.kind: k
    for k in [
        ComponentKind(
            "resistor", "Device:R", "R", "Resistor",
            "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal", "10k",
        ),
        ComponentKind(
            "capacitor", "Device:C", "C", "Non-polarized capacitor",
            "Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm", "100n",
        ),
        ComponentKind(
            "capacitor_polarized", "Device:C_Polarized", "C", "Polarized (electrolytic) capacitor",
            "Capacitor_THT:CP_Radial_D5.0mm_P2.00mm", "10u",
            {"+": "1", "positive": "1", "-": "2", "negative": "2"},
        ),
        ComponentKind(
            "led", "Device:LED", "D", "Light-emitting diode",
            "LED_THT:LED_D5.0mm", "LED",
            {"k": "1", "cathode": "1", "a": "2", "anode": "2"},
        ),
        ComponentKind(
            "diode", "Device:D", "D", "Rectifier diode",
            "Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal", "1N4007",
            {"k": "1", "cathode": "1", "a": "2", "anode": "2"},
        ),
        ComponentKind(
            "potentiometer", "Device:R_Potentiometer", "RV", "Potentiometer (pin 2 is the wiper)",
            "Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical", "10k",
            {"wiper": "2", "w": "2"},
        ),
        ComponentKind(
            "arduino_uno", "MCU_Module:Arduino_UNO_R3", "A", "Arduino Uno R3 board (digital pins D0-D13, +5V, GND)",
            "Module:Arduino_UNO_R3", "Arduino_UNO_R3",
            {"5v": "5", "+5v": "5", "3v3": "4", "gnd": "6", "vin": "8"},
            optional_pins=frozenset({"8"}),  # VIN may be left unconnected when the board is USB powered
        ),
        ComponentKind(
            "shift_register_74hc595", "74xx:74HC595", "U", "74HC595 8-bit serial-in, parallel-out shift register (DIP-16)",
            "Package_DIP:DIP-16_W7.62mm", "74HC595",
            {"ser": "14", "data": "14", "srclk": "11", "clock": "11", "rclk": "12", "latch": "12",
             "oe": "13", "srclr": "10", "qh'": "9"},
        ),
        ComponentKind(
            "buzzer", "Device:Buzzer", "BZ", "Piezo buzzer (+ on pin 1, - on pin 2)",
            "Buzzer_Beeper:Buzzer_12x9.5RM7.6", "Buzzer",
            {"+": "1", "positive": "1", "-": "2", "negative": "2"},
        ),
        ComponentKind(
            "battery", "Device:Battery", "BT", "Battery / DC supply (+ on pin 1, - on pin 2)",
            "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical", "9V",
            {"+": "1", "positive": "1", "-": "2", "negative": "2"},
        ),
        ComponentKind(
            "push_button", "Switch:SW_Push", "SW", "Momentary push button",
            "Button_Switch_THT:SW_PUSH_6mm", "SW_Push",
        ),
        ComponentKind(
            "connector_2pin", "Connector_Generic:Conn_01x02", "J", "2-pin header",
            "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical", "Conn_01x02",
        ),
        ComponentKind(
            "connector_3pin", "Connector_Generic:Conn_01x03", "J", "3-pin header",
            "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical", "Conn_01x03",
        ),
        ComponentKind(
            "npn_transistor", "Transistor_BJT:2N3904", "Q", "NPN transistor 2N3904 (E-B-C)",
            "Package_TO_SOT_THT:TO-92_Inline", "2N3904",
            {"e": "1", "emitter": "1", "b": "2", "base": "2", "c": "3", "collector": "3"},
        ),
        ComponentKind(
            "timer_555", "Timer:NE555P", "U", "NE555 timer, DIP-8",
            "Package_DIP:DIP-8_W7.62mm", "NE555P",
            {"gnd": "1", "trig": "2", "out": "3", "rst": "4", "reset": "4", "cont": "5", "ctrl": "5",
             "thres": "6", "thr": "6", "disch": "7", "dis": "7", "vcc": "8"},
        ),
        ComponentKind(
            "regulator_7805", "Regulator_Linear:L7805", "U", "7805 5 V linear regulator (TO-220)",
            "Package_TO_SOT_THT:TO-220-3_Vertical", "L7805",
            {"in": "1", "vin": "1", "vi": "1", "gnd": "2", "out": "3", "vout": "3", "vo": "3"},
        ),
        ComponentKind(
            "regulator_ams1117_3v3", "Regulator_Linear:AMS1117-3.3", "U", "AMS1117 3.3 V LDO (SOT-223)",
            "Package_TO_SOT_SMD:SOT-223-3_TabPin2", "AMS1117-3.3",
            {"gnd": "1", "out": "2", "vout": "2", "vo": "2", "in": "3", "vin": "3", "vi": "3"},
        ),
    ]
}


def all_lib_ids() -> list[str]:
    """Every symbol the renderer may need (components + power symbols)."""
    return sorted({k.lib_id for k in COMPONENT_KINDS.values()} | set(POWER_SYMBOLS.values()) | {PWR_FLAG})
