> ☝️ This code is part of [Fadroma](https://github.com/hackbg/fadroma), the cross-chain framework.
>
> We're building an example Simplicity dApp with it [here](https://github.com/hackbg/simf-app),
> CLI and API first!

# SimplicityHL Standalone

## Introduction

This is how to do the following from any JavaScript environment,
by means of an embedded WebAssembly module:

* [**compile**](#compile-simplicityhl-to-p2tr) a Bitcoin smart contract from SimplicityHL source code
  to corresponding P2TR (Pay-to-Taproot) address.
* [**commit**](#commitment) to compiled SimplicityHL smart contract by transferring
  funds to its P2TR address (a.k.a. deploy it; fund it).
* [**redeem**](#redemption) a deployed SimplicityHL smart contract by spending
  funds from its P2TR address under the authority of signed witness data.

## Installation

This repo is currently unpackaged. It's most easily runnable as part of the demo codebase:

```sh
# Clone the example project repository with all submodules:
git clone --recursive https://github.com/hackbg/simf-app

# Enter the submodule of the submodule:
cd fadroma/platform/SimplicityHL

# If you have Nix and Direnv, this will provide Just and Podman:
direnv allow

# Build the WASM and run the tests:
just

```

Standalone packages are in the works.

>☝️ Run `just -l` and see the [Hacking](#hacking) section for DX details.

### Dependencies

If you have **Nix** and **Direnv**, `direnv allow` this repo to automatically
enter a Nix shell containing up-to-date versions of the main development dependencies,
**Just**, **Podman**, and **Deno**.

>☝️ Outside of the Nix shell, the `Justfile` will instead default to using
>your system `docker` (rootless). To control that, you can set the
>environment variable `DOCKER` to `sudo docker`, `podman`, `buildah` or appropriate.

## Usage

### Compile SimplicityHL to P2TR

With `pkg/fadroma_simf_bg.wasm` in place, here's how to import the SDK
and **compile a smart contract from SimplicityHL source code**.

```ts
#!/usr/bin/env -S deno run
import SimplicityHL from './path/to/fadroma/platform/SimplicityHL/SimplicityHL.ts';
import { pubSchnorr } from 'npm:@scure/btc-signer/utils.js';

// P2PK (pay to public key) is one of the smallest useful SimplicityHL programs.
const SOURCE = `fn main () {
  jet::bip_0340_verify((param::PK, jet::sig_all_hash()), witness::SIG);
}`;

// P2PK transfers funds if you can prove you have this secret:
const SECRET = new Uint8Array(Array(32).fill(1));

// But what is written on the blockchain is its public counterpart:
const PUBLIC = pubSchnorr(SECRET);

// Compile the P2PK program by constructing a SimplicityHL program object:
const program = await SimplicityHL(SOURCE, {
  // Provide public key as `param::PK` at compile time:
  args: { PK: SimplicityHL.Arg.Pubkey(PUBLIC) }
});

// The program descriptor, of type `SimplicityHL`, is WASM-backed but inspectable:
console.log({ program });
```

Here's some of what you will find in the `SimplicityHL` program descriptor:

```js
{
  // This is the compiled program's main address:
  p2tr: 'tex1p53f33nnjed42the73v3y2hgdgmhq98fh3d5r05u23fjwc0xyp9fqzn6ulg',

  // Source is displayed as passed:
  source: `fn main () { ... }`,

  // Template arguments are displayed as the program saw them:
  args: { PK: { type: 'u256', value: '0x1b84c5567b12...', } },

  // These correspond to what `TR:1.1` defines as **commitment time** and **redemption time**:
  commit: [AsyncFunction: commit],
  redeem: [AsyncFunction: redeem],

  // These return the transaction, but don't broadcast it:
  commitTx: [Function: commitTx],
  redeemTx: [Function: redeemTx],

  // Witnesses need to sign this in order to redeem:
  redeemSighash: [Function: redeemSighash],
}
```

### Commitment

The **main output** of the compile call `await SimplicityHL('/*source*/', {/*options*/})` is
the **P2TR (Pay-to-Taproot) address** which corresponds to the **CMR (Commitment Merkle root)**
of the compiled program.

```ts
// For convenience, a compiled `SimplicityHL` program stringifies to its P2TR address:
String(program) === program.p2tr;
```

Compiling a program to its P2TR address and then transferring funds to that address,
together correspond to what `TR:1.1` defines as **commitment time**.

Continuing from the first example, this is the first point
at which we need to **connect to the chain**:

```ts
// This will give us the RPC handle to sign and broadcast transactions:
import Bitcoin from './path/to/fadroma/platform/Bitcoin/Bitcoin.ts';

// For the localnet:
const { rpc, rest } = await Bitcoin.ElementsRegtest();

// For the testnet:
const { rpc, rest } = await Bitcoin.LiquidTestnet();
```

Transferring funds to the P2TR is equivalent to deploying the program.
You can send the funds directly by any method:

```ts
const commitTxId = await rpc.sendtoaddress(program.p2tr, 1000);
```

Or you can use the `SimplicityHL` program object to generate a transaction
to broadcast manually:

```ts
const commitTx = await program.commitTx({ tx, amount, fee, from: user });
// TODO broadcast
```

Or you can commit to the contract in a single function call:

```ts
const commitTxId = await program.commit({ rpc, rest, tx, amount, fee, from: user });
```

You will need the commit TXID to perform the redemption step.

### Redemption

To transfer funds from the P2TR address, the SimplicityHL program must evaluate truthfully.
In most non-trivial cases, this involves signed witness data.

Constructing a signed witness, and then using it to authorize the transfer of funds
from a program's address P2TR address, together correspond to what `TR:1.1` defines as
**redemption time**.

First, you need to **obtain the commit transaction data** from the commit TXID.
Then, you will need to **construct and sign witness data**:

```ts
const sighash = program.redeemSighash({ tx: await rest.tx(commitTxId), amount, fee, to })
// TODO construct and sign
```

You are now able to generate a redeem transaction to broadcast manually:

```ts
const redeemTx = await program.redeemTx({ tx, amount, fee, witness, to: user });
// TODO broadcast
```

Or you can perform the contract redemption in one go:

```ts
const redeemTxId = await program.redeem({ rpc, rest, tx, amount, fee, witness, to: user });
```

### Utilities


## Hacking

### Build the WASM

On first checkout, as well as after making changes to the Rust source code,
use the `build*` commands in the Justfile to recompile the WASM binary,
`pkg/fadroma_simf_bg.wasm`:

```sh
# Normal build workflow:
just               # build and integration test
just bacon         # run (in build container) tui that rechecks on file change
just build-debug   # compile pkg/fadroma_simf_bg.wasm in container (debug mode)
just build-release # compile pkg/fadroma_simf_bg.wasm in container (release mode mode)

# Utilities:
just build-inspect # view imports and exports defined in pkg/fadroma_simf_bg.wasm
just build-img     # rebuild container image (normally happens automatically)
just build-sh      # enter build container (to run tools manually)

# Danger zone:
just build-wasm-debug   # compile pkg/fadroma_simf_bg.wasm with your local toolchain (debug mode)
just build-wasm-release # compile pkg/fadroma_simf_bg.wasm with your local toolchain (release mode)
```

#### ABI

As the Rust/C ABI boundary is slightly fragile, we provide a **build container image
(`wasm` target in `Dockerfile`)** with matching versions of build dependencies.

Outside of it, you may encounter compatibility issues indicated by
multiple missing "env" imports in the WASM's ABI (`just build-inspect`).

>☝️ Ostensibly, the incompatibility is between the Clang version that was
>used to build the Rust compiler being used, vs. the Clang version that
>is currently available on the system (which compiles the jets from C).

### Run the tests

Having checked out this repo, and with `pkg/fadroma_simf_bg.wasm` in place,
use the `test*` commands in the Justfile to run the tests:

```sh
just test      # run tests
just test-img  # rebuild test image
```

The tests run on an automatically managed ephemeral Elements localnet in `elementsregtest` mode.

>☝️ This repo is an excerpt from a larger monorepo, https://github.com/hackbg/fadroma,
>which is currently unpackaged/unpublished.
>
>As some of the dependencies involved are only available via Git checkout,
>and a version of Elements with Simplicity was only recently added to Nixpkgs Unstable,
>we provide a **test container image (`test` target in `Dockerfile`)** with
>the test context already provided.
>
>The image clones a pinned commit of Fadroma when built;
>this repo's tests then run in a subdirectory of that.

## Acknowledgments, References, Attribution

This project applies techniques pioneered, described, or otherwise demonstrated
by the following projects:

* (**`EL:`**) [**elements**](https://github.com/ElementsProject/elements/blob/master/LICENSE)
* (**`EM:`**) [**elements-miniscript**](https://github.com/ElementsProject/elements-miniscript/blob/master/LICENSE)
* (**`SC:`**) [**simplicityhl-core** (MIT/Apache: Riabov et al., Blockstream)](https://github.com/BlockstreamResearch/simplicity-contracts/)
* (**`SL:`**) [**simplicity-lang** (CC0: Poelstra et al., Blockstream)](https://github.com/BlockstreamResearch/rust-simplicity/)
* (**`SW:`**) [**simplicity-webide** (CC0: Lewe et al., Blockstream)](https://github.com/BlockstreamResearch/simplicity-webide)
* (**`SY:`**) [**simply** (MIT: Zaikin et al., Starkware)](https://github.com/starkware-bitcoin/simply)
* (**`TR:`**) [**Simplicity Technical Report, Draft** (MIT: O'Connor, Blockstream)](https://raw.githubusercontent.com/ElementsProject/simplicity/pdf/Simplicity-TR.pdf)
