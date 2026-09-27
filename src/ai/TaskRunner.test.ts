import { describe, expect, it, vi } from "vitest";

import { AIError, type AIProvider, type ChatMessage, type ChatOptions } from "./AIProvider";
import { TaskRunner } from "./TaskRunner";
import type { PetTaskHandler } from "./tasks";

function fakeProvider(reply = "  result  ") {
  const calls: { messages: ChatMessage[]; options: ChatOptions }[] = [];
  const provider: AIProvider = {
    chat: vi.fn(async (messages, options) => {
      calls.push({ messages, options });
      options.onDelta?.(reply, reply);
      return reply;
    }),
    complete: vi.fn(),
  };
  return { provider, calls };
}

const prefs = () => ({ translateTarget: "auto", autoSecondLanguage: "Bangla" });

describe("TaskRunner", () => {
  it("offers the utility tasks as menu buttons", () => {
    const runner = new TaskRunner(fakeProvider().provider, prefs);
    expect(runner.menuTasks().map((t) => t.id)).toEqual([
      "translate",
      "explain",
      "define",
      "summarize",
      "rewrite",
      "grammar",
    ]);
  });

  it("adds Explain code only when the selection looks like code", () => {
    const runner = new TaskRunner(fakeProvider().provider, prefs);
    const code = "function add(a, b) {\n  return a + b;\n}\nconst x = add(1, 2);";
    expect(runner.menuTasks(code).map((t) => t.id)).toContain("code");
    expect(runner.menuTasks("Photosynthesis turns light into energy; plants need it.").map((t) => t.id)).not.toContain("code");
    const python = "def greet(name):\n    print(f'hi {name}')\n\nimport os\nfor f in os.listdir('.'):\n    greet(f)";
    expect(runner.menuTasks(python).map((t) => t.id)).toContain("code");
  });

  it("runs every task through the same provider and trims the result", async () => {
    const { provider, calls } = fakeProvider();
    const runner = new TaskRunner(provider, prefs);
    for (const task of ["translate", "define", "explain", "summarize", "rewrite", "grammar"] as const) {
      const result = await runner.run(task, { selectedText: "Photosynthesis" });
      expect(result.text).toBe("result");
      expect(result.task).toBe(task);
    }
    expect(calls).toHaveLength(6);
    expect(calls.every((c) => c.options.system.includes("desktop AI pet"))).toBe(true);
  });

  it("uses clipboard text when nothing is selected", async () => {
    const { provider, calls } = fakeProvider();
    await new TaskRunner(provider, prefs).run("translate", { clipboardText: "from clipboard" });
    expect(calls[0].messages[0].content).toContain("from clipboard");
  });

  it("refuses text tasks without text and chat without a prompt", async () => {
    const runner = new TaskRunner(fakeProvider().provider, prefs);
    await expect(runner.run("summarize", {})).rejects.toBeInstanceOf(AIError);
    await expect(runner.run("chat", { userPrompt: "  " })).rejects.toBeInstanceOf(AIError);
  });

  it("passes the abort signal and streaming callback through", async () => {
    const { provider, calls } = fakeProvider("hi");
    const onDelta = vi.fn();
    const controller = new AbortController();
    await new TaskRunner(provider, prefs).run("chat", { userPrompt: "hello" }, { signal: controller.signal, onDelta });
    expect(calls[0].options.signal).toBe(controller.signal);
    expect(onDelta).toHaveBeenCalledWith("hi", "hi");
  });

  it("accepts new tasks without touching the pet (plugin-style)", async () => {
    const { provider, calls } = fakeProvider();
    const runner = new TaskRunner(provider, prefs);
    const shout: PetTaskHandler = {
      id: "rewrite",
      label: "Shout",
      icon: "📣",
      title: "Shouted",
      needsText: true,
      inMenu: true,
      buildPrompt: (c) => ({ system: "s", messages: [{ role: "user", content: `SHOUT ${c.selectedText}` }] }),
    };
    runner.register(shout);
    const result = await runner.run("rewrite", { selectedText: "hey" });
    expect(result.title).toBe("Shouted");
    expect(calls[0].messages[0].content).toBe("SHOUT hey");
  });
});
