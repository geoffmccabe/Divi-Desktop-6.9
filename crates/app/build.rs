fn main() {
    // Re-embed the frontend when it changes (Tauri embeds it at compile time).
    println!("cargo:rerun-if-changed=../../ui/dist");
    tauri_build::build()
}
