# HexagonNPUCity

Runs the **HexagonNPUSimCity** 3D visualization of the Qualcomm Hexagon NPU on
this Arduino UNO Q, and mirrors its (illustrative) telemetry onto the board.

- **Open the sim:** `http://<this-board>:7080/`
- **LED1** → numeric precision (INT4 red · INT8 yellow · INT16 green · FP16 cyan)
- **LED2** → workload (LLM decode blue · Vision magenta · Idle off)
- **LED3** → precision colour, pulsing faster as the tensor engine gets busier
- **Optional button on D4 → GND** cycles the workload

Everything shown is an illustrative model for learning how the NPU behaves — not
a hardware measurement. Not affiliated with Qualcomm or Arduino.

See `arduino/README.md` in the repository for full details and how to extend it.
