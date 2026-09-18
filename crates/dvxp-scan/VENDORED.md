# Vendored crate: do not edit here

Byte-identical copy of `contrib/dvxp-scan` in `geoffmccabe/Divi-Blockchain_6.9`.
See `crates/dmt-indexer/VENDORED.md`; the same rules apply.

## Why `default-features = false` here

The supervisor depends on this crate with default features **off**, which drops
its HTTP client and its read-API listener and leaves the rules, the block parser
and the query layer.

That is deliberate and it is the point of the crate being a library first. The
wallet drives the scanner **in-process, from its own node connection**, rather
than talking to an indexer process over HTTP. A self-custody wallet that got its
token balances from a service would let that service's downtime hide a user's own
holdings from them, and the whole design exists to prevent exactly that.

`src/bin/` comes along in the copy and does not build without the `rpc` feature,
which is correct: the daemon is for the explorer, not for the wallet.
