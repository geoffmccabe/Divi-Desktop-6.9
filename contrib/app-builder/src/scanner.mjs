// Screening what a developer types before it reaches the model.
//
// Read this first, because it is easy to over-trust: THIS IS NOT THE SECURITY
// BOUNDARY. Anyone patient enough will eventually phrase a request in a way no
// rule list catches. What actually contains a jailbroken prompt is that the
// model has nothing dangerous to reach: four file tools, one folder, no shell,
// no network. See agent.mjs.
//
// So what is this for? Three real jobs:
//   1. Stop the obvious attempts cheaply, before they cost tokens.
//   2. Produce a record of what people actually try, which is the only honest
//      basis for improving any of this.
//   3. Give repeat offenders somewhere to run out of patience.
//
// Every rule is data, so the admin panel can edit them without a code change.

export const VERDICT = { ALLOW: "allow", FLAG: "flag", BLOCK: "block" };

/**
 * The default rule set.
 *
 * `weight` is how much suspicion a match adds. Nothing is blocked on one weak
 * signal alone, because a developer legitimately building a wallet app will say
 * words like "balance", "key" and "send" all day.
 */
export const DEFAULT_RULES = [
  // --- Trying to talk past the instructions ---
  { id: "ignore-instructions", weight: 60, why: "asking the model to disregard its instructions",
    re: /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|all|your)\b[^.]{0,20}\b(instruction|prompt|rule|system|guideline)/i },
  { id: "role-reassignment", weight: 55, why: "trying to reassign what the model is",
    re: /\byou are (now|actually)\b|\bpretend (you|to be)\b|\bact as (if|though|a)\b[^.]{0,30}\b(unrestricted|jailbroken|developer mode|no rules)\b/i },
  { id: "dev-mode", weight: 50, why: "invoking a fictional unrestricted mode",
    re: /\b(developer mode|dan mode|jailbreak|god mode|sudo mode|unrestricted mode)\b/i },
  { id: "reveal-system", weight: 45, why: "trying to extract the system instructions",
    re: /\b(repeat|print|show|output|reveal|what are)\b[^.]{0,30}\b(system prompt|your instructions|initial prompt|prompt above)\b/i },

  // --- Going after the user's money or keys ---
  { id: "seek-private-key", weight: 90, why: "asking for private keys or a seed phrase",
    re: /\b(private key|privkey|seed phrase|mnemonic|recovery phrase|dumpprivkey|wallet\.dat|passphrase)\b/i },
  { id: "silent-send", weight: 85, why: "trying to move coins without the user agreeing",
    re: /\b(send|transfer|sweep|drain|withdraw)\b[^.]{0,50}\b(without|no|bypass|skip|avoid)\b[^.]{0,25}\b(confirm|approval|asking|permission|prompt|dialog)\b/i },
  { id: "hidden-behaviour", weight: 70, why: "asking for behaviour hidden from the user",
    re: /\b(hidden|secret|invisible|undetectable|silently|covert)\b[^.]{0,30}\b(send|transfer|record|log|track|collect|exfiltrat)/i },
  { id: "phishing-ui", weight: 75, why: "imitating the wallet's own screens",
    re: /\b(fake|clone|copy|imitate|mimic|replicate|look like)\b[^.]{0,30}\b(wallet|divi desktop|login|unlock|password|seed) (screen|page|prompt|dialog|form|window)\b/i },

  // --- Going after us ---
  { id: "target-infrastructure", weight: 80, why: "targeting Divi's own systems",
    re: /\b(divi\.love|nodes\.divi|ai\.divi|scan\.divi|our server|your server|the relay|treasury key|signing key|publishing key)\b/i },
  { id: "escape-sandbox", weight: 75, why: "trying to break out of the sandbox",
    re: /\b(escape|break out of|bypass|circumvent|get around)\b[^.]{0,30}\b(sandbox|iframe|csp|content security|permission|broker)\b/i },
  { id: "reach-tauri", weight: 80, why: "trying to reach the wallet's internals directly",
    re: /\b(__tauri__|window\.parent|tauri\s*\.\s*invoke|invoke\s*\(\s*['"]wallet_)/i },
  { id: "other-app-data", weight: 60, why: "trying to read another app's data",
    re: /\b(read|access|steal|dump)\b[^.]{0,30}\b(other|another|different)\b[^.]{0,15}\b(app|application)('s)?\b[^.]{0,15}\b(data|storage|files)\b/i },

  // --- Shapes that only exist to hide things ---
  { id: "obfuscated-payload", weight: 55, why: "a long encoded blob rather than a request",
    re: /\b(base64|atob|btoa|fromCharCode|\\x[0-9a-f]{2}|%[0-9a-f]{2}){1}[^]{0,20}([A-Za-z0-9+/]{60,}={0,2})/i },
  { id: "long-encoded-run", weight: 40, why: "an unexplained long encoded run",
    re: /[A-Za-z0-9+/]{120,}={0,2}/ },
];

export const DEFAULT_THRESHOLDS = { flag: 40, block: 70 };

/** Repeat offending gets less patience, not more. */
export const DEFAULT_STRIKES = { blocksBeforeCooloff: 3, cooloffMinutes: 15 };

export class Scanner {
  constructor({ rules = DEFAULT_RULES, thresholds = DEFAULT_THRESHOLDS, strikes = DEFAULT_STRIKES } = {}) {
    this.rules = rules;
    this.thresholds = thresholds;
    this.strikes = strikes;
    this.log = [];
    this.accounts = new Map();
  }

  /**
   * Score one message.
   * @param {string} text
   * @param {{accountId?: string, at?: number}} ctx
   */
  scan(text, ctx = {}) {
    const input = typeof text === "string" ? text : "";
    const at = ctx.at ?? Date.now();
    const accountId = ctx.accountId ?? "anonymous";

    const hits = [];
    let score = 0;
    for (const rule of this.rules) {
      let matched = false;
      try {
        matched = rule.re.test(input);
      } catch {
        // A malformed rule must never take the scanner down with it: an admin
        // typing a bad pattern should see it ignored, not lose all screening.
        matched = false;
      }
      if (matched) {
        hits.push({ id: rule.id, weight: rule.weight, why: rule.why });
        score += rule.weight;
      }
    }

    const account = this.accountState(accountId);
    const cooling = account.cooloffUntil > at;

    let verdict = VERDICT.ALLOW;
    if (cooling) verdict = VERDICT.BLOCK;
    else if (score >= this.thresholds.block) verdict = VERDICT.BLOCK;
    else if (score >= this.thresholds.flag) verdict = VERDICT.FLAG;

    if (verdict === VERDICT.BLOCK && !cooling) {
      account.blocks += 1;
      if (account.blocks >= this.strikes.blocksBeforeCooloff) {
        account.cooloffUntil = at + this.strikes.cooloffMinutes * 60_000;
        account.blocks = 0;
      }
    }

    const entry = {
      at,
      accountId,
      verdict,
      score,
      hits: hits.map((h) => h.id),
      cooling,
      // Kept in full: tuning rules against paraphrased memories of what people
      // tried is guesswork. Trimmed only to keep one entry from being enormous.
      text: input.slice(0, 2000),
    };
    this.log.push(entry);
    if (this.log.length > 5000) this.log.shift();

    return {
      verdict,
      score,
      hits,
      cooling,
      // Deliberately vague to the developer. A precise "rule 7 caught you" is a
      // free tuning signal for whoever is probing.
      message:
        verdict === VERDICT.BLOCK
          ? cooling
            ? "Too many blocked requests. Try again in a little while."
            : "That request was not accepted. Describe what the app should do for its user, rather than how to get around its limits."
          : null,
    };
  }

  accountState(accountId) {
    if (!this.accounts.has(accountId)) {
      this.accounts.set(accountId, { blocks: 0, cooloffUntil: 0 });
    }
    return this.accounts.get(accountId);
  }

  /** For the admin panel: newest first. */
  recent(limit = 200) {
    return this.log.slice(-limit).reverse();
  }

  /**
   * Re-run the whole log against the current rules.
   *
   * This is the point of keeping the text. It turns tuning from guesswork into
   * measurement: change a weight, see exactly which past attempts change
   * verdict, before saving.
   */
  replay() {
    const shadow = new Scanner({ rules: this.rules, thresholds: this.thresholds, strikes: this.strikes });
    const changes = [];
    for (const entry of this.log) {
      const now = shadow.scan(entry.text, { accountId: "replay", at: entry.at });
      if (now.verdict !== entry.verdict) {
        changes.push({ at: entry.at, was: entry.verdict, now: now.verdict, text: entry.text.slice(0, 200) });
      }
    }
    return { total: this.log.length, changed: changes.length, changes };
  }
}
