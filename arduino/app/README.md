# HexagonNPUCity

Runs the **HexagonNPUSimCity** 3D visualization of the Qualcomm Hexagon NPU on
this Arduino UNO Q, alongside an illustrative Python telemetry API and LEDs.

- **Open the sim:** `http://<this-board>:7080/`
- **LED1** → numeric precision (INT4 red · INT8 yellow · INT16 green · FP16 cyan)
- **LED2** → workload (LLM decode blue · Vision magenta · Idle off)
- **LED3** → precision colour, pulsing faster with simulated tensor activity
- **Optional button on D4 → GND** cycles the Python model's workload

The board API/LED state and browser simulation are independent: the browser
does not currently poll `/api/telemetry` or forward its controls to the board.
Use `/api/control/precision`, `/api/control/workload`, or the MCU button to
change the board-side model. This server is for a trusted LAN; its port-7080
control API is unauthenticated.

Everything shown is an illustrative model for learning how the NPU behaves — not
a hardware measurement. Not affiliated with Qualcomm or Arduino.

See the [connector guide](../README.md) for setup, APIs, deployment and the
separate port-7000 measured bench app. The native Ubuntu/QCS6490 hardware
validation is documented in [the NPU guide](../../docs/qcs6490-npu.md), not
provided by this illustrative App Lab app.
