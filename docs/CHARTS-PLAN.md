# Charts in the wallet: what exists, what is missing, and the order to build it

Written 2026-Sep-20. The chart menu in `ui/src/wallet/PriceChart.tsx` points here.

## The thing to understand first

There are **two** chart systems, in two codebases, and they have almost
nothing in common. This has already caused two rounds of "you said you fixed
that and you didn't":

| | Where | Reads from | Charts it has |
|---|---|---|---|
| **The website** | `/Users/geoffreymccabe/Divilovescan` → https://scan.divi.love/charts | SQLite on the scanner node, via `POST /api/rpc` | nine, including wallet growth and new wallets per day |
| **The wallet app** | `/Users/geoffreymccabe/dd69-mapanim` → the Charts view | Supabase table `divi_price` only | one: DIVI price |

So when Geoff asked for wallet charts, they were built — on the website. And
when he reported the chart bottom being cut off, that was fixed — on the
website. Neither reached the app, because the app shares no code and no data
source with it.

**Rule going forward: say which of the two a change lands in, every time.**

## Where the data actually lives

### Already computed, on the scanner node
SQLite at `/var/lib/divi-scan/divi-index.sqlite`, built by the Python
scanners in `/Users/geoffreymccabe/Divilovescan/server/`:

- `daily(day, blocks, txs, payments, supply, difficulty, last_height, new_wallets, fees_burned)`
  — about 2,900 rows, one per day, back to genesis.
- `meta` — current scalars: `holders`, `addresses`, `tx_total`, `sum_total`,
  `sum_vaulted`, `fees_burned_total`.
- `balances(address, balance, vaulted, utxos)` — rebuilt from scratch each run.
- `stake_day(day, address, wins)`.

Exposed to the web as two allow-listed methods on `POST https://scan.divi.love/api/rpc`:
`scan_series` (the whole `daily` table) and `scan_summary` (the scalars).

Important: these scanners build their own UTXO set rather than using the
node's `addressindex`, because Divi's `vault` script type is invisible to
addressindex — about 28.6% of the supply. Do not "simplify" this later by
switching to addressindex; it will silently under-count by a third.

### Already in Supabase
`divi_price(ts, close)` — CoinMarketCap, daily deep-past plus hourly plus
15-minute recent. No market cap, no supply, no volume.

### Does not exist anywhere
- **Any history of how many nodes are on the network.** The scanner keeps
  `geo.sqlite: known(ip, first_seen, last_seen)`, but `last_seen` is
  overwritten on every sighting, so "how many nodes were up on 3 March" can
  never be reconstructed after the fact. Every day we do not record this is a
  day permanently lost. This is the one genuinely urgent item.
- **Holders over time.** `meta.holders` is a single current number, never
  snapshotted.
- **Market cap over time.** Both halves exist (`daily.supply` and
  `divi_price`) but are in different databases and have never been joined.

## What the node itself can and cannot answer

- `gettxoutsetinfo` gives total UTXO count and total amount. It flushes state
  to disk and holds locks, so it must only ever run on a schedule into a
  snapshot table, **never on a request path**.
- There is **no** RPC that counts addresses, and none that enumerates the
  network. `getblockstats`, `getchaintxstats` and `getnodeaddresses` do not
  exist in this node.
- Block headers carry `moneysupply` and `difficulty`, which is how the cheap
  daily supply series is built today.

## The plan

### Phase 0 — start recording nodes, today
Nothing else on this list loses data by waiting. This one does.

A scheduled job on the scanner node, once a day, writes one row per node seen
in the last 24 hours: `day, ip, country, city, lat, lon, subver, first_seen`.
Plus one summary row per day: `day, total, by_country jsonb`.

Keep the per-IP rows, not just the count. Geoff asked for this explicitly, and
it is what makes "nodes by country over time" possible later without a second
migration. An IP per node per day for a year is a few hundred thousand rows —
nothing.

Store it in Supabase, not SQLite, so the wallet can read it directly.

### Phase 1 — point the app's charts at data that already exists
No new computation at all. Add a thin reader for `scan_series` and turn on
four menu items that are currently stubs:

- **Transactions per day** — `daily.txs`
- **New wallets per day** — `daily.new_wallets`
- **Wallet growth** — the same column, accumulated
- **Nodes on the network** — from Phase 0, as soon as it has a few days

One honest caveat to carry into the UI: "wallet growth" is the cumulative
count of addresses that have **ever** held DIVI, from `addr.first_height`. It
is not the number holding DIVI *now* — those are 990,974 and 28,614
respectively, which is a large enough gap that mislabelling it would be a lie.
Label it "Addresses ever used", and treat "holders now" as Phase 3.

### Phase 2 — market cap
A nightly job multiplies `daily.supply` by that day's close from `divi_price`
and writes `daily_market_cap(day, supply, close, market_cap)` into Supabase.
Computed once, stored, never recalculated from the chain again — which is what
Geoff asked for.

### Phase 3 — holders over time
Extend the nightly job to snapshot `meta.holders` (and the balance-band
buckets, which `balances` already makes cheap) into
`daily_holders(day, holders, addresses, band_1, band_10, …)`.

This series starts the day we build it. There is no way to backfill it.

### Phase 4 — nodes by country
Chart on top of the Phase 0 per-IP rows. No new collection needed if Phase 0
stores the IPs, which is the whole reason it does.

## Design notes

- **Everything derived gets stored.** The chain is scanned once per figure per
  day; the wallet reads the stored answer. No chart ever recomputes from the
  chain on open.
- **Supabase is the wallet's only chart source.** Anything the wallet needs to
  chart has to end up there, whatever computes it.
- **One chart component.** `PriceChart.tsx` is already a general
  time-series renderer with zoom, pan and a crosshair; the new charts are a
  data source and a formatter, not new components. Rename it when the second
  one lands.
- **Charts say when they are not ready** rather than drawing an empty box. The
  menu already does this.

## Open question for Geoff

The scanners have **no committed schedule** — no cron file, no systemd unit,
in either repo. Something on the node is running them, but it is not in
version control, so nobody can see when they last ran or fix them if they
stop. Before adding four more scheduled jobs, that wants sorting out: one
committed timer file, one log, one place to look.
