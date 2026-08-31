import { test } from "node:test";
import assert from "node:assert/strict";

import { gatewayAdapter, anthropicAdapter, makeProvider, ProviderError } from "../src/provider.mjs";

/** A stand-in gateway that echoes back what it was asked, plus a tool call. */
function stubGateway({ status = 200, capture = {} } = {}) {
  return async (url, init) => {
    capture.url = url;
    capture.headers = init.headers;
    capture.body = JSON.parse(init.body);
    if (status !== 200) {
      return { ok: false, status, text: async () => "upstream said no" };
    }
    return {
      ok: true,
      json: async () => ({
        model: "claude-sonnet-5",
        content: [
          { type: "text", text: "Writing the page." },
          { type: "tool_use", id: "t1", name: "write_file", input: { path: "index.html", content: "<h1>hi</h1>" } },
        ],
        usage: { input_tokens: 1200, output_tokens: 300 },
        stop_reason: "tool_use",
      }),
    };
  };
}

test("the gateway carries tool calls, which is the entire point of it", async () => {
  // The old /v1/chat endpoint returned a string. An agent that writes files is
  // nothing but tool calls, and a string cannot carry one.
  const capture = {};
  const p = gatewayAdapter({ baseUrl: "https://ai.divi.love", token: "t", fetchImpl: stubGateway({ capture }) });
  const reply = await p.send({
    model: "claude-sonnet-5",
    system: "you build apps",
    messages: [{ role: "user", content: "make a page" }],
    tools: [{ name: "write_file", input_schema: { type: "object" } }],
  });

  assert.equal(reply.toolCalls.length, 1);
  assert.equal(reply.toolCalls[0].name, "write_file");
  assert.equal(reply.toolCalls[0].input.path, "index.html");
  assert.equal(reply.text, "Writing the page.");
  assert.equal(reply.usage.input_tokens, 1200);
});

test("the caller holds a gateway token, never a model key", async () => {
  // A desktop app cannot keep a shared secret. What it holds here is scoped to
  // this one service and can be revoked on its own; losing it does not hand
  // anybody an Anthropic account.
  const capture = {};
  const p = gatewayAdapter({ baseUrl: "https://ai.divi.love", token: "gw-token", fetchImpl: stubGateway({ capture }) });
  await p.send({ model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }] });

  assert.equal(capture.url, "https://ai.divi.love/v1/messages");
  assert.equal(capture.headers.authorization, "Bearer gw-token");
  assert.ok(!JSON.stringify(capture.headers).includes("x-api-key"), "no model key may leave this machine");
});

test("the tools go through untouched, so nothing is lost in translation", async () => {
  const capture = {};
  const tools = [{ name: "write_file", description: "d", input_schema: { type: "object", properties: {} } }];
  const p = gatewayAdapter({ baseUrl: "https://ai.divi.love/", token: "t", fetchImpl: stubGateway({ capture }) });
  await p.send({ model: "m", messages: [{ role: "user", content: "x" }], tools });
  assert.deepEqual(capture.body.tools, tools);
  // A trailing slash on the url must not produce a double slash.
  assert.equal(capture.url, "https://ai.divi.love/v1/messages");
});

test("a gateway that has not been taught the endpoint says so recognisably", async () => {
  const p = gatewayAdapter({ baseUrl: "https://ai.divi.love", token: "t", fetchImpl: stubGateway({ status: 404 }) });
  await assert.rejects(() => p.send({ model: "m", messages: [] }), /does not have the \/v1\/messages endpoint/);
});

test("a gateway with no url or no token refuses to be built", () => {
  assert.throws(() => gatewayAdapter({ token: "t" }), ProviderError);
  assert.throws(() => gatewayAdapter({ baseUrl: "https://x" }), ProviderError);
});

test("the provider is chosen by configuration, not by a rewrite", () => {
  assert.equal(makeProvider({ kind: "gateway", baseUrl: "https://x", token: "t" }).id, "gateway");
  assert.equal(makeProvider({ kind: "anthropic", apiKey: "k" }).id, "anthropic");
  assert.throws(() => makeProvider({ kind: "nonsense" }), ProviderError);
  void anthropicAdapter;
});
