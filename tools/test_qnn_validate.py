import csv
from pathlib import Path
import tempfile
import unittest

from qnn_validate import fixture_input, fixture_output, read_profile, summarize_profile, verify_outputs


def profile_rows(runs=2):
    rows = []
    for index in range(runs):
        for identifier, unit, level, value in (
            ("QNN (execute) time", "US", "ROOT", 200 + index * 100),
            ("Accelerator (execute) time", "US", "ROOT", 100),
            ("Accelerator (execute) time (cycles)", "CYCLES", "ROOT", 24085),
            ("dense_matmul:OpId_17 (cycles)", "CYCLES", "SUB-EVENT", 5101),
        ):
            rows.append({"Message": "EXECUTE", "Timing Source": "BACKEND", "Event Identifier": identifier,
                         "Unit of Measurement": unit, "Event Level": level, "Time": str(value)})
    return rows


class QnnValidationTests(unittest.TestCase):
    def test_fixtures_are_distinct_complete_uint8_vectors(self):
        inputs = [fixture_input(index) for index in range(8)]
        outputs = [fixture_output(index) for index in range(8)]
        self.assertTrue(all(len(value) == 2048 for value in inputs + outputs))
        self.assertEqual(len(set(inputs)), 8)
        self.assertGreater(len(set(outputs)), 1)

    def test_every_output_byte_is_checked_and_missing_results_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "Expected 2 outputs"):
                verify_outputs(root, runs=2)
            for index in range(2):
                output = root / f"Result_{index}" / "output_native.raw"
                output.parent.mkdir()
                output.write_bytes(fixture_output(index))
            self.assertEqual(verify_outputs(root, runs=2), 4096)
            output.write_bytes(output.read_bytes()[:-1] + b"\xff")
            with self.assertRaisesRegex(ValueError, "Incorrect output"):
                verify_outputs(root, runs=2)

    def test_csv_reader_handles_vendor_preamble_and_quoted_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profile.csv"
            with path.open("w", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["Backend version", "QAIRT test"])
                writer.writerow(["Msg Timestamp", "Message", "Time", "Unit of Measurement", "Timing Source", "Event Level", "Event Identifier"])
                writer.writerow(["10", "EXECUTE", "17", "CYCLES", "BACKEND", "SUB-EVENT", "dense_matmul: op, quoted"])
            self.assertEqual(read_profile(path)[0]["Event Identifier"], "dense_matmul: op, quoted")
            path.write_text("unrecognized,profile\n")
            with self.assertRaisesRegex(ValueError, "header not found"):
                read_profile(path)

    def test_timings_exclude_warmup_and_convert_microseconds(self):
        summary = summarize_profile(profile_rows(), runs=2, warmups=1)
        self.assertEqual(summary["samplesMs"], [0.3])
        self.assertEqual(summary["meanMs"], 0.3)
        self.assertTrue(summary["acceleratorExecutionVerified"])

    def test_profile_must_include_actual_operator_and_accelerator_execution(self):
        rows = profile_rows()
        rows = [row for row in rows if not row["Event Identifier"].startswith("dense_matmul:")]
        with self.assertRaisesRegex(ValueError, "execution-profile events"):
            summarize_profile(rows, runs=2, warmups=1)
        rows = profile_rows()
        for row in rows:
            row["Message"] = "INIT"
        with self.assertRaisesRegex(ValueError, "execution-profile events"):
            summarize_profile(rows, runs=2, warmups=1)

    def test_invalid_missing_or_extra_profile_values_cannot_pass(self):
        for value in ("nan", "inf", "0", "-1", "not a number"):
            rows = profile_rows()
            rows[0]["Time"] = value
            with self.assertRaises(ValueError):
                summarize_profile(rows, runs=2, warmups=1)
        with self.assertRaisesRegex(ValueError, "execution-profile events"):
            summarize_profile(profile_rows(3), runs=2, warmups=1)


if __name__ == "__main__":
    unittest.main()