import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Workspace } from "../src/workspace.mjs";
import { SessionMeter } from "../src/meter.mjs";
import { runTurn, runTool, TOOLS } from "../src/agent.mjs";

// A provider that replays a fixed script. No network, no spend, no flakiness:
// the loop's behaviour is what is under test, not the model's.
function fakeProvider(script) {
  let i = 0;
  return {
    id: "fake",
    calls: [],
    async send(req) {
      this.calls.push(req);
      const step = script[i++];
      if (!step) throw new Error("the fake provider ran out of script");
      if (step.throw) throw new Error(step.throw);
      return {
        text: step.text ?? "",
        toolCalls: step.toolCalls ?? [],
        usage: step.usage ?? { input_tokens: 1000, output_tokens: 500 },
        stopReason: step.toolCalls?.length ? "tool_use" : "end_turn",
        model: "fake-model",
        raw: { content: step.raw ?? [{ type: "text", text: step.text ?? "" }] },
      };
    },
  };
}

async function harness({ balanceDivi = 10_000 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dd69-agent-"));
  const workspace = new Workspace(path.join(dir, "project"));
  await workspace.init();
  const meter = new SessionMeter({ balanceDivi, diviPerUsd: 100 });
  return { workspace, meter, history: [] };
}

test("writes the file the model asks for, then stops", async () => {
  const { workspace, meter, history } = await harness();
  const provider = fakeProvider([
    { toolCalls: [{ id: "t1", name: "write_file", input: { path: "index.html", content: "<h1>hi</h1>" } }] },
    { text: "Done." },
  ]);

  const events = [];
  const r = await runTurn({
    provider, workspace, meter, history,
    message: "make a hello page", model: "claude-sonnet-5",
    onEvent: (e) => events.push(e),
  });

  assert.equal(r.stopped, "done");
  assert.equal((await workspace.read("index.html")).text, "<h1>hi</h1>");
  assert.ok(events.some((e) => e.type === "tool" && e.name === "write_file"));
  assert.ok(events.some((e) => e.type === "usage"));
});

test("a refused path comes back as a tool error and the loop carries on", async () => {
  const { workspace, meter, history } = await harness();
  const provider = fakeProvider([
    { toolCalls: [{ id: "t1", name: "write_file", input: { path: "../escape.html", content: "x" } }] },
    { text: "Understood, I will stay inside the app folder." },
  ]);

  const r = await runTurn({
    provider, workspace, meter, history,
    message: "write outside", model: "claude-sonnet-5",
  });

  assert.equal(r.stopped, "done");
  // The refusal was handed back to the model rather than crashing the turn.
  const toolResult = history.find(
    (m) => Array.isArray(m.content) && m.content[0]?.type === "tool_result",
  );
  assert.match(String(toolResult.content[0].content), /Refused/);
  assert.equal(toolResult.content[0].is_error, true);
  assert.deepEqual(await workspace.list(), []);
});

test("an invented tool name is refused without touching the workspace", async () => {
  const { workspace } = await harness();
  const r = await runTool(workspace, { name: "run_shell", input: { cmd: "rm -rf /" } });
  assert.equal(r.ok, false);
  assert.match(r.text, /no tool called/);
  assert.deepEqual(await workspace.list(), []);
});

test("the loop stops when credit runs out, rather than spending on", async () => {
  // Enough for the first step only.
  const { workspace, meter, history } = await harness({ balanceDivi: 30 });
  const provider = fakeProvider([
    { toolCalls: [{ id: "t1", name: "list_files", input: {} }], usage: { input_tokens: 1e6, output_tokens: 1e6 } },
    { toolCalls: [{ id: "t2", name: "list_files", input: {} }] },
    { text: "never reached" },
  ]);

  const events = [];
  const r = await runTurn({
    provider, workspace, meter, history,
    message: "go", model: "claude-sonnet-5",
    onEvent: (e) => events.push(e),
  });

  assert.equal(r.stopped, "billing");
  assert.ok(events.some((e) => e.type === "billing_stopped"));
  // It stopped early rather than running the whole script.
  assert.ok(provider.calls.length < 3);
});

test("a failed model call charges nothing and releases the hold", async () => {
  const { workspace, meter, history } = await harness({ balanceDivi: 500 });
  const provider = fakeProvider([{ throw: "upstream exploded" }]);

  const before = meter.summary().balanceDivi;
  const r = await runTurn({
    provider, workspace, meter, history,
    message: "go", model: "claude-sonnet-5",
  });

  assert.equal(r.stopped, "error");
  assert.equal(meter.summary().balanceDivi, before, "balance must be untouched");
  assert.equal(meter.summary().reservedDivi, 0, "the hold must be released");
});

test("a model that never settles is cut off by the step limit", async () => {
  const { workspace, meter, history } = await harness();
  const provider = fakeProvider(
    Array.from({ length: 20 }, (_, i) => ({
      toolCalls: [{ id: `t${i}`, name: "list_files", input: {} }],
    })),
  );

  const r = await runTurn({
    provider, workspace, meter, history,
    message: "loop forever", model: "claude-sonnet-5", maxSteps: 4,
  });

  assert.equal(r.stopped, "step_limit");
  assert.equal(provider.calls.length, 4);
});

test("the model is offered file tools and nothing that reaches the system", () => {
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, ["delete_file", "list_files", "read_file", "write_file"]);
  const serialised = JSON.stringify(TOOLS);
  for (const forbidden of ["shell", "exec", "bash", "fetch", "http", "network"]) {
    assert.ok(!serialised.includes(forbidden), `tools must not expose ${forbidden}`);
  }
});
