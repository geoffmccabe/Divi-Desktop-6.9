// The ledger: one object, for every room and every week.
//
// It answers exactly one question — how much has this node earned, and how much
// has it already been paid — and it is the only thing the payout is allowed to
// ask. Rooms write to it. Nothing else does.
//
// WHY THE PAYING IS NOT DONE HERE
// -------------------------------
// A Cloudflare worker cannot sign a Divi transaction, and it should not be able
// to. The treasury key lives on the London node and nowhere else, which means
// the worst a break-in here can do is corrupt a scoreboard. Two halves:
//
//   this object   knows what is OWED, and is the only thing that can say so
//   London node   holds the coins, and is the only thing that can move them
//
// A claim is therefore a conversation: London asks "what does this node have?",
// this object answers and marks the amount as being paid, London sends it, and
// then confirms. If London never confirms, the reservation expires and the
// balance comes back — so a failed send loses the player nothing, and a
// duplicated one is refused because the amount was already taken out.

/** A thousand kills is a hundred DIVI. Geoff's terms, in one place. */
export const KILLS_PER_PAYOUT = 1000;
export const DIVI_PER_PAYOUT = 100;
/** Nothing under a hundred can be claimed. It may build up indefinitely. */
export const MIN_CLAIM = 100;
/** How long London has to confirm a send before the reservation is released. */
const RESERVE_SECONDS = 600;

/** The shape of a Divi address: a D and thirty-three base58 characters. The
 *  node checks it properly before a coin moves; this only keeps junk out. */
export const ADDRESS = /^D[1-9A-HJ-NP-Za-km-z]{33}$/;

/** A cash-out a player has asked for and London has not yet paid. One per
 *  account: a second one waits until the first is settled. */
interface Claim {
  to: string;
  at: number;
}

/** How the last cash-out ended, so the player can see what happened to it. */
interface Payout {
  to: string;
  amount: number;
  txid?: string;
  error?: string;
  at: number;
}

interface Account {
  node: string;
  name: string;
  kills: number;
  /** Lifetime points, for the leaderboard. */
  score: number;
  best: number;
  games: number;
  /** DIVI earned and not yet claimed. */
  divi: number;
  /** DIVI paid out, ever. */
  paid: number;
  /** An in-flight claim, if there is one. */
  reserved?: { amount: number; ref: string; at: number };
  seen: number;
}

interface Env {
  /** Shared with the London payout service and with nothing else. */
  PAYOUT_SECRET: string;
}

export class RebelsLedger {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    /* The router forwards the whole path, so the prefix it matched on is
       stripped here rather than being matched twice in two places. */
    const path = url.pathname.replace(/^\/+(ledger\/)?/, "");

    /* Credit comes from a room, over the Durable Object binding. A request that
       arrives that way is addressed to the synthetic host `ledger`, which is a
       name that does not resolve anywhere and cannot be reached from outside;
       anything off the internet carries the worker's real hostname. So the host
       IS the authentication, and it is one an attacker has no way to set.

       The router refuses this path publicly as well. It was briefly forwarding
       it, which made minting a DIVI balance a single unauthenticated POST. */
    if (path === "credit") {
      if (url.hostname !== "ledger") return new Response("not found", { status: 404 });
      return this.credit(req);
    }
    /* The two halves of a cash-out that belong to the PLAYER, which is to say
       to a room speaking for a seat it has authenticated. Same rule: over the
       binding only. Off the wire these would let anyone read any balance or
       point anyone's payout at their own address. */
    if (path === "purse") {
      if (url.hostname !== "ledger") return new Response("not found", { status: 404 });
      return this.purse(req);
    }
    if (path === "request") {
      if (url.hostname !== "ledger") return new Response("not found", { status: 404 });
      return this.request(req);
    }

    /* Everything below is the payout conversation, and every one of them needs
       the shared secret. Compared in constant time, since it is a secret being
       compared against attacker-supplied input. */
    if (!this.authorised(req)) return new Response("no", { status: 401 });

    if (path === "balance") return this.balance(req);
    if (path === "reserve") return this.reserve(req);
    if (path === "confirm") return this.confirm(req);
    if (path === "release") return this.release(req);
    if (path === "pending") return this.pending();
    if (path === "reject") return this.reject(req);
    if (path === "top") return this.top();
    return new Response("not found", { status: 404 });
  }

  private authorised(req: Request): boolean {
    const given = req.headers.get("authorization") ?? "";
    const want = `Bearer ${this.env.PAYOUT_SECRET ?? ""}`;
    if (!this.env.PAYOUT_SECRET) return false;
    if (given.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0;
  }

  private async load(node: string): Promise<Account> {
    const got = await this.state.storage.get<Account>(`a:${node}`);
    return got ?? {
      node, name: "", kills: 0, score: 0, best: 0, games: 0,
      divi: 0, paid: 0, seen: 0,
    };
  }

  private async save(a: Account): Promise<void> {
    a.seen = Date.now();
    await this.state.storage.put(`a:${a.node}`, a);
  }

  private async credit(req: Request): Promise<Response> {
    let body: { node?: string; name?: string; kills?: number; divi?: number; score?: number };
    try { body = await req.json(); } catch { return new Response("bad", { status: 400 }); }
    const node = String(body.node ?? "").slice(0, 80);
    if (!node) return new Response("bad", { status: 400 });

    const kills = clamp(body.kills, 0, 100_000);
    const divi = clamp(body.divi, 0, 100_000);
    const score = clamp(body.score, 0, 100_000_000);

    const a = await this.load(node);
    if (body.name) a.name = String(body.name).slice(0, 40);
    a.kills += kills;
    a.score += score;
    a.games += score > 0 ? 1 : 0;
    a.best = Math.max(a.best, score);
    a.divi += divi;
    await this.save(a);
    return Response.json({ ok: true, divi: a.divi, kills: a.kills });
  }

  private async balance(req: Request): Promise<Response> {
    const node = new URL(req.url).searchParams.get("node") ?? "";
    const a = await this.load(node);
    return Response.json({
      node: a.node, name: a.name, kills: a.kills, score: a.score, best: a.best,
      divi: Math.floor(a.divi), paid: a.paid,
      claimable: this.claimable(a),
      reserved: a.reserved?.amount ?? 0,
    });
  }

  /* ---- the player's side of a cash-out ---- */

  /** Everything the points panel shows about this account. */
  private async purse(req: Request): Promise<Response> {
    const node = new URL(req.url).searchParams.get("node") ?? "";
    if (!node) return new Response("bad", { status: 400 });
    const a = await this.load(node);
    return Response.json(await this.purseOf(a));
  }

  private async purseOf(a: Account, why?: string): Promise<Record<string, unknown>> {
    const claim = await this.state.storage.get<Claim>(`c:${a.node}`);
    const last = await this.state.storage.get<Payout>(`l:${a.node}`);
    const held = this.liveReserve(a);
    return {
      divi: Math.floor(a.divi) + (held?.amount ?? 0),
      claimable: this.claimable(a),
      paid: a.paid,
      /* While London is mid-send the amount is the reserved one, which is the
         figure that will actually arrive; before that it is what would be. */
      pending: claim
        ? { to: claim.to, amount: held?.amount ?? this.claimable(a), at: claim.at }
        : null,
      last: last ?? null,
      ...(why ? { why } : {}),
    };
  }

  /**
   * A player asking to be paid, to an address of their choosing.
   *
   * Nothing moves here. The request is written down and London finds it on
   * its next round, reserves the amount, sends, and confirms. So the address
   * is the only thing this decides, and it is bound to the account the ROOM
   * named, which is the connecting address of the socket and not a string the
   * client typed. A cheat that knows another node's address can still only
   * ever ask for that node's balance to be paid to... that node's own claim,
   * because they cannot connect from its address.
   */
  private async request(req: Request): Promise<Response> {
    let body: { node?: string; to?: string };
    try { body = await req.json(); } catch { return new Response("bad", { status: 400 }); }
    const a = await this.load(String(body.node ?? "").slice(0, 80));
    if (!a.node) return new Response("bad", { status: 400 });
    const to = String(body.to ?? "");
    if (!ADDRESS.test(to)) return Response.json(await this.purseOf(a, "that is not a DIVI address"));

    const existing = await this.state.storage.get<Claim>(`c:${a.node}`);
    if (existing) return Response.json(await this.purseOf(a, "a cash out is already waiting to be paid"));
    if (this.liveReserve(a)) return Response.json(await this.purseOf(a, "a cash out is being paid right now"));
    const amount = this.claimable(a);
    if (amount <= 0) {
      return Response.json(await this.purseOf(a, `${MIN_CLAIM} DIVI is the minimum`));
    }
    await this.state.storage.put(`c:${a.node}`, { to, at: Date.now() } satisfies Claim);
    return Response.json(await this.purseOf(a));
  }

  /* ---- London's side ---- */

  /** Every cash-out waiting to be paid, with what it would pay. */
  private async pending(): Promise<Response> {
    const all = await this.state.storage.list<Claim>({ prefix: "c:", limit: 1000 });
    const rows: Array<{ node: string; name: string; to: string; amount: number; at: number }> = [];
    for (const [k, c] of all) {
      const node = k.slice(2);
      const a = await this.load(node);
      /* One already being paid is London's own doing; it is not offered twice. */
      if (this.liveReserve(a)) continue;
      rows.push({ node, name: a.name, to: c.to, amount: this.claimable(a), at: c.at });
    }
    return Response.json({ rows: rows.filter((r) => r.amount > 0) });
  }

  /** London will not pay this one: the address failed the node's own check,
   *  say. The request is dropped and the player is told why. Nothing was
   *  reserved, so nothing is returned. */
  private async reject(req: Request): Promise<Response> {
    let body: { node?: string; why?: string };
    try { body = await req.json(); } catch { return new Response("bad", { status: 400 }); }
    const node = String(body.node ?? "").slice(0, 80);
    const claim = await this.state.storage.get<Claim>(`c:${node}`);
    if (!claim) return Response.json({ ok: false, why: "no such claim" });
    const a = await this.load(node);
    await this.state.storage.delete(`c:${node}`);
    await this.state.storage.put(`l:${node}`, {
      to: claim.to, amount: this.claimable(a), error: String(body.why ?? "refused").slice(0, 120), at: Date.now(),
    } satisfies Payout);
    return Response.json({ ok: true });
  }

  /** What could be asked for right now: whole DIVI, at least the minimum, and
   *  not counting anything already promised to an in-flight claim. */
  private claimable(a: Account): number {
    const free = Math.floor(a.divi) - (this.liveReserve(a)?.amount ?? 0);
    return free >= MIN_CLAIM ? free : 0;
  }

  private liveReserve(a: Account): Account["reserved"] {
    if (!a.reserved) return undefined;
    if (Date.now() - a.reserved.at > RESERVE_SECONDS * 1000) return undefined;
    return a.reserved;
  }

  /**
   * Take an amount out of the balance and hold it while London sends it.
   *
   * The subtraction happens HERE, before a single coin moves. That ordering is
   * the whole protection against being paid twice: a repeated or racing claim
   * finds the balance already gone, rather than finding it still there and
   * sending again.
   */
  private async reserve(req: Request): Promise<Response> {
    let body: { node?: string; ref?: string };
    try { body = await req.json(); } catch { return new Response("bad", { status: 400 }); }
    const a = await this.load(String(body.node ?? "").slice(0, 80));
    if (!a.node) return new Response("bad", { status: 400 });

    const live = this.liveReserve(a);
    if (live) return Response.json({ ok: false, why: "a claim is already being paid", amount: live.amount });

    const amount = this.claimable(a);
    if (amount <= 0) {
      return Response.json({ ok: false, why: `nothing to claim yet: ${MIN_CLAIM} DIVI is the minimum`, amount: 0 });
    }
    a.divi -= amount;
    a.reserved = { amount, ref: String(body.ref ?? crypto.randomUUID()).slice(0, 64), at: Date.now() };
    await this.save(a);
    /* Where the player asked for it. London pays to THIS and to nothing it
       was told over any other channel. */
    const claim = await this.state.storage.get<Claim>(`c:${a.node}`);
    return Response.json({ ok: true, amount, ref: a.reserved.ref, to: claim?.to ?? null });
  }

  /** London sent it. The hold becomes a payment. */
  private async confirm(req: Request): Promise<Response> {
    let body: { node?: string; ref?: string; txid?: string };
    try { body = await req.json(); } catch { return new Response("bad", { status: 400 }); }
    const a = await this.load(String(body.node ?? "").slice(0, 80));
    const held = a.reserved;
    if (!held || held.ref !== body.ref) return Response.json({ ok: false, why: "no such claim" });
    a.paid += held.amount;
    a.reserved = undefined;
    await this.save(a);
    const txid = String(body.txid ?? "").slice(0, 128);
    await this.state.storage.put(`p:${held.ref}`, {
      node: a.node, amount: held.amount, txid, at: Date.now(),
    });
    /* The request is answered. What the player sees next is the receipt. */
    const claim = await this.state.storage.get<Claim>(`c:${a.node}`);
    await this.state.storage.delete(`c:${a.node}`);
    await this.state.storage.put(`l:${a.node}`, {
      to: claim?.to ?? "", amount: held.amount, txid, at: Date.now(),
    } satisfies Payout);
    return Response.json({ ok: true, paid: a.paid });
  }

  /** London could not send it. The player gets their balance back. The
   *  request stays, to be tried again next round, unless London says to drop
   *  it (`drop` carries the reason), in which case the player is told. */
  private async release(req: Request): Promise<Response> {
    let body: { node?: string; ref?: string; drop?: string };
    try { body = await req.json(); } catch { return new Response("bad", { status: 400 }); }
    const a = await this.load(String(body.node ?? "").slice(0, 80));
    const held = a.reserved;
    if (!held || held.ref !== body.ref) return Response.json({ ok: false, why: "no such claim" });
    a.divi += held.amount;
    a.reserved = undefined;
    await this.save(a);
    if (body.drop) {
      const claim = await this.state.storage.get<Claim>(`c:${a.node}`);
      await this.state.storage.delete(`c:${a.node}`);
      await this.state.storage.put(`l:${a.node}`, {
        to: claim?.to ?? "", amount: held.amount, error: String(body.drop).slice(0, 120), at: Date.now(),
      } satisfies Payout);
    }
    return Response.json({ ok: true, divi: a.divi });
  }

  /** The table. Best single run, which is the rule the game already uses so one
   *  player cannot fill it with a hundred good nights. */
  private async top(): Promise<Response> {
    const all = await this.state.storage.list<Account>({ prefix: "a:", limit: 1000 });
    const rows = [...all.values()]
      .map((a) => ({ name: a.name || a.node, best: a.best, games: a.games, kills: a.kills }))
      .filter((r) => r.best > 0)
      .sort((x, y) => y.best - x.best)
      .slice(0, 50);
    return Response.json({ rows });
  }
}

function clamp(v: unknown, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(lo, Math.min(hi, n));
}
