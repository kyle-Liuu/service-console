import { act, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TerminalConsole } from "@/components/terminal-console";
import { formatTerminalEntry } from "@/lib/service-logic";
import type { NormalizedLogEntry, NormalizedService } from "@/lib/types";

const xtermMocks = vi.hoisted(() => ({
  callbacks: [] as Array<() => void>,
  reset: vi.fn(),
  scrollToBottom: vi.fn(),
  write: vi.fn((_: string, callback?: () => void) => {
    if (callback) xtermMocks.callbacks.push(callback);
  }),
}));

vi.mock("@/hooks/use-auto-scroll-preference", () => ({
  useAutoScrollPreference: () => [true, vi.fn()] as const,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    options: Record<string, unknown> = {};
    rows = 24;

    dispose() {}
    loadAddon() {}
    open() {}
    refresh() {}
    reset() { xtermMocks.reset(); }
    scrollToBottom() { xtermMocks.scrollToBottom(); }
    write(value: string, callback?: () => void) { xtermMocks.write(value, callback); }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit() {}
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class MockSearchAddon {
    clearDecorations() {}
    findNext() { return true; }
    findPrevious() { return true; }
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}));

const service: NormalizedService = {
  name: "api",
  group: null,
  sortOrder: 0,
  command: "run api",
  cwd: "/workspace",
  env: {},
  autoStart: false,
  stopTimeout: 10,
  status: "RUNNING",
  pid: 123,
  uptimeSeconds: 1,
  startedAt: null,
  stoppedAt: null,
  cpuPercent: 0,
  memoryBytes: 0,
  memoryPercent: null,
  exitCode: null,
  restartCount: 0,
  lastError: null,
  raw: {},
};

function entry(message: string, millisecond: number): NormalizedLogEntry {
  return {
    timestamp: `2026-09-07T00:00:00.${String(millisecond).padStart(3, "0")}Z`,
    stream: "stdout",
    message,
  };
}

type TerminalProps = ComponentProps<typeof TerminalConsole>;

function renderTerminal(initialLogs: NormalizedLogEntry[]) {
  let props: TerminalProps = {
    service,
    logs: initialLogs,
    logRevision: 0,
    theme: "dark",
    active: true,
    busy: false,
    onAction: vi.fn(),
    onClear: vi.fn(),
  };
  const result = render(<TerminalConsole {...props} />);
  return {
    ...result,
    rerenderLogs(logs: NormalizedLogEntry[]) {
      props = { ...props, logs, logRevision: props.logRevision + 1 };
      result.rerender(<TerminalConsole {...props} />);
    },
  };
}

async function waitForWriteCount(count: number) {
  await waitFor(() => expect(xtermMocks.write).toHaveBeenCalledTimes(count));
}

async function finishNextWrite() {
  const callback = xtermMocks.callbacks.shift();
  expect(callback).toBeDefined();
  await act(async () => {
    callback?.();
    await Promise.resolve();
  });
}

describe("TerminalConsole", () => {
  beforeEach(() => {
    xtermMocks.callbacks.length = 0;
    xtermMocks.reset.mockReset();
    xtermMocks.scrollToBottom.mockReset();
    xtermMocks.write.mockClear();
  });

  it("serializes rapid log updates as incremental writes", async () => {
    const first = entry("first", 1);
    const second = entry("second", 2);
    const third = entry("third", 3);
    const view = renderTerminal([first]);

    await waitFor(() => expect(
      (screen.getByRole("button", { name: "搜索日志" }) as HTMLButtonElement).disabled,
    ).toBe(false));
    await waitForWriteCount(1);
    view.rerenderLogs([first, second]);
    view.rerenderLogs([first, second, third]);

    await finishNextWrite();
    await waitForWriteCount(2);
    expect(xtermMocks.write.mock.calls[1]?.[0]).toBe(formatTerminalEntry(second));

    await finishNextWrite();
    await waitForWriteCount(3);
    expect(xtermMocks.write.mock.calls[2]?.[0]).toBe(formatTerminalEntry(third));
    await finishNextWrite();

    expect(xtermMocks.reset).toHaveBeenCalledOnce();
  });

  it("appends after the in-memory log window drops its oldest entry", async () => {
    const first = entry("first", 1);
    const second = entry("second", 2);
    const third = entry("third", 3);
    const fourth = entry("fourth", 4);
    const view = renderTerminal([first, second, third]);

    await waitForWriteCount(1);
    await finishNextWrite();
    view.rerenderLogs([second, third, fourth]);

    await waitForWriteCount(2);
    expect(xtermMocks.write.mock.calls[1]?.[0]).toBe(formatTerminalEntry(fourth));
    await finishNextWrite();
    expect(xtermMocks.reset).toHaveBeenCalledOnce();
  });
});
