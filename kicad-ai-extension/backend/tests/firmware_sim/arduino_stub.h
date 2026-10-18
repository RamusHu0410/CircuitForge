// Minimal Arduino API so generated sketches compile and run on a desktop for tests.
// Time is simulated: the harness advances g_now one millisecond per loop().
#pragma once
#include <cstdint>
#include <map>

const int HIGH = 1, LOW = 0, INPUT = 0, OUTPUT = 1, INPUT_PULLUP = 2;
const uint8_t A0 = 14, A1 = 15;

static unsigned long g_now = 0;
static std::map<int, int> g_input;   // pin -> level driven by the test (buttons)
static std::map<int, int> g_output;  // pin -> level written by the sketch (LEDs)
static std::map<int, int> g_rises;   // pin -> number of LOW->HIGH transitions
static std::map<int, int> g_high_ms; // pin -> milliseconds spent HIGH

inline unsigned long millis() { return g_now; }
inline void pinMode(uint8_t pin, int mode) {
  if (mode == INPUT_PULLUP && !g_input.count(pin)) g_input[pin] = HIGH;
}
inline int digitalRead(uint8_t pin) { return g_input.count(pin) ? g_input[pin] : HIGH; }
inline void digitalWrite(uint8_t pin, int value) {
  if (value && !g_output[pin]) g_rises[pin]++;
  g_output[pin] = value ? HIGH : LOW;
}
