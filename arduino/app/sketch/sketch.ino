/*
 * HexagonNPUCity — Arduino App Lab connector (UNO Q, STM32 / MCU side).
 *
 * Receives the sim's illustrative state from the Linux side over the Bridge and
 * reflects it on the board:
 *   - LED3 shows the current numeric precision as a colour and pulses at a rate
 *     that tracks tensor-engine utilisation (busier workload => faster pulse).
 *   - An OPTIONAL button on D4 (INPUT_PULLUP, wire the other side to GND) cycles
 *     the workload. If nothing is wired, the pull-up keeps it inactive.
 *
 * Illustrative only — no hardware measurement. See arduino/README.md.
 */

#include "Arduino_RouterBridge.h"

// LED3 is an MCU-controlled RGB LED; its segments are ACTIVE-LOW (0 = on).
static const int LED_R = LED3_R;
static const int LED_G = LED3_G;
static const int LED_B = LED3_B;

// Optional momentary button: wire between D4 and GND. Uses the internal pull-up.
static const int BUTTON_PIN = D4;

// Precision index -> on/off RGB, matching the web quantization badge hues:
//   0:INT4 red, 1:INT8 yellow, 2:INT16 green, 3:FP16 cyan.
static const uint8_t PREC_RGB[4][3] = {
  {1, 0, 0},
  {1, 1, 0},
  {0, 1, 0},
  {0, 1, 1},
};

static volatile int g_precision = 1;  // INT8
static volatile int g_workload = 0;   // llm-decode
static volatile int g_util = 0;       // 0..100 tensor utilisation

static int last_button = HIGH;
static unsigned long last_toggle = 0;
static bool led_on = false;

// Called by the Linux side via Bridge.notify("hexagon_state", ...).
// Registered with provide_safe so it runs in loop() context (touches globals only).
void hexagon_state(int precision, int workload, int util) {
  if (precision >= 0 && precision < 4) {
    g_precision = precision;
  }
  g_workload = workload;
  if (util < 0) {
    util = 0;
  }
  if (util > 100) {
    util = 100;
  }
  g_util = util;
}

static void apply_led(bool on) {
  const uint8_t* rgb = PREC_RGB[g_precision];
  // Active-LOW: drive a segment LOW to turn it ON.
  digitalWrite(LED_R, (on && rgb[0]) ? LOW : HIGH);
  digitalWrite(LED_G, (on && rgb[1]) ? LOW : HIGH);
  digitalWrite(LED_B, (on && rgb[2]) ? LOW : HIGH);
}

void setup() {
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  apply_led(false);

  Bridge.begin();
  Bridge.provide_safe("hexagon_state", hexagon_state);
}

void loop() {
  // Pulse LED3 at a period set by tensor utilisation: idle ~1200 ms, busy ~200 ms.
  unsigned long period = 1200UL - (unsigned long)g_util * 10UL;
  if (period < 200UL) {
    period = 200UL;
  }
  unsigned long now = millis();
  if (now - last_toggle >= period / 2) {
    last_toggle = now;
    led_on = !led_on;
    apply_led(led_on);
  }

  // Optional button: on a fresh press, ask Linux to cycle the workload.
  int button = digitalRead(BUTTON_PIN);
  if (last_button == HIGH && button == LOW) {
    Bridge.notify("cycle_workload");
  }
  last_button = button;

  delay(15);
}
