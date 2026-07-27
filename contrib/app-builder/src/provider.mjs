// Talking to a model, with the model kept swappable.
//
// Geoff's requirement is Anthropic first, other models later without a rewrite.
// So nothing above this file knows which provider is in use: the agent loop sees
// one normalised shape, and adding a provider is a new adapter here.
//
// WHY NOT ROUTE THROUGH ai.divi.love:
// The existing gateway is a text proxy. Its chat endpoint takes messages and
// returns a string, which is exactly right for the wallet's chat agent but
// cannot carry tool calls, and an agent that writes files is nothing but tool
// calls. Extending the gateway to pass the full message shape through is a
// reasonable future move; until then the builder holds its own credentials.
// That is safe for the same reason the gateway exists: the builder is a server,
// not a desktop app, so a key here is not extractable by users.
//
// Zero dependencies: Node's built-in fetch only.

export class ProviderError extends Error {}

/**
 * Normalised response every adapter returns.
 * @typedef {{
 *   text: string,
 *   toolCalls: Array<{id: string, name: string, input: any}>,
 *   usage: object,
 *   stopReason: string,
 *   model: string,
 *   raw: any
 * }} ModelReply
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic Messages API.
 *
 * Note for anyone extending this: Claude Opus 5 and Sonnet 5 reject
 * `temperature`, `top_p` and `top_k` outright, and reject the old fixed thinking
 * budget. Steer behaviour with the prompt and with `output_config.effort`.
 */
export function anthropicAdapter({ apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new ProviderError("no Anthropic API key configured");

  return {
    id: "anthropic",
    async send({ model, system, messages, tools, maxTokens = 16000, effort }) {
      const body = {
        model,
        max_tokens: maxTokens,
        messages,
        ...(system ? { system } : {}),
        ...(tools?.length ? { tools } : {}),
        ...(effort ? { output_config: { effort } } : {}),
      };

      const res = await fetchImpl(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await safeText(res);
        throw new ProviderError(`model call failed (${res.status}): ${detail}`);
      }
      const json = await res.json();
      return normaliseAnthropic(json);
    },
  };
}

export function normaliseAnthropic(json) {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const text = blocks
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("");
  const toolCalls = blocks
    .filter((b) => b?.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  return {
    text,
    toolCalls,
    usage: json?.usage ?? {},
    stopReason: json?.stop_reason ?? "end_turn",
    model: json?.model ?? "unknown",
    raw: json,
  };
}

/**
 * OpenAI-shaped providers (Grok, Mistral, self-hosted models behind Ollama or
 * vLLM). The same two adapter styles the wallet's gateway already uses, so a
 * provider that works there works here.
 */
export function openAiAdapter({ apiKey, baseUrl, fetchImpl = fetch }) {
  if (!baseUrl) throw new ProviderError("an OpenAI-style provider needs a base url");

  return {
    id: "openai",
    async send({ model, system, messages, tools, maxTokens = 16000 }) {
      const chat = [];
      if (system) chat.push({ role: "system", content: system });
      for (const m of messages) chat.push(toOpenAiMessage(m));

      const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: chat,
          ...(tools?.length ? { tools: tools.map(toOpenAiTool) } : {}),
        }),
      });

      if (!res.ok) {
        throw new ProviderError(`model call failed (${res.status}): ${await safeText(res)}`);
      }
      return normaliseOpenAi(await res.json());
    },
  };
}

function toOpenAiMessage(m) {
  if (typeof m.content === "string") return { role: m.role, content: m.content };
  // Tool results travel differently in the two shapes; flatten to text so a
  // provider without native tool results still receives the information.
  const parts = (m.content ?? [])
    .map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? String(b.content) : ""))
    .filter(Boolean);
  return { role: m.role, content: parts.join("\n") };
}

function toOpenAiTool(t) {
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  };
}

export function normaliseOpenAi(json) {
  const choice = json?.choices?.[0];
  const msg = choice?.message ?? {};
  const toolCalls = (msg.tool_calls ?? []).map((c) => ({
    id: c.id,
    name: c.function?.name,
    input: safeJson(c.function?.arguments),
  }));
  const u = json?.usage ?? {};
  return {
    text: msg.content ?? "",
    toolCalls,
    // Renamed to the shape the meter bills from, so one billing path covers
    // every provider rather than each one growing its own special case.
    usage: {
      input_tokens: u.prompt_tokens ?? 0,
      output_tokens: u.completion_tokens ?? 0,
    },
    stopReason: toolCalls.length ? "tool_use" : (choice?.finish_reason ?? "end_turn"),
    model: json?.model ?? "unknown",
    raw: json,
  };
}

function safeJson(s) {
  try {
    return JSON.parse(s ?? "{}");
  } catch {
    return {};
  }
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "no detail";
  }
}

/**
 * Build the adapter named by configuration.
 *
 * Adding a provider is an entry here plus a key. Nothing above this line changes,
 * which is the whole point of the layer.
 */
export function makeProvider(config) {
  switch (config?.kind) {
    case "anthropic":
      return anthropicAdapter(config);
    case "openai":
      return openAiAdapter(config);
    default:
      throw new ProviderError(`unknown provider "${config?.kind}"`);
  }
}
