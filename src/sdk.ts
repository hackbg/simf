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

/** WASM instance of keypair. */
export type Keypair = WasmKeypair;

/** SimplicityHL compiler instance configured for specific chain. */
export type Compiler = WasmCompiler;

/** Collection of SimplicityHL program argument types (template parameters or witness values). */
export type ArgTypes = Record<string, string>;

/** Collection of SimplicityHL program arguments with values (template parameters or witness values). */
export type Args = Record<string, Arg>;

/** SimplicityHL program argument (template parameter or witness value). */
export type Arg = { type: string, value: unknown };

/** SimplicityHL program compiler for specific chain and parameters. */
export type Program = WasmProgram & {
  rpcCommit: Fn,
  rpcRedeem: Fn,
};

/** Parameters for commit transaction. */
export type Call = { previous: unknown, amount: Num, fee: Num };

/** Parameters for commit transaction. */
export type Commit = Call & { from: string };

/** Parameters for redeem transaction. */
export type Redeem = Call & { recipient: string, witness?: Args };

/** Connection to Elements RPC for sending and signing transactions. */
export type Connect = (Log & Partial<Pick<Bitcoin, 'rpc'|'rest'>>) & {
  send? (hex: Uint8Array): Fn.Async<unknown>
  sign? (hex: Uint8Array): Fn.Async<Uint8Array>
};

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

/** Load [Wasm] with default settings and create a [WasmKeypair]. */
export async function Keypair (secret: Uint8Array) {
  const { keypair } = await Wasm();
  return keypair(secret)
}

/** Wrap a [Keypair] as a Signer. */
export async function Signer (secret: Uint8Array) {
  const { pubECDSA } = await import('npm:@scure/btc-signer/utils.js');
  return {
    keypair:  await Keypair(secret), 
    pubEcdsa: pubECDSA(secret),
  }
}

/** Load [Wasm] with default settings and create a [Compiler]. */
export async function Compiler (...args: Parameters<Wasm['compiler']>) {
  const { compiler } = await Wasm();
  return compiler(...args)
}

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
  // Deserialize args (FIXME? do this on the rust side)
  if (typeof fields.args === 'string') fields.args = JSON.parse(fields.args as unknown as string);
  // Manually attach properties and methods:
  return Object.assign(program, fields, {
    async rpcCommit ({
      rest = missing('rest'), rpc = missing('rpc'), ...options
    }: Connect & Commit) {
      const tx = program.commitTx(options);
      return await rest.tx(await rpc!.sendrawtransaction(tx.hex));
    },
    async rpcRedeem ({
      rest = missing('rest'), rpc = missing('rpc'), ...options
    }: Connect & Redeem) {
      const tx = program.redeemTx(options);
      return await rest.tx(await rpc.sendrawtransaction(tx.hex));
    }
  });
}

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

/** Partially signed transaction from SimplicityHL WASM module. */
export interface Transaction {
  input: unknown[]
  output: unknown[]
  version: unknown
  lock_time: { block: number }|{ seconds: number }
};

export type * from './pkg/fadroma_simf.d.ts';
