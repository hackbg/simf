> ☝️ This code is part of [Fadroma](https://github.com/hackbg/fadroma), the cross-chain framework.
>
> We're building an example Simplicity dApp with it [here](https://github.com/hackbg/simf-app),
> CLI and API first!

# Standalone SimplicityHL Support in Fadroma

This minimalist WASM module allows you to:
* **compile** a Bitcoin smart contract
  * from SimplicityHL source code
  * from CMR (Commitment Merkle root) hash
* **deploy** a Bitcoin smart contract
  * by generating a transaction that transfers funds to its P2TR address
* **execute** a Bitcoin smart contract
  * by generating a transaction that contains a witness signature
    of the contract's affirmative evaluation.

The above operations are accessible from JS/TS land, through an equally minimalist SDK.

In turn, that enables full-stack integration testing atop a
a temporary Elements localnet in `elementsregtest` mode.

## Usage

### Loading the module

[dev build (alpha)](https://github.com/hackbg/simf/releases/download/20260203/fadroma_simf_bg.wasm)

**There is a remaining `env` import, `__assert_fail`, which needs to be polyfilled**
to the WASM's `wasm-bindgen` wrapper:
  * in Deno we use a stub module in the global import map for this
  * for Node you could try `"env": "./stub.js"` in `package.json` and
    `export function __assert_fail () {}` in `stub.js`
    while we're looking how to provide this out of the box.

### Compiling a CMR to P2TR 

Starting with the CMR (Commitment Merkle root) hash, you can get its corresponding
**P2TR (Pay to Taproot)** address using the `cmr_to_p2tr` function.

Sending funds to a P2TR address is equivalent to deploying the corresponding program.

### Compiling SimplicityHL to P2TR

Starting with SimplicityHL source code, you can **call `compile` to compute its CMR and P2TR**.

The returned `Program` object's `tx_fund` and `tx_spend` generate transactions for
respectively deploying and invoking the SimplicityHL program.

## Development

Dependencies:

  * Just
  * Docker (or Podman/Buildah)

See `Justfile` for available deployment tasks.

### Running tests

Having checked out this repo, use the `test-*` commands in the Justfile to run the tests.

This repo is an excerpt from a larger monorepo (currently unpackaged/unpublished),
so we've provided a test image with the required context.

See comment in `Dockerfile` for info about test context.

### Iterating

Having made changes to the source code, use the `wasm-*` commands in the Justfile to recompile.

As the Rust/C ABI boundary is slightly fragile, we provide a build image with
matching versions of build dependencies.

See comment in `Dockerfile` for more info.
