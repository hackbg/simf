> ☝️ This code is part of [Fadroma](https://github.com/hackbg/fadroma), the cross-chain framework.
>
> We're building an example Simplicity dApp with it [here](https://github.com/hackbg/simf-app),
> CLI and API first!

# Standalone SimplicityHL Support in Fadroma

## Introduction

This package implements the following operations:

* **compile** a Bitcoin smart contract from SimplicityHL source code
  to a corresponding P2TR (Pay-to-Taproot) address.
* **deploy** a SimplicityHL smart contract by generating a transaction
  that transfers funds to its address.
* **execute** a SimplicityHL smart contract by providing a signed witness
  to the contract's affirmative evaluation for given values.

You get to invoke the above operations from JS/TS land, through an equally minimalist SDK.

In turn, this enables full-stack integration testing from a scripting language,
atop an ephemeral Elements localnet in `elementsregtest` mode.

## Installation

This module is currently unpackaged. It's most easily available as part of the following codebase:

```sh
# Clone the example project repository with all submodules:
git clone --recursive https://github.com/hackbg/simf-app

# Enter the submodule of the submodule:
cd fadroma/platform/SimplicityHL

# If you have Nix and Direnv, this will provide Just and Podman:
direnv allow

# Built the WASM:
just wasm

# Run the tests:
just test
```

Standalone packages are in the works.

### Dependencies

If you have Nix and Direnv, `direnv allow` the repo to automatically
enter a Nix shell containing the main development dependencies:

  * Just
  * Docker (or Podman when env `DOCKER=podman`)

### WASM

On first checkout, as well as after making changes to the Rust source code,
use the `wasm*` commands in the Justfile to recompile the WASM binary,
`pkg/fadroma_simf_bg.wasm`:

```sh
just wasm        # rebuild wasm module
just wasm-img    # rebuild wasm builder image
just wasm-bacon  # run interactive rust compiler
just wasm-sh     # enter build shell to run compiler manually
```

>☝️ As the Rust/C ABI boundary is slightly fragile, we provide a build image
>(`wasm` target in `Dockerfile`) with matching versions of build dependencies.
>
>Otherwise, compatibility issues may be encountered, as indicated by
>multiple missing "env" imports in the WASM's ABI.
>
>Ostensibly, the incompatibility is between the Clang version that was
>used to build the Rust compiler being used, vs. the Clang version that
>is currently available on the system (which compiles the jets from C).

### Run tests

Having checked out this repo, and with `pkg/fadroma_simf_bg.wasm` in place,
use the `test*` commands in the Justfile to run the tests:

```sh
just test      # run tests
just test-img  # rebuild test image
```

>☝️ This repo is an excerpt from a larger monorepo, https://github.com/hackbg/fadroma,
>which is currently unpackaged/unpublished.
>
>As some of the dependencies involved are only available via Git checkout,
>we've provided a test container image (`test` target in `Dockerfile`) with
>the test context already provided.
>
>The image clones a pinned commit of Fadroma when built;
>this repo's tests then run in a subdirectory of that.

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
const P2PK = await SimplicityHL(SOURCE, {
  // Provide public key as `param::PK` at compile time:
  PK: SimplicityHL.Arg.Pubkey(PUBLIC)
});

// The program descriptor, of type `SimplicityHL`, is WASM-backed but inspectable:
console.log({ P2PK });
```

Here's some of what the `SimplicityHL` program descriptor contains:

```js
Program {
  // This is the compiled program's main address:
  p2tr: 'tex1p53f33nnjed42the73v3y2hgdgmhq98fh3d5r05u23fjwc0xyp9fqzn6ulg',

  // Template arguments are displayed as the program saw them:
  args: { PK: { type: 'u256', value: '0x1b84c5567b12...', } },

  // These correspond to what `TR:1.1` defines as **commitment time** and **redemption time**:
  fund:  [AsyncFunction: fund],
  spend: [AsyncFunction: spend],

  // These return the transaction, but don't broadcast it:
  fundTx:  [Function: fundTx],
  spendTx: [Function: spendTx],

  // Witnesses need to sign this:
  spendSighash: [Function: spendSighash],
}
```

### Commitment

The main output of the `await SimplicityHL('/*source*/', {/*args*/})` compile call is
the P2TR (Pay-to-Taproot) address which corresponds to the compiled program.

Compiling a program to P2TR address and then transferring funds to that address,
together correspond to what `TR:1.1` defines as **commitment time**.

```ts
import Bitcoin from './path/to/fadroma/platform/Bitcoin/Bitcoin.ts';

// For convenience, compiled `SimplicityHL` programs stringify
// to the address which represents them on the chain, i.e. this holds:
String(P2PK) === P2PK.p2tr;

// Transferring funds to the P2TR is equivalent to deploying the program.
// (...but this example is not written yet!...)
```

### Redemption

To transfer funds from the P2TR address, the SimplicityHL program must evaluate truthfully.
In most non-trivial cases, this involves signed witness data.

Constructing a signed witness, and then using it to authorize the transfer of funds
from a program's address P2TR address, together correspond to what `TR:1.1` defines as
**redemption time**.

```ts
// (...but this example is not written yet, either!...)
```

### Utilities

#### Convert CMR to P2TR 

If you already have the CMR (Commitment Merkle root) hash of a program,
you can convert it to its corresponding **P2TR (Pay to Taproot)** address
using the `cmr_to_p2tr` function:

```ts
// This example is not written yet!
```

## Attribution

This project applies techniques pioneered, described, or otherwise demonstrated
by the following projects:

* (**`SL:`**) [**simplicity-lang** (CC0)](https://docs.rs/simplicity-lang/0.7.0/src/simplicity/bit_machine/tracker.rs.html#137-140)
* (**`SY:`**) [**simply** (MIT: Michael Zaikin, Starkware)](https://github.com/starkware-bitcoin/simply)
* (**`TR:`**) [**Simplicity Technical Report, Draft** (MIT: Russell O'Connor, Blockstream)](https://raw.githubusercontent.com/ElementsProject/simplicity/pdf/Simplicity-TR.pdf)
* (**`SC:`**) [**simplicityhl-core** (MIT/Apache: Riabov et al., Blockstream)](https://github.com/BlockstreamResearch/simplicity-contracts/)
