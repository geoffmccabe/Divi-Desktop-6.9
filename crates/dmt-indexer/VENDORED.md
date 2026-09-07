# Vendored crate: do not edit here

`src/` and `Cargo.toml` in this directory are a **byte-identical copy** of
`contrib/dmt-indexer` in `geoffmccabe/Divi-Blockchain_6.9`, which is where these
rules are normative.

Vendored rather than referenced so DD69 builds standalone: no private-repo
credentials, no network, no submodule.

**Edit the chain repo, then run `./scripts/sync-divi-crates.sh --apply`.**
Running that script with no arguments checks for drift and fails loudly if the
copies disagree, which is the whole reason it exists.

This crate matters more than most to keep in step, because it is used here for
two different jobs:

- **`encode`** builds the records the wallet broadcasts.
- **the rest** is what every indexer uses to read them back.

If the wallet's copy of a record layout ever drifted from the indexer's, the
wallet would confidently write records the network's indexers quietly ignore,
and the user would be told nothing. One copy, checked by a script.
