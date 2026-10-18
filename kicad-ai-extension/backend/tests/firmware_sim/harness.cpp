// Runs a generated sketch against a scripted button timeline read from stdin:
//   <end_ms>
//   <t_ms> <pin> <level>   (one line per change; pressed = 0 because of the pull-up)
// Prints "<pin> <rises> <high_ms>" for every pin the sketch drove.
#include <cstdio>
#include <vector>
#include "arduino_stub.h"
#include SKETCH

int main() {
  unsigned long end_ms = 0;
  if (std::scanf("%lu", &end_ms) != 1) return 2;
  struct Change { unsigned long t; int pin, level; };
  std::vector<Change> changes;
  Change c;
  while (std::scanf("%lu %d %d", &c.t, &c.pin, &c.level) == 3) changes.push_back(c);
  setup();
  g_rises.clear();  // ignore the initial "off" writes
  size_t next = 0;
  for (g_now = 0; g_now <= end_ms; g_now++) {
    while (next < changes.size() && changes[next].t == g_now) {
      g_input[changes[next].pin] = changes[next].level;
      next++;
    }
    loop();
    for (auto &kv : g_output) if (kv.second) g_high_ms[kv.first]++;
  }
  for (auto &kv : g_output) std::printf("%d %d %d\n", kv.first, g_rises[kv.first], g_high_ms[kv.first]);
  return 0;
}
