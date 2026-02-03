# Standalone SimplicityHL Compiler for WASM

> This repo is part of [Fadroma](https://github.com/hackbg/fadroma), the cross-chain framework.
>
> We're building an example Simplicity dApp with it [here](https://github.com/hackbg/simf-app),
> CLI and API first!

When compiled to WASM, this crate permits SimplicityHL programs to be deployed from JS-land.

One thing this enables is a rather fast integration testing workflow
with a temporary Elements node in `elementsregtest` mode.

## Quick start

See `Justfile`.

## API

* If you already have the CMR (Commitment Merkle root) hash of a program,
  you can **call `cmr_to_p2tr` to get the corresponding P2TR (Pay to Taproot) address**.
  Sending funds to this address is equivalent to deploying the program.

* If you have SimplicityHL source code, you can **call `compile` to compute its CMR and P2TR**.

  * **WIP:** The returned `Program` object's `spend` method allows you to build a transaction
    that consumes the funds locked in the deployed Simplicity program.

## Caveats

**Use the `wasm` commands in the Justfile for best results.** Because the SimplicityHL compiler
depends on the Rust/Clang toolchain for correct WASM ABI between C and Rust, we include a build
image manifest with mutually compatible versions of things. Otherwise, you may find many
missing imports in the `env` namespace.

**There is a remaining `env` import, `__assert_fail`, which needs to be polyfilled**
to the WASM's `wasm-bindgen` wrapper:
  * in Deno we use a stub module in the global import map for this
  * for Node you could try `"env": "./stub.js"` in `package.json` and
    `export function __assert_fail () {}` in `stub.js`
    while we're looking how to provide this out of the box.
