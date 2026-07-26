# Vendored crate: do not edit here

`src/` and `Cargo.toml` in this directory are a **byte-identical copy** of
`contrib/dvxp-core` in `geoffmccabe/Divi-Blockchain_6.9`, which is where
these rules are normative.

Vendored rather than referenced so DD69 builds standalone: no private-repo
credentials, no network, no submodule.

**Edit the chain repo, then run `./scripts/sync-divi-crates.sh --apply`.**
Running that script with no arguments checks for drift and fails loudly if the
two copies disagree, which is the whole reason it exists: the same name must
validate, price and encode identically in the wallet, the explorer, and every
indexer. Two copies quietly disagreeing produces two realities, and
proof-of-work cannot arbitrate between them.

Same applies to `crates/name-registry`.
