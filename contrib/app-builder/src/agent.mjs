// The agent loop: ask the model, run the tools it asks for, feed the results
// back, repeat until it stops asking.
//
// The loop is ours rather than a vendor's, which is what makes the model
// swappable. It is also where the spending controls live, because an agent loop
// is exactly the thing that can run away: every turn reserves credit before it
// runs and settles afterwards against real reported usage.
//
// The tools are the security boundary, not the prompt. The model can write files
// into one project folder and nothing else. There is no shell, no network, no
// path outside the workspace, and no tool that reaches our infrastructure. A
// jailbroken prompt gets a badly written app, which then still has to pass the
// code gate and review.

import { WorkspaceError } from "./workspace.mjs";
import {
  BillingError, isPricedModel, worstCasePoints, messagesSize,
  MAX_OUTPUT_TOKENS,
} from "./meter.mjs";

export const SYSTEM_PROMPT = `You build small self-contained apps that run inside the Divi Desktop wallet.

An app is plain HTML, CSS and JavaScript in one folder. It runs in a sandbox with
no access to the user's keys, no network unless it declares one, and no framework
build step. Keep it simple and readable.

Talking to the wallet:
- Load sdk.js, then call the promise-returning helpers on window.divi.
- Only the permissions listed in manifest.json will work. Anything else is
  refused by the wallet, so do not call it.
- Never ask the user for a private key, seed phrase or password. The wallet will
  never give you one and asking is itself a red flag.

Always keep manifest.json valid and in step with the code you write.

Work in small steps. Say briefly what you are doing, use the tools, and stop when
the task is done rather than inventing extra features.`;

export const TOOLS = [
  {
    name: "write_file",
    description:
      "Create or replace a file in the app. Paths are relative to the app folder.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "e.g. index.html or css/app.css" },
        content: { type: "string", description: "the complete file contents" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description: "Read a file you have already written.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "List the files in the app with their sizes.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "delete_file",
    description: "Delete a file from the app.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

/** Run one tool call against the workspace. Never throws; failures come back as text. */
export async function runTool(workspace, call) {
  if (!TOOL_NAMES.has(call.name)) {
    return { ok: false, text: `There is no tool called "${call.name}".` };
  }
  const input = call.input ?? {};
  try {
    switch (call.name) {
      case "write_file": {
        const r = await workspace.write(input.path, input.content);
        return { ok: true, text: `Wrote ${r.path} (${r.bytes} bytes).` };
      }
      case "read_file": {
        const r = await workspace.read(input.path);
        return { ok: true, text: r.text };
      }
      case "list_files": {
        const files = await workspace.list();
        return {
          ok: true,
          text: files.length
            ? files.map((f) => `${f.path} (${f.bytes} bytes)`).join("\n")
            : "The app is empty.",
        };
      }
      case "delete_file": {
        const r = await workspace.remove(input.path);
        return { ok: true, text: `Deleted ${r.path}.` };
      }
    }
  } catch (e) {
    // A refused path or type is information the model can act on, so it is
    // returned as a tool result rather than aborting the turn.
    if (e instanceof WorkspaceError) return { ok: false, text: `Refused: ${e.message}` };
    return { ok: false, text: `Failed: ${e?.message ?? "unknown error"}` };
  }
}

/**
 * Run one developer message to completion.
 *
 * @param {object} o
 * @param {object} o.provider   from makeProvider()
 * @param {object} o.workspace  the session's Workspace
 * @param {object} o.meter      the session's SessionMeter
 * @param {Array}  o.history    conversation so far, mutated in place
 * @param {string} o.message    what the developer just said
 * @param {string} o.model
 * @param {number} [o.maxSteps] safety net against a loop that never settles
 * @param {(e:object)=>void} [o.onEvent] progress for the UI
 */
export async function runTurn({
  provider,
  workspace,
  meter,
  history,
  message,
  model,
  maxSteps = 12,
  onEvent = () => {},
  effort,
}) {
  // A model with no price is refused BEFORE anything is spent. Letting it
  // through would mean the API call happens, billing then fails, and the tokens
  // come out of our pocket with nothing charged. That exact hole was found in an
  // audit of the earlier version, so it is closed here at the entrance.
  if (!isPricedModel(model)) {
    const reason = `"${model}" is not a model this builder can bill for`;
    onEvent({ type: "error", message: reason });
    return { stopped: "error", reason, steps: 0, spent: [] };
  }

  history.push({ role: "user", content: message });

  let steps = 0;
  const spent = [];

  while (steps < maxSteps) {
    steps++;

    // Money first: work out the most this step could possibly cost, hold that,
    // and refuse to start if the balance will not cover it. The same ceiling is
    // then sent as the model's output limit, so it is a real bound and not a
    // guess we hope holds.
    let hold;
    let ceiling;
    try {
      ceiling = worstCasePoints({
        model,
        inputTokens: messagesSize(history) + messagesSize(SYSTEM_PROMPT) + messagesSize(TOOLS),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      ({ hold } = meter.reserve(ceiling));
    } catch (e) {
      if (e instanceof BillingError) {
        onEvent({ type: "billing_stopped", reason: e.message });
        return { stopped: "billing", reason: e.message, steps, spent };
      }
      throw e;
    }

    let reply;
    try {
      reply = await provider.send({
        model,
        system: SYSTEM_PROMPT,
        messages: history,
        tools: TOOLS,
        maxTokens: MAX_OUTPUT_TOKENS,
        effort,
      });
    } catch (e) {
      // Nothing was produced, so nothing is charged.
      meter.release(hold);
      onEvent({ type: "error", message: e?.message ?? "the model call failed" });
      return { stopped: "error", reason: e?.message, steps, spent };
    }

    const settled = await meter.settle({ hold, model, usage: reply.usage });
    spent.push(settled);
    onEvent({
      type: "usage",
      step: steps,
      points: settled.points,
      usd: settled.usd,
      balancePoints: meter.summary().balancePoints,
    });

    if (reply.text) onEvent({ type: "message", text: reply.text });

    // Echo the assistant turn back verbatim, including tool_use blocks: dropping
    // them breaks the pairing the API requires on the next request.
    history.push({ role: "assistant", content: reply.raw?.content ?? reply.text });

    if (!reply.toolCalls.length) {
      return { stopped: "done", steps, spent, text: reply.text };
    }

    const results = [];
    for (const call of reply.toolCalls) {
      onEvent({ type: "tool", name: call.name, path: call.input?.path });
      const r = await runTool(workspace, call);
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: r.text,
        ...(r.ok ? {} : { is_error: true }),
      });
    }
    history.push({ role: "user", content: results });
  }

  onEvent({ type: "step_limit", steps });
  return { stopped: "step_limit", steps, spent };
}
