> ☝️ This code is part of [Fadroma](https://github.com/hackbg/fadroma), the cross-chain framework.
>
> We're building an example Simplicity dApp with it [here](https://github.com/hackbg/simf-app),
> CLI and API first!

# Standalone SimplicityHL Support in Fadroma

## Introduction

This package implements the following operations:

* **compile** a Bitcoin smart contract from SimplicityHL source code to a corresponding P2TR (Pay-to-Taproot) address.
* **deploy** a SimplicityHL smart contract by generating a transaction that transfers funds to its address.
* **execute** a SimplicityHL smart contract by providing a signed witness to the contract's affirmative evaluation for given values.

You get to invoke the above operations from JS/TS land, through an equally minimalist SDK.

In turn, this enables full-stack integration testing from a scripting language,
atop an ephemeral Elements localnet in `elementsregtest` mode.

## Usage

### Load the module

You can [download a build](https://github.com/hackbg/simf/releases) or [compile the module yourself](#build-the-wasm-binary).

```ts
// This example is not written yet!
```

#### Polyfill `env.__assert_fail`

There is a remaining `env` import, `__assert_fail`, which needs to be polyfilled
to the WASM's `wasm-bindgen` wrapper. In Deno and browsers we can use a stub module
in the global import map for this. For Node you could 
try `"env": "./stub.js"` in `package.json`
and `export function __assert_fail () {}` in `stub.js` while we're looking how to provide this out of the box.

### Convert CMR to P2TR 

Starting with the CMR (Commitment Merkle root) hash, you can get its corresponding
**P2TR (Pay to Taproot)** address using the `cmr_to_p2tr` function.

Sending funds to a P2TR address is equivalent to deploying the corresponding program.

### Compile SimplicityHL to P2TR

Starting with SimplicityHL source code, you can **call `compile` to compute its CMR and P2TR**.

The returned `Program` object's `tx_fund` and `tx_spend` generate transactions for
respectively deploying and invoking the SimplicityHL program.

#### Deploy SimplicityHL program

> This part is not documented yet!

#### Execute SimplicityHL program

> This part is not documented yet!

## Development

### Quick start

See `Justfile`.

### Dependencies

  * Just
  * Docker (or Podman/Buildah)

### Run tests

Having checked out this repo, use the `test-*` commands in the Justfile to run the tests.

This repo is an excerpt from a larger monorepo (currently unpackaged/unpublished),
so we've provided a test image with the required context.

See comment in `Dockerfile` for info about test context.

### Iterate

Having made changes to the source code, use the `wasm-*` commands in the Justfile
to recompile the WASM binary.

As the Rust/C ABI boundary is slightly fragile, we provide a build image with
matching versions of build dependencies.

See comment in `Dockerfile` for more info.

## Attribution

This project applies techniques pioneered by the following projects:

* simply (MIT license)
  https://github.com/starkware-bitcoin/simply

* simplicityhl-core (MIT/Apache license)
  https://github.com/BlockstreamResearch/simplicity-contracts/
