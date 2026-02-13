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

### Load the WASM module

You can [download a build](https://github.com/hackbg/simf/releases)
or [compile the module from the included source](#iterate).

When `pkg/fadroma_simf_bg.wasm` is in place, import the SDK:

```ts
#!/usr/bin/env deno run
import { SimplicityHL } from 'fadroma';
await SimplicityHL.Wasm();
```

### Compile SimplicityHL to P2TR

Starting with SimplicityHL source code, you can **call `compile` to compute its CMR and P2TR**.

```ts
const program = await SimplicityHL(`fn main () {
  assert!(true);
}`);
```

The returned `Program` object's `tx_fund` and `tx_spend` generate transactions for
respectively deploying and invoking the SimplicityHL program.

#### Deploy SimplicityHL program

> This part is not documented yet!

```ts
// This example is not written yet!
```

#### Execute SimplicityHL program

> This part is not documented yet!

```ts
// This example is not written yet!
```

### Convert CMR to P2TR 

Starting with the CMR (Commitment Merkle root) hash, you can get its corresponding
**P2TR (Pay to Taproot)** address using the `cmr_to_p2tr` function.

```ts
// This example is not written yet!
```

Sending funds to a P2TR address is equivalent to deploying the corresponding program.

## Development

See `Justfile` for pre-configured workflow operations:

```
just  # list commands
```

### Dependencies

The standard project workflow depends on:

  * Just
  * Docker (or Podman when env `DOCKER=podman`)

#### Quick setup

If you have Nix and Direnv, `direnv allow` the repo
for a classic Nix shell with `just` and `podman`.

### Run tests

Having checked out this repo, use the `test*` commands in the Justfile to run the tests:

```
just test      # run tests
just test-img  # rebuild test image
```

>This repo is an excerpt from a larger monorepo, https://github.com/hackbg/fadroma,
>which is currently unpackaged/unpublished.

>As some of the dependencies involved are only available via Git checkout,
>we've provided a test container image (`test` target in `Dockerfile`) with
>the test context already provided.
>
>This image clones a pinned commit of Fadroma when built;
>this repo's tests then run in a subdirectory of that.

### Iterate

On first checkout, as well as after making changes to the Rust source code,
use the `wasm*` commands in the Justfile to recompile the WASM binary:
```
just wasm      # rebuild wasm module
just test-img  # rebuild wasm builder image
```

>As the Rust/C ABI boundary is slightly fragile, we provide a build image
>(`wasm` target in `Dockerfile`) with matching versions of build dependencies.
>
>Otherwise, compatibility issues may be encountered, as indicated by
>multiple missing "env" imports in the WASM's ABI.
>
>Ostensibly, the incompatibility is between the Clang version that was
>used to build the Rust compiler being used, vs. the Clang version that
>is currently available on the system (which compiles the jets from C).

## Attribution

This project applies techniques pioneered by the following projects:

* simplicity-lang (CC0)
  https://docs.rs/simplicity-lang/0.7.0/src/simplicity/bit_machine/tracker.rs.html#137-140

* simply (MIT license)
  https://github.com/starkware-bitcoin/simply

* simplicityhl-core (MIT/Apache license)
  https://github.com/BlockstreamResearch/simplicity-contracts/
