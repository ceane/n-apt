import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  gradeHackRfLedObservation,
  HACKRF_LED_CHECKS,
  HACKRF_LED_LAYOUT,
  type HackRfLedObservation,
} from "./hackrfLedDiagnostic";

type Preflight = { ok: true; summary: string } | { ok: false; summary: string };
type Results = Record<string, HackRfLedObservation>;

const timeoutMs = Number(process.env.HACKRF_LED_TIMEOUT_MS ?? 20_000);

function checkHackRfVisibility(): Preflight {
  const result = spawnSync("hackrf_info", [], {
    encoding: "utf8",
    timeout: 5_000,
  });
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (result.status === 0 && output.includes("Found HackRF")) {
    const firmware = output.match(/Firmware Version:\s*([^\n]+)/)?.[1];
    return {
      ok: true,
      summary: firmware
        ? `HackRF visible · firmware ${firmware}`
        : "HackRF visible",
    };
  }

  const cause =
    result.error?.message ?? output ?? "hackrf_info returned no device";
  return {
    ok: false,
    summary: `HackRF not visible to this process: ${cause}`,
  };
}

function resultKey(index: number) {
  const check = HACKRF_LED_CHECKS[index];
  return `${check.stage}:${check.id}`;
}

function LED({
  id,
  results,
  activeId,
}: {
  id: (typeof HACKRF_LED_LAYOUT)[number]["id"];
  results: Results;
  activeId?: string;
}) {
  const led = HACKRF_LED_LAYOUT.find((item) => item.id === id)!;
  const stage = activeId?.split(":")[0] as "idle" | "rx" | "tx" | undefined;
  const observationStage =
    id === "3v3" || id === "1v8" || id === "rf" || id === "usb"
      ? "idle"
      : stage;
  const observation = observationStage
    ? results[`${observationStage}:${id}`]
    : undefined;
  const symbol =
    observation === "on"
      ? "●"
      : observation === "off"
        ? "○"
        : observation === "skip"
          ? "–"
          : observation === "timeout"
            ? "?"
            : "◌";
  return (
    <Text color={led.color} bold={activeId?.endsWith(`:${id}`)}>
      {symbol} {led.label}
    </Text>
  );
}

function LedDiagram({
  results,
  activeIndex,
}: {
  results: Results;
  activeIndex: number;
}) {
  const current = HACKRF_LED_CHECKS[activeIndex];
  const activeId = current ? `${current.stage}:${current.id}` : undefined;
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text dimColor>[RESET button] </Text>
        <LED id="3v3" results={results} activeId={activeId} />
        <Text dimColor> [DFU button]</Text>
      </Box>
      <Box>
        <Text dimColor>LED row: </Text>
        {(["1v8", "rf", "usb", "rx", "tx"] as const).map((id, index) => (
          <React.Fragment key={id}>
            {index > 0 && <Text dimColor> </Text>}
            <LED id={id} results={results} activeId={activeId} />
          </React.Fragment>
        ))}
        <Text dimColor> [ANTENNA]</Text>
      </Box>
      <Text dimColor>
        ◌ pending ● reported on ○ reported off – skipped ? timed out
      </Text>
    </Box>
  );
}

function Diagnostic({ preflight }: { preflight: Preflight }) {
  const { exit } = useApp();
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Results>({});
  const [complete, setComplete] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [mode, setMode] = useState("starting");
  const [controllerError, setControllerError] = useState<string | null>(null);
  const [frequencyHz, setFrequencyHz] = useState(
    process.env.HACKRF_TX_TEST_FREQUENCY_HZ ?? "",
  );
  const [editingFrequency, setEditingFrequency] = useState(false);
  const [confirmingTx, setConfirmingTx] = useState(false);
  const childRef = useRef<ChildProcessWithoutNullStreams | null>(null);
  const controllerErrorRef = useRef<string | null>(null);
  const answered = useRef(false);
  const current = HACKRF_LED_CHECKS[index];
  const isAwaitingTx = preflight.ok && current?.stage === "tx" && mode !== "tx";
  const modeReady = current?.stage === "idle" || mode === current?.stage;

  const sendCommand = useCallback((command: object) => {
    const child = childRef.current;
    if (!child || !child.stdin.writable) {
      controllerErrorRef.current = "HackRF control process is not running.";
      setControllerError("HackRF control process is not running.");
      return;
    }
    child.stdin.write(`${JSON.stringify(command)}\n`);
  }, []);

  const reportControllerError = useCallback((message: string) => {
    controllerErrorRef.current = message;
    setControllerError(message);
  }, []);

  useEffect(() => {
    if (!preflight.ok) {
      setMode("unavailable");
      return;
    }

    const child = spawn(
      "cargo",
      [
        "run",
        "--quiet",
        "--profile",
        "dev-incremental",
        "--bin",
        "hackrf_manual_control",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    childRef.current = child;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as {
            type?: string;
            mode?: string;
            message?: string;
            rx_frames?: number;
            sample_bytes?: number;
          };
          if (event.type === "status") setMode(event.mode ?? "unknown");
          if (event.type === "error") {
            reportControllerError(event.message ?? "HackRF control failed.");
          }
          if (event.type === "heartbeat" && event.mode) {
            setMode(event.mode);
          }
        } catch {
          reportControllerError(`Invalid controller response: ${line}`);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer = `${stderrBuffer}${chunk.toString()}`.slice(-4_000);
    });
    child.on("error", (error) => {
      reportControllerError(
        `Could not launch HackRF controller: ${error.message}`,
      );
      setMode("unavailable");
    });
    child.on("close", (code) => {
      childRef.current = null;
      if (code && code !== 0 && !controllerErrorRef.current) {
        const errorLines = stderrBuffer.trim().split("\n");
        const detail = errorLines[errorLines.length - 1];
        reportControllerError(
          detail
            ? `HackRF controller exited with status ${code}: ${detail}`
            : `HackRF controller exited with status ${code}. If hackrf_info sees the device, close other SDR apps and retry from a host terminal with direct USB access.`,
        );
      }
      setMode((previous) =>
        previous === "stopped" ? previous : "unavailable",
      );
    });

    return () => {
      if (childRef.current === child) {
        child.stdin.write('{"action":"quit"}\n');
        const killTimer = setTimeout(() => child.kill(), 1_000);
        child.once("close", () => clearTimeout(killTimer));
      }
    };
  }, [preflight.ok, reportControllerError]);

  const answer = useCallback(
    (observation: HackRfLedObservation) => {
      if (answered.current || !current) return;
      answered.current = true;
      setResults((previous) => ({
        ...previous,
        [resultKey(index)]: observation,
      }));
      setIndex((previous) => previous + 1);
    },
    [current, index],
  );

  useEffect(() => {
    if (current?.stage === "rx" && mode === "standby") {
      sendCommand({ action: "rx" });
      setMode("starting-rx");
    }
  }, [current?.stage, mode, sendCommand]);

  useInput((input, key) => {
    const value = input.toLowerCase();
    if (value === "q") {
      sendCommand({ action: "quit" });
      setCancelled(true);
      setComplete(true);
      return;
    }

    if (editingFrequency) {
      if (key.return) {
        const parsed = Number(frequencyHz);
        if (
          !/^\d+$/.test(frequencyHz) ||
          parsed < 1_000_000 ||
          parsed > 4_294_967_295
        ) {
          setControllerError(
            "TX frequency must be digits in Hz, from 1000000 through 4294967295.",
          );
        } else {
          setControllerError(null);
        }
        setEditingFrequency(false);
      } else if (key.backspace || key.delete) {
        setFrequencyHz((previous) => previous.slice(0, -1));
      } else if (/^\d$/.test(input)) {
        setFrequencyHz((previous) => `${previous}${input}`);
      }
      return;
    }

    if (isAwaitingTx) {
      if (mode === "starting-tx") return;
      if (confirmingTx && value === "y") {
        sendCommand({ action: "tx", frequency_hz: frequencyHz });
        setConfirmingTx(false);
        setMode("starting-tx");
        setControllerError(null);
      } else if (confirmingTx && value === "n") {
        setConfirmingTx(false);
      } else if (!confirmingTx && value === "f") {
        setControllerError(null);
        setEditingFrequency(true);
      } else if (!confirmingTx && value === "t") {
        const parsed = Number(frequencyHz);
        if (
          !/^\d+$/.test(frequencyHz) ||
          parsed < 1_000_000 ||
          parsed > 4_294_967_295
        ) {
          setControllerError("Set a valid TX frequency first with f.");
        } else {
          setConfirmingTx(true);
        }
      } else if (!confirmingTx && value === "s") {
        answer("skip");
      }
      return;
    }

    if (value === "r" && preflight.ok && mode !== "rx") {
      sendCommand({ action: "rx" });
      setMode("starting-rx");
      return;
    }
    if (value === "y") answer("on");
    if (value === "n") answer("off");
    if (value === "s") answer("skip");
  });

  useEffect(() => {
    answered.current = false;
    if (index >= HACKRF_LED_CHECKS.length) {
      setComplete(true);
      sendCommand({ action: "quit" });
      return;
    }
    if (!modeReady) return;
    const timer = setTimeout(() => answer("timeout"), timeoutMs);
    return () => clearTimeout(timer);
  }, [answer, index, modeReady, sendCommand]);

  const grades = useMemo(
    () =>
      HACKRF_LED_CHECKS.map((check, checkIndex) => {
        const observation = results[resultKey(checkIndex)];
        return observation
          ? gradeHackRfLedObservation(check.expectedOn, observation)
          : undefined;
      }),
    [results],
  );
  const hasFailures =
    grades.includes("FAIL") || !preflight.ok || Boolean(controllerError);
  const hasInconclusive =
    cancelled ||
    grades.some((grade) => grade === "SKIP" || grade === "TIMEOUT");

  useEffect(() => {
    if (!complete) return;
    const exitCode = hasFailures ? 1 : hasInconclusive ? 2 : 0;
    const timer = setTimeout(() => exit(exitCode), 1_200);
    return () => clearTimeout(timer);
  }, [complete, exit, hasFailures, hasInconclusive]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>HackRF One · RX/TX + LED diagnostic</Text>
      <Text color={preflight.ok ? "green" : "red"}>
        {preflight.ok ? "PREFLIGHT PASS" : "PREFLIGHT FAIL"}:{" "}
        {preflight.summary}
      </Text>
      <LedDiagram results={results} activeIndex={index} />
      {!preflight.ok && (
        <Text color="yellow">
          Suggested fix: check USB power/cable, close other SDR apps, run
          hackrf_info, and launch this diagnostic from a host terminal with USB
          access.
        </Text>
      )}
      <Text color={mode === "rx" ? "yellow" : mode === "tx" ? "red" : "cyan"}>
        Hardware control: {mode.toUpperCase()}
      </Text>
      {controllerError && <Text color="red">{controllerError}</Text>}
      {current ? (
        <Box flexDirection="column">
          <Text color="cyan" bold>
            {current.stage.toUpperCase()} · {current.instruction}
          </Text>
          {isAwaitingTx ? (
            <Box flexDirection="column">
              {mode === "starting-tx" ? (
                <Text color="yellow">
                  Starting TX stream; waiting for HackRF status…
                </Text>
              ) : (
                <>
                  <Text>
                    TX test frequency:{" "}
                    {editingFrequency
                      ? `${frequencyHz}▏`
                      : frequencyHz || "not set"}{" "}
                    Hz
                  </Text>
                  {confirmingTx ? (
                    <Text color="yellow">
                      Start zero-amplitude TX IQ at {frequencyHz} Hz? Connect a
                      dummy load or shielded setup. y = start · n = cancel
                    </Text>
                  ) : editingFrequency ? (
                    <Text>
                      Type the frequency in Hz and press Enter. Backspace edits.
                    </Text>
                  ) : (
                    <Text>
                      f = set frequency · t = start silent TX · s = skip TX
                      checks · q = quit
                    </Text>
                  )}
                </>
              )}
            </Box>
          ) : modeReady ? (
            <Text>
              y = on · n = off · s = skip · no input for{" "}
              {Math.round(timeoutMs / 1000)}s = timeout · r = RX · q = quit
            </Text>
          ) : (
            <Text color="yellow">
              Waiting for hardware mode {current.stage.toUpperCase()}… · s =
              skip · q = quit
            </Text>
          )}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text bold>Diagnostic complete</Text>
          {HACKRF_LED_CHECKS.map((check, checkIndex) => (
            <Text key={`${check.stage}:${check.id}`}>
              {check.stage.toUpperCase()} {check.id.toUpperCase()}:{" "}
              {grades[checkIndex] ?? "PENDING"}
            </Text>
          ))}
          <Text dimColor>
            RX checks use live samples. TX uses centered zero-amplitude IQ to
            check TX streaming and the red TX LED; it does not verify a radiated
            test signal.
          </Text>
        </Box>
      )}
    </Box>
  );
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    "This manual diagnostic needs an interactive terminal to show the Ink LED diagram.",
  );
  process.exit(2);
}

render(<Diagnostic preflight={checkHackRfVisibility()} />);
