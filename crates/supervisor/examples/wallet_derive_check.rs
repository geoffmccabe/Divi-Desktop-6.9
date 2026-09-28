// Prove our derivation matches the node's own: given the node's words, print
// the addresses we derive for m/44'/1'/0'/0/{0,1} on the test network.
use dd69_supervisor::{seedphrase, wallets};
fn main() {
    let path = std::env::args().nth(1).expect("words file");
    let text = std::fs::read_to_string(path).expect("read");
    let words = seedphrase::normalize(&text);
    seedphrase::check(&words).expect("valid words");
    let seed = seedphrase::to_seed_bytes(&words, "");
    for i in 0..2u32 {
        let k = wallets::derive(&seed, i, true).expect("derive");
        println!("{}", wallets::address_of(&k, true));
    }
}
