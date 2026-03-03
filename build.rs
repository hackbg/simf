extern crate cc;
use std::env;
use std::path::Path;
fn main() {
    println!("cargo:rerun-if-changed=deps/rust-simplicity/simplicity-sys/depend");
    println!("cargo:rerun-if-changed=src/stub.c");
    println!("cargo::rustc-env=TARGET=wasm32-unknown-emscripten");
    let simplicity_path = Path::new("deps/rust-simplicity/simplicity-sys/depend/simplicity");
    let mut build = cc::Build::new();
    let files: Vec<_> = vec![
        "bitstream.c",
        "ctx8Pruned.c",
        "ctx8Unpruned.c",
        "dag.c",
        "deserialize.c",
        "elements/checkSigHashAllTx1.c",
        "elements/elementsJets.c",
        "elements/env.c",
        "elements/exec.c",
        "elements/ops.c",
        "elements/primitive.c",
        "elements/txEnv.c",
        "eval.c",
        "frame.c",
        "hashBlock.c",
        "jets-secp256k1.c",
        "jets.c",
        "rsort.c",
        "schnorr0.c",
        "schnorr6.c",
        "sha256.c",
        "type.c",
        "typeInference.c",
    ].into_iter().map(|x| simplicity_path.join(x)).collect();
    build.std("c11")
        .flag_if_supported("--no-entry")
        .flag_if_supported("-fno-inline-functions")
        .flag_if_supported("-fno-zero-call-used-regs")
        .opt_level(2)
        .files(files)
        .file(Path::new("deps/rust-simplicity/simplicity-sys/depend/wrapper.c"))
        .file(Path::new("deps/rust-simplicity/simplicity-sys/depend/env.c"))
        .file(Path::new("deps/rust-simplicity/simplicity-sys/depend/jets_wrapper.c"))
        .file(Path::new("src/stub.c"))
        .include(simplicity_path.join("include"));
    if cfg!(not(fuzzing)) {
        build.define("PRODUCTION", None);
    }
    // Fix missing libc in WASM
    if env::var("CARGO_CFG_TARGET_ARCH").unwrap() == "wasm32" {
        build.compiler("emcc");
        build.target("wasm32-unknown-emscripten");
        build.include("wasm-sysroot");
    }
    build.compile("ElementsSimplicity");
}
