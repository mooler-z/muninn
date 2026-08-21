fn main() {
    // `tauri-build` embeds the app icon into the binary at compile time, but
    // does not tell cargo it depends on the icon files. Without this,
    // regenerating icons changes nothing on screen — the old one stays baked in
    // until some unrelated edit happens to force a rebuild, which is a
    // genuinely confusing way to lose an afternoon.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    // The same trap, and a worse one: the built frontend is embedded here too,
    // and cargo is not told about it either. Edit the UI, rebuild, and the
    // binary happily serves the previous bundle — the app runs, the window
    // opens, and the change is simply absent. Adding a game this way looks
    // exactly like the game failing to open.
    println!("cargo:rerun-if-changed=../dist");

    tauri_build::build()
}
