"""Add a tool-capable endpoint to the DD69 AI Gateway.

    python3 messages-passthrough.py /usr/local/bin/divi-ai-gateway.py

WHY THIS EXISTS
The gateway's /v1/chat takes messages and returns a string. That is exactly
right for the wallet's chat agent, and useless for an agent that writes files:
an agent that writes files is nothing but tool calls, and a string cannot carry
one.

So this adds /v1/messages, which forwards the request to Anthropic's Messages
API unchanged and returns the reply unchanged. Tool calls survive because
nothing reshapes them.

WHAT IT DOES NOT CHANGE
The key stays on this server and is never sent to a client — which is the whole
reason the gateway exists. A desktop app cannot keep a shared secret, so the
alternative is asking every single user for their own Anthropic key, which is
both absurd and the opposite of the arrangement (we hold the account, they pay
in points).

Safe to run twice: it checks whether the endpoint is already there.
"""
import re
import shutil
import sys

ENDPOINT = '''
    def _messages_passthrough(self, body):
        """Forward an Anthropic Messages request verbatim, and return it verbatim.

        Deliberately NOT reshaped. The moment this starts interpreting the body
        it stops being able to carry whatever Anthropic adds next, and tool calls
        are exactly the thing that gets lost when a proxy tries to be clever.
        """
        p = PROVIDERS.get("claude")
        if not p:
            self._send(400, {"error": "no claude provider is configured"})
            return
        if not provider_is_ready(p):
            self._send(503, {"error": "the claude provider has no key configured"})
            return
        key = os.environ.get(p.get("key_env", ""), "")

        payload = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "content-type": "application/json",
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                self._send_raw(r.status, r.read())
        except urllib.error.HTTPError as e:
            # Pass the upstream refusal straight through: a caller that cannot
            # see why a request was rejected cannot fix it.
            self._send_raw(e.code, e.read())
        except Exception as e:
            self._send(502, {"error": f"upstream call failed: {e}"})

    def _send_raw(self, status, raw):
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
'''

ROUTE = '''        if self.path == "/v1/messages":
            self._messages_passthrough(body)
            return

'''


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    path = sys.argv[1]
    src = open(path).read()

    if "_messages_passthrough" in src:
        print("already installed; nothing to do")
        return

    # The route goes in right after the body is parsed and before the
    # /v1/chat-only guard rejects it.
    guard = '        name = str(body.get("provider", "")).strip().lower()'
    if guard not in src:
        raise SystemExit("could not find where to add the route; the gateway has changed")
    src = src.replace(guard, ROUTE + guard, 1)

    # The path guard must let the new endpoint through.
    src = src.replace(
        '        if self.path != "/v1/chat":',
        '        if self.path not in ("/v1/chat", "/v1/messages"):',
        1,
    )

    # The method itself goes just before the log_message hook at the end of the
    # handler class.
    tail = "    def log_message(self, fmt, *args):"
    if tail not in src:
        raise SystemExit("could not find the end of the handler class")
    src = src.replace(tail, ENDPOINT + "\n" + tail, 1)

    # It needs urllib.error and os, which the file may already import.
    for mod in ("import os", "import urllib.error", "import urllib.request"):
        if not re.search(rf"^{re.escape(mod)}$", src, re.M):
            src = src.replace("import json", "import json\n" + mod, 1)

    shutil.copy(path, path + ".before-messages")
    open(path, "w").write(src)
    print(f"installed /v1/messages; previous version kept at {path}.before-messages")
    print("now: systemctl restart divi-ai-gateway")


if __name__ == "__main__":
    main()
