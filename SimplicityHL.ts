import Bitcoin         from '../Bitcoin/Bitcoin.ts';
import Fn              from '../../library/Fn.ts';
import WasmLoader      from '../../library/Wasm.ts';
import process         from 'node:process';
import { Log }         from '../../library/Log.ts';
import { Num, Base16 } from '../../library/Number.ts';

/** Load SimplicityHL WASM module. */
export async function Wasm (
  wasm = process.env['FADROMA_SIMF_WASM'] || import.meta.resolve('./pkg/fadroma_simf_bg.wasm'),
  wrap = process.env['FADROMA_SIMF_WRAP'] || import.meta.resolve('./pkg/fadroma_simf.js'),
) {
  const { keypair, compiler } = await WasmLoader<Wasm>(wasm, wrap)();
  return { wasm, wrap, keypair, compiler }
}

/** API of internal WASM module. */
export interface Wasm {
  /** Create a Secp256k1 keypair. */
  keypair (secret: Uint8Array): Keypair;
  /** Create a SimplicityHL compiler. */
  compiler (options: {
    /** The chain we'll be compiling for. Output is chain-specific */
    genesis: string
    /** Genesis block of chain we'll be compiling for. */
    chain: 'elementsregtest'|'liquidtestnet'
  }): Compiler;
}

/** Secp256k1 keypair. */
export interface Keypair {
  signSchnorr (message: Uint8Array): Uint8Array;
  xOnlyPublicKey (): Uint8Array;
}

/** Load [Wasm] with default settings and create a [Keypair]. */
export async function Keypair (secret: Uint8Array) {
  const { keypair } = await Wasm();
  return keypair(secret)
}

/** SimplicityHL compiler. */
export interface Compiler {
  compile: Fn<[string, object?], Program>
}

/** Load [Wasm] with default settings and create a [Compiler]. */
export async function Compiler (...args: Parameters<Wasm['compiler']>) {
  const { compiler } = await Wasm();
  return compiler(...args)
}

/** Compiled SimplicityHL program.
  *
  * This is a WASM object descriptor passed from the Rust side, augmented
  * with properties and methods by the JS [SimplicityHL] constructor function. */
export interface Program {
  /** The program's P2TR address. */
  p2tr:         string
  /** Code of program. */
  source:       string,
  /** The program's template arguments. */
  args?:        Args,
  /** Transfer funds to program. */
  commit        (_: Commit & Connection):  Promise<string>
  /** Generate transaction to transfer funds to program. */
  commitTx      (_: Commit): { bytes: Uint8Array, hex: string, tx: Transaction }
  /** Transfer funds from program. */
  redeem        (_: Redeem & Connection): Promise<string>
  /** Generate transaction to redeem funds from program. */
  redeemTx      (_: Redeem): { bytes: Uint8Array, hex: string, tx: Transaction }
  /** Get sighash for redeem to sign by witness. */
  redeemSighash (_: Redeem): string;
  /** Get PSET for redeem for fully manual signing. */
  redeemPset    (_: Redeem): string;
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
  // Compilation is synchronous, but we have to wait for the WASM the first time (FIXME?)
  const { compiler } = await Wasm();
  // Compile the program for the target chain, receiving a WASM descriptor.
  const program = compiler({ chain, genesis }).compile(source, { args, chain }) as Program;
  // Inspect WASM program descriptor, receiving the P2TR.
  const fields = (program as unknown as { toJSON (): Program }).toJSON();
  // Deserialize args (FIXME? do this on the rust side)
  if (typeof fields.args === 'string') fields.args = JSON.parse(fields.args as unknown as string);
  // Manually attach properties and methods:
  return Object.assign(program, fields, { commit: Commit(program), redeem: Redeem(program) });
}

/** Connection to Elements RPC for sending and signing transactions. */
export type Connection = (Log & Partial<Pick<Bitcoin, 'rpc'|'rest'>>) & {
  send? (hex: Uint8Array): Fn.Async<unknown>
  sign? (hex: Uint8Array): Fn.Async<Uint8Array>
};

/** Parameters for commit transaction. */
export interface Call { previous: unknown, amount: Num, fee: Num }

/** Parameters for commit transaction. */
export interface Commit extends Call { from: string }

/** Parameters for redeem transaction. */
export interface Redeem extends Call { recipient: string, witness?: Args }

/** Collection of SimplicityHL program arguments (template parameters or witness values). */
export interface Args extends Record<string, Arg> {}

/** SimplicityHL program argument (template parameter or witness value). */
export interface Arg { type: string, value: unknown };

/** Format a `{ type, value }` pair as used to pass `param` and `witness` values. */
export function Arg (type: string, value?: unknown) { return { type, value } }

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
      const hex = '0x'+Base16.encode(value);
      console.debug({ type, length: value.length, value, hex });
      return { type, value: hex }
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

function Commit (program: Program) {
  const missing = (name: string) => { throw new Error(`commit: missing: ${name}`) }
  return async function commit ({
    rest  = missing('rest'),
    rpc   = missing('rpc'),
    send  = Bitcoin.Send({ rpc, rest }),
    sign  = Bitcoin.Sign.Rpc(rpc),
    debug = console.debug,
    error = console.error,
    log:  _0,
    warn: _1,
    ...options
  }: Connection & Commit) {
    const tx = program.commitTx(options);
    debug('COMMIT: INPUT:  ', tx.tx.input);
    debug('COMMIT: OUTPUT: ', tx.tx.output);
    const signed = await sign(tx.bytes);
    debug('COMMIT: SIGNED:   ', Base16.encode(tx.bytes));
    debug('COMMIT: SIGNED:   ', tx.hex);
    debug('COMMIT: SIGNATURE:', signed);
    return await rest.tx(await rpc!.sendrawtransaction(tx.hex));
  }
}

function Redeem (program: Program) {
  const missing = (name: string) => { throw new Error(`redeem: missing: ${name}`) }
  return async function redeem ({
    rest  = missing('rest'),
    rpc   = missing('rpc'),
    send  = Bitcoin.Send({ rpc, rest }),
    sign  = Bitcoin.Sign.Rpc(rpc),
    debug = console.debug,
    error = console.error,
    log:  _0,
    warn: _1,
    ...options
  }: Connection & Redeem) {
    const tx = program.redeemTx(options);
    //console.log({tx});
    //for (let i = 0; i < tx.tx.input.length; i++)  debug(`REDEEM: INPUT ${i}:`,  tx.tx.input[i]);
    //for (let i = 0; i < tx.tx.output.length; i++) debug(`REDEEM: OUTPUT ${i}:`, tx.tx.output[i]);
    //debug('REDEEM: BYTES:    ', tx.hex);
    //const signed = await sign(tx.bytes);
    //console.log({signed});
    //if (signed.errors?.length > 0) {
      //for (const e of signed.errors) error(e)
      //throw Err(`Transaction signing errors (${signed.errors.length})`, signed)
    //}
    //if (!signed.complete) throw new Error('Transaction not fully signed', signed)
    //debug('REDEEM: SIGNATURE:', signed);
    return await rest.tx(await rpc.sendrawtransaction(tx.hex));
  }
}
