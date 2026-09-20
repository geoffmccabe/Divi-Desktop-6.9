//! Update availability + the security tools that might interrupt a new build.
//!
//! Two read-only helpers behind the "UPDATE TO vX.Y.Z" flash and its modal:
//!   * `latest_version` — the newest published version for THIS platform, read
//!     from a tiny manifest on scan.divi.love. The UI compares it to the running
//!     version and flashes when newer. No auto-install here; that is the Tauri
//!     updater's job. This is only the "is there something newer?" signal.
//!   * `security_tools` — a best-effort list of installed firewalls / antivirus
//!     that could prompt about (or block) a freshly-updated binary, so the modal
//!     can pre-warn "you'll see a <name> prompt — click Allow." Heuristic: it
//!     reliably catches the common ones, not every obscure tool.
//!
//! Nothing here touches the wallet or keys; it reads a public JSON and looks for
//! well-known app/process names.

use serde_json::Value;
use std::time::Duration;

const MANIFEST_URL: &str = "https://scan.divi.love/downloads/latest.json";

/// The platform key used in the manifest, matching this build's OS.
pub fn os_key() -> &'static str {
    #[cfg(target_os = "macos")]
    return "mac";
    #[cfg(target_os = "windows")]
    return "windows";
    #[cfg(target_os = "linux")]
    return "linux";
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return "unknown";
}

/// The newest published version string for this platform, or None if the
/// manifest can't be read (offline, not published yet). Manifest shape:
/// `{"mac":"69.9.9","linux":"69.9.9","windows":"69.9.9"}`.
pub fn latest_version() -> Option<String> {
    let resp = ureq::get(MANIFEST_URL)
        .timeout(Duration::from_secs(10))
        .call()
        .ok()?;
    let v: Value = serde_json::from_str(&resp.into_string().ok()?).ok()?;
    v.get(os_key())
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        // Only a plain dotted number (69.9.10) is a version. Anything else — a
        // stray string, path characters, a hostile manifest — is rejected here
        // so it can never reach the download URL or the sidebar.
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit() || c == '.') && s.chars().any(|c| c.is_ascii_digit()))
}

/// True if `latest` is a strictly newer version than `current`, comparing the
/// dotted numeric parts (69.9.10 > 69.9.9). Non-numeric parts sort as 0, and a
/// shorter version is padded — so this never flashes "update" for an equal or
/// older published version.
pub fn is_newer(latest: &str, current: &str) -> bool {
    let parts = |s: &str| -> Vec<u64> {
        s.split('.').map(|p| p.trim().parse::<u64>().unwrap_or(0)).collect()
    };
    let (a, b) = (parts(latest), parts(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

/// Installed security tools that could interrupt a new build, by friendly
/// name. Best-effort and read-only.
///
/// ANSWERED ONCE PER RUN. On Windows this shells out to PowerShell, which is
/// slow and — before CREATE_NO_WINDOW was added below — visible. Software
/// like this is not installed while the wallet is open, so asking repeatedly
/// buys nothing and, through a re-rendering caller, cost Joseph a screen full
/// of console windows on 2026-Sep-20.
pub fn security_tools() -> Vec<String> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Vec<String>> = OnceLock::new();
    CACHE.get_or_init(security_tools_uncached).clone()
}

fn security_tools_uncached() -> Vec<String> {
    let mut found = Vec::new();
    #[cfg(target_os = "macos")]
    {
        // (friendly name, marker paths). A hit on any path counts.
        let checks: &[(&str, &[&str])] = &[
            ("Little Snitch", &["/Library/Little Snitch", "/Applications/Little Snitch.app"]),
            ("LuLu", &["/Applications/LuLu.app", "/Library/Objective-See/LuLu"]),
            ("Micro Snitch", &["/Applications/Micro Snitch.app"]),
            ("Bitdefender", &["/Applications/Bitdefender", "/Library/Bitdefender"]),
            ("Malwarebytes", &["/Applications/Malwarebytes.app"]),
            ("Norton", &["/Applications/Norton 360.app", "/Applications/Norton Security.app"]),
            ("Avast", &["/Applications/Avast.app", "/Applications/Avast Security.app"]),
            ("ESET", &["/Applications/ESET Endpoint Security.app", "/Applications/ESET Cyber Security.app"]),
        ];
        for (name, paths) in checks {
            if paths.iter().any(|p| std::path::Path::new(p).exists()) {
                found.push((*name).to_string());
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        // Windows Security Center registers every AV + firewall. Query it via
        // PowerShell/WMI and collect the product display names. Defender is
        // always present; third-party tools show up too.
        for class in ["AntiVirusProduct", "FirewallProduct"] {
            let cmd = format!(
                "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName {class} | \
                 Select-Object -ExpandProperty displayName"
            );
            // CREATE_NO_WINDOW. Without it every one of these opens a
            // visible console window on the user's desktop. The update
            // dialog called this on a React effect that re-ran on each
            // render, and the sidebar behind it re-renders every 1.3
            // seconds to flash the UPDATE label -- so two console windows
            // appeared, twice a second, for as long as the dialog was
            // open. Joseph, 2026-Sep-20, on Windows: "it opened many
            // powershell windows over and over and got stuck in a loop."
            // The call site is fixed too; this makes it harmless anyway.
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            if let Ok(out) = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &cmd])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    let name = line.trim();
                    if !name.is_empty() && !found.iter().any(|f| f == name) {
                        found.push(name.to_string());
                    }
                }
            }
        }
    }
    // Linux desktops rarely run app-blocking security tools; nothing to detect.
    found
}
