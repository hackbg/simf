import type Btc        from '../../Bitcoin/index.ts';
import Fn              from '../../../library/Fn.ts';
import { Num, Base16 } from '../../../library/Num.ts';
import process         from 'node:process';

import type {
  InitOutput,
  Keypair  as WasmKeypair,
  Compiler as WasmCompiler,
  Program  as WasmProgram,
} from '../pkg/fadroma_simf.d.ts';

/** WASM cache to download the binary only once. */
let blob: unknown = null;
/** Instance of SimplicityHL WASM module. */
export type Wasm = InitOutput;
/** Load SimplicityHL WASM module. */
export async function Wasm ({
  wasm = process.env['FADROMA_SIMF_WASM'] || import.meta.resolve('../pkg/fadroma_simf_bg.wasm') as string|URL|object,
  // You can replace this with w.g. `readFile` from `fs/promises`; or polyfill `globalThis.fetch`
  fetch = globalThis.fetch
} = {}) {
  const conform = (x: string|URL) => new URL(x).toString();
  const wrap = await import('../pkg/fadroma_simf.js');
  if (!blob) {
    if ((typeof wasm === 'string')||(wasm instanceof URL)) {
      console.debug(`Loading Fadroma SimplicityHL WASM module from ${wasm}`);
      blob = await fetch(conform(wasm));
    } else {
      throw new Error(`Invalid WASM URL, need string or URL, got: ${wasm}`)
    }
  }
  await wrap.default(wasm);
  return wrap;
}

/** Spend transaction builder.
  *
  * TODO: Support multiple outputs, multiple inputs, multiple assets, in that order.
  * This will happen by extending the `sendSigner` Rust implementation. */
export interface Spend {
  /** Call this first to set the expected transaction asset. */
  asset (id: string): this;
  /** Set the transaction fee. */
  fee (amount: Num): this;
  /** Add a P2WPKH input with signer. */
  input (utxo: Btc.Utxo, signer: Keypair): this;
  /** Add a SimplicityHL/Taproot input with witness .*/
  input (utxo: Btc.Utxo, program: Program, witness: Fn): this;
  /** Add a transaction output. */
  output (address: string, amount: Num): this;
  /** Broadcast the signed transaction. */
  broadcast (chain: Btc): Promise<Btc.Tx>;
}

/** Start building a spend transaction. */
export function Spend (): Spend {
  let utxo    = null as unknown as Btc.Utxo;
  let signer  = null as unknown as Keypair;
  let program = null as unknown as Program;
  let witness = null as unknown as Fn;
  let address = null as unknown as string;
  let amount  = null as unknown as Num;
  let fee     = null as unknown as Num;
  let asset   = null as unknown as string;
  const spend = {
    asset (id: string) {
      if (asset && asset != id) {
        throw new Error(`.asset(id) already set to ${asset}, attempted to override with ${id}`)
      }
      asset = id;
      return this;
    },
    input (x: Btc.Utxo, ...args: unknown[]) {
      if (!asset) {
        throw new Error('use .asset(id) first to assert asset id')
      }
      utxo = x;
      if (args.length === 1) {
        signer = args[0] as Keypair;
      } else if (args.length === 2) {
        if (typeof program !== 'object') {
          throw new Error('.input(utxo, program <- must be object, ...')
        }
        program = args[0] as Program;
        if (typeof witness !== 'function') {
          throw new Error('.input(utxo, program, witness <- must be function')
        }
        witness = args[1] as Fn;
      } else {
        throw new Error('use .input(utxo, signer) or .input(utxo, program, witness)')
      }
      return spend;
    },
    output (x: string, y: Num) {
      if (!asset) {
        throw new Error('use .asset(id) first to assert asset id')
      }
      address = x;
      amount = y;
      return spend;
    },
    fee (x: Num) {
      fee = x;
      return spend;
    },
    async broadcast (chain: Btc) {
      if (!utxo) throw new Error('no input specified')
      if (!address || !amount) throw new Error('no output specified')
      if (!fee) throw new Error('no fee specified')
      const sender = chain.P2WPKH(signer.publicKey()).address;
      const options = { recipient: address, sender, utxos: [utxo], asset: utxo.asset, amount, fee };
      const { sendSigned } = await Wasm();
      const { hex } = sendSigned(signer, options);
      const tx = await chain.broadcast(hex);

      // TODO: Post-broadcast validation?
      //function assertTxOuts (
        //tx: { hex: unknown, vout: unknown[] },
        //p2tr:       string,
        //amount:     Num,
        //cost:       Num,
        //remaining?: number,
        //debug = console.debug,
      //) {
        ////equal(tx.vout.length, 3);
        ////debug('TX:', tx);
        //hasVout(isBalance, _ => `balance: program ${p2tr} must receive ${amount}`);
        //hasVout(isFee,     _ => `fee: no deploy fee matching ${cost}`);
        ////hasVout((x: Btc.Vout)=>x.value===remaining, v => `remaining: must be ${v}`);
        //return tx
        //function hasVout (f: Fn, msg: (v)=>string) {
           //if (tx.vout.filter(f).length !== 1) throw new Error(`post deploy: ${msg(tx.vout)}`);
        //}
        //function isBalance (x: Btc.Vout) {
          //return ((x.value===amount) && (x.scriptPubKey.address == p2tr));
        //}
        //function isFee (x: Btc.Vout) {
          //return x.value === cost;
        //}
      //}

      return tx;
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
export type Program = WasmProgram & { p2tr: string };
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
  args    = {} as unknown as Args,
  chain   = 'elementsregtest' as Btc["ID"],
  genesis = '0000000000000000000000000000000000000000000000000000000000000000',
  address = null as string|null,
} = {}): Promise<Program> {
  const missing = (name: string) => { throw new Error(`missing: ${name}`) }
  // Compilation is synchronous, but we have to wait for the WASM the first time (FIXME?)
  const compiler = (await Wasm()).compiler({ chain, genesis });
  // Compile the program for the target chain, receiving a WASM descriptor.
  const program = compiler.compile(source, { args, chain }) as unknown as Program;
  // Inspect WASM program descriptor, receiving the P2TR.
  const fields = (program as unknown as { toJSON (): Program }).toJSON();
  // Manually attach properties and methods:
  Object.assign(program, fields);
  // If a different address is expected, throw:
  if (program.p2tr !== address) {
    throw new Error(`Program compiled to ${program.p2tr} instead of expected ${address}`)
  }
  return program;
}

export type * from './pkg/fadroma_simf.d.ts';
