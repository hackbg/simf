import type Bitcoin    from '../../Bitcoin/index.ts';
import Fn              from '../../../library/Fn.ts';
import { Log }         from '../../../library/Log.ts';
import { Num, Base16 } from '../../../library/Num.ts';
import process         from 'node:process';

import type {
  InitOutput,
  Keypair  as WasmKeypair,
  Compiler as WasmCompiler,
  Program  as WasmProgram,
} from '../pkg/fadroma_simf.d.ts';

/** Instance of SimplicityHL WASM module. */
export type Wasm = InitOutput;
/** Load SimplicityHL WASM module. */
export async function Wasm ({
  wasm = process.env['FADROMA_SIMF_WASM'] || import.meta.resolve('../pkg/fadroma_simf_bg.wasm') as string|URL|object,
  // You can replace this with w.g. `readFile` from `fs/promises`; or polyfill `globalThis.fetch`
  fetch = globalThis.fetch
} = {}) {
  console.debug(`Loading Fadroma SimplicityHL WASM module from ${wasm}`);
  const conform = (x: string|URL) => new URL(x).toString();
  const wrap = await import('../pkg/fadroma_simf.js');
  if ((typeof wasm === 'string')||(wasm instanceof URL)) wasm = await fetch(conform(wasm));
  await wrap.default(wasm);
  return wrap;
}

/** Spend transaction builder.
  *
  * TODO: Support multiple outputs, multiple inputs, multiple assets, in that order.
  * This will happen by extending the `sendSigner` Rust implementation. */
export interface Spend {
  /** Transaction asset. */
  readonly asset: string;
  /** Set the transaction fee. */
  fee (amount: Num): this;
  /** Add a P2WPKH input with signer. */
  input (utxo: Btc.Utxo, signer: Signer): this;
  /** Add a SimplicityHL/Taproot input with witness .*/
  input (utxo: Btc.Utxo, program: Program, witness: Fn): this;
  /** Add a transaction output. */
  output (address: string, amount: Num): this;
  /** Broadcast the signed transaction. */
  broadcast (chain: Chain): Promise<Btc.TxInfo>;
}

/** Start building a spend transaction. */
export function Spend (asset: string): Spend {
  let utxo    = null;
  let signer  = null;
  let program = null;
  let witness = null;
  let address = null;
  let amount  = null;
  let fee     = null;
  const spend = {
    fee (x: Num) {
      fee = x;
      return spend;
    },
    input (x: Btc.Utxo, ...args: unknown[]) {
      utxo = x;
      if (args.length === 1) {
        signer = args[0];
      } else if (args.length === 2) {
        if (typeof program !== 'object') {
          throw new Error('.input(utxo, program <- must be object, ...')
        }
        program = args[0];
        if (typeof witness !== 'function') {
          throw new Error('.input(utxo, program, witness <- must be function')
        }
        witness = args[1];
      } else {
        throw new Error('use .input(utxo, signer) or .input(utxo, program, witness)')
      }
      return spend;
    },
    output (x: string, y: num) {
      address = x;
      amount  = y;
      return spend;
    },
    async broadcast (chain: Btc) {
      if (!utxo) throw new Error('no input specified')
      if (!address || !amount) throw new Error('no output specified')
      if (!fee) throw new Error('no fee specified')
      const { sendSigned } = await Wasm();
      const { hex } = await sendSigned(signer, {});
      return await chain.broadcast(hex);
    }
  };
  return spend;
}

/** WASM instance of keypair. */
export type Keypair = WasmKeypair;
/** Load [Wasm] with default settings and create a [WasmKeypair]. */
export async function Keypair (secret: Uint8Array) {
  const { keypair } = await Wasm();
  return keypair(secret)
}

/** SimplicityHL compiler instance configured for specific chain. */
export type Compiler = WasmCompiler;
/** Load [Wasm] with default settings and create a [Compiler]. */
export async function Compiler (...args: Parameters<Wasm['compiler']>) {
  const { compiler } = await Wasm();
  return compiler(...args)
}

/** Collection of SimplicityHL program argument types (template parameters or witness values). */
export type ArgTypes = Record<string, string>;

/** Collection of SimplicityHL program arguments with values (template parameters or witness values). */
export type Args = Record<string, Arg>;

/** SimplicityHL program argument (template parameter or witness value). */
export type Arg = { type: string, value: unknown };
/** Format a `{ type, value }` pair as used to pass `param` and `witness` values. */
export function Arg (type: string, value?: unknown) {
  return { type, value }
}
/** SimplicityHL program argument constructors.
  *
  * TODO: Fully cover https://github.com/BlockstreamResearch/SimplicityHL/blob/master/src/types.rs#L815 */
export namespace Arg {
  /** Literal 256-bit number. */
  export const U256      = defU256('U256');
  /** SimplicityHL signature field (32 bytes). */
  export const Signature = defU256('Signature');
  /** SimplicityHL public key field (32 bytes). */
  export const Pubkey    = defU256('Pubkey');
  /** SimplicityHL message field (32 bytes). */
  export const Message   = defU256('Message');

  /** Name-tagged 32-byte array, equivalent to U256. */
  function defU256 (type: string) {
    /** Construct the given kind of U256-like. */
    return Fn.Name(type, function defineU256 (
      value: Uint8Array<ArrayBufferLike> = new Uint8Array(new Array(32).fill(0))
    ) {
      return { type, value: '0x'+Base16.encode(value) }
    });
  }
}

/** SimplicityHL program compiler for specific chain and parameters. */
export type Program = WasmProgram & {
  rpcCommit: Fn,
  rpcRedeem: Fn,
};
/** Load WASM with default settings, create [Compiler], and compile program.
  *
  * Example:
  *
  *   #!/usr/bin/env -S deno --allow-read=.
  *   import { Bitcoin, SimplicityHL } from '@hackbg/fadroma';
  *   
  *   // Connect:
  *   const { rpc, rest } = await Bitcoin.LiquidTestnet();
  *
  *   // Compile:
  *   const program = await SimplicityHL('...source...');
  *   
  *   // Deploy:
  *   const you = 'tex1000000000000000000000000000000000000000';
  *   console.log(await program.commit({ rpc, rest, tx, amount: 1, fee: 1e-4, from: you }));
  *   
  *   // Invoke:
  *   const witness = { ...see tests for example witness data... };
  *   console.log(await program.redeem({ rpc, rest, tx, amount: 1, fee: 1e-4, to: you, witness }));
  *
  **/
export async function Program (source: string, {
  args,
  chain   = 'elementsregtest',
  genesis = '0000000000000000000000000000000000000000000000000000000000000000',
}: {
  args?:    Args,
  chain?:  'elementsregtest'|'liquidtestnet',
  genesis?: string
} = {}): Promise<Program> {
  const missing = (name: string) => { throw new Error(`missing: ${name}`) }
  // Compilation is synchronous, but we have to wait for the WASM the first time (FIXME?)
  const compiler = (await Wasm()).compiler({ chain, genesis });
  // Compile the program for the target chain, receiving a WASM descriptor.
  const program = compiler.compile(source, { args, chain });
  // Inspect WASM program descriptor, receiving the P2TR.
  const fields = (program as unknown as { toJSON (): Program }).toJSON();
  // Manually attach properties and methods:
  return Object.assign(program, fields);
}

export type * from './pkg/fadroma_simf.d.ts';
