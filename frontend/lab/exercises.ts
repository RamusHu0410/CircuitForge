/** Practice exercises: real circuits the engine builds, from easy to hard. */

export interface Exercise {
  id: string;
  title: string;
  prompt: string; // what the engine is asked to build
  level: 1 | 2 | 3;
  idea: string; // what the exercise teaches
}

export const EXERCISES: Exercise[] = [
  { id: "led", title: "Light an LED", prompt: "red LED on 5V at 10mA", level: 1, idea: "A complete loop: battery, resistor, LED, and back." },
  { id: "divider", title: "Voltage divider", prompt: "voltage divider 9V to 5V", level: 1, idea: "Two resistors in series share the voltage." },
  { id: "leds", title: "Three LEDs in parallel", prompt: "3 green LEDs on 12V at 15mA", level: 2, idea: "Parallel branches each get the full voltage." },
  { id: "button", title: "Button with pull-up", prompt: "push button with pull-up on 3.3V and debounce", level: 2, idea: "A resistor holds a signal HIGH until a button pulls it LOW." },
  { id: "filter", title: "Low-pass filter", prompt: "low-pass filter at 1kHz", level: 2, idea: "A resistor and capacitor smooth out fast changes." },
  { id: "npn", title: "Transistor switch", prompt: "transistor to switch a red LED from a 3.3V GPIO on 5V", level: 2, idea: "A small base current switches a bigger one." },
  { id: "ldo", title: "3.3 V regulator", prompt: "3.3V LDO from 5V with power LED", level: 3, idea: "A chip that turns 5 V into a steady 3.3 V." },
  { id: "blink", title: "555 blinker", prompt: "555 timer blinking a blue LED at 2 Hz on 9V", level: 3, idea: "A timer chip, a capacitor and two resistors make a rhythm." },
];

export type PracticeMode = "build" | "draw";
