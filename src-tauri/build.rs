fn main() {
    // Dev builds pass their version (scripts/dev-app.mjs); see src/identity.rs.
    println!("cargo:rerun-if-env-changed=TUXNOTES_BUILD_VERSION");
    tauri_build::build()
}
