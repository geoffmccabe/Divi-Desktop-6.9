use serde_json::Value;

/// Maps getstakingstatus fields to one plain sentence. The first blocker (in
/// priority order) is the one worth telling the user about.
pub fn staking_sentence(s: &Value) -> String {
    if s["staking status"].as_bool() == Some(true) {
        return "Staking is ACTIVE.".into();
    }
    let checks: [(&str, &str); 6] = [
        ("haveconnections", "You're not staking because the node has no network connections."),
        ("mnsync", "You're not staking because the node is still syncing with the network."),
        ("walletunlocked", "You're not staking because the wallet is locked. Unlock it to stake."),
        ("enoughcoins", "You're not staking because your balance is below the staking minimum."),
        ("mintablecoins", "You're not staking because your coins aren't mature enough to stake yet."),
        ("validtime", "You're not staking because the node's clock isn't in sync yet."),
    ];
    for (field, sentence) in checks {
        if s[field].as_bool() == Some(false) {
            return sentence.into();
        }
    }
    "Staking is off for an unrecognized reason (this is a bug — the app should always know).".into()
}
