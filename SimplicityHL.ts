import process from 'node:process';
import Fn from '../../library/Fn.ts';
import WasmLoader from '../../library/Wasm.ts';
import Bitcoin from '../Bitcoin/Bitcoin.ts';
import Err from '../../library/Err.ts';
import { Num, Base16 } from '../../library/Number.ts';
import { Log } from '../../library/Log.ts';

export default SimplicityHL;

/** For given SimplicityHL source, construct object representing its compiled form.
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
async function SimplicityHL (source: string, { args, chain = 'elementsregtest' }: {
  args?: SimplicityHL.Args,
  chain?: 'elementsregtest'|'liquidtestnet'
} = {}): Promise<SimplicityHL> {
  // Compilation is synchronous, but we have to wait for the WASM the first time (FIXME?)
  const { compile } = await SimplicityHL.Wasm();
  // Compile the program, receiving a WASM descriptor.
  const program = compile(source, { args, chain }) as SimplicityHL;
  // Inspect WASM program descriptor, receiving the P2TR.
  const fields = (program as unknown as { toJSON (): unknown }).toJSON();
  // Deserialize args (FIXME? do this on the rust side)
  if (typeof fields.args === 'string') fields.args = JSON.parse(fields.args as unknown as string);
  // Manually attach properties and methods:
  return Object.assign(program, fields, { commit: Commit(program), redeem: Redeem(program) });
}

function Commit (program) {
  return async function commit ({
    rest,
    rpc,
    send  = Bitcoin.Send({ rpc, rest }),
    sign  = Bitcoin.Sign.Rpc(rpc),
    debug = console.debug,
    error = console.error,
    log:  _0,
    warn: _1,
    ...options
  }: SimplicityHL.Connection & SimplicityHL.Commit) {
    const tx = program.commitTx(options);
    debug('COMMIT: INPUT:  ', tx.tx.input);
    debug('COMMIT: OUTPUT: ', tx.tx.output);
    const signed = await sign(tx.bytes);
    debug('COMMIT: SIGNED:   ', Base16.encode(tx.bytes));
    debug('COMMIT: SIGNED:   ', tx.hex);
    debug('COMMIT: SIGNATURE:', signed);
    return await rest.tx(await rpc.sendrawtransaction(tx.hex));
  }
}

function Redeem (program) {
  return async function redeem ({
    rest,
    rpc,
    send  = Bitcoin.Send({ rpc, rest }),
    sign  = Bitcoin.Sign.Rpc(rpc),
    debug = console.debug,
    error = console.error,
    log:  _0,
    warn: _1,
    ...options
  }: SimplicityHL.Connection & SimplicityHL.Redeem) {
    const tx = program.redeemTx(options);
    for (let i = 0; i < tx.tx.input.length; i++)  debug(`REDEEM: INPUT ${i}:`,  tx.tx.input[i]);
    for (let i = 0; i < tx.tx.output.length; i++) debug(`REDEEM: OUTPUT ${i}:`, tx.tx.output[i]);
    debug('REDEEM: BYTES:    ', tx.hex);
    const signed = await sign(tx.bytes);
    console.log({signed});
    if (signed.errors?.length > 0) {
      for (const e of signed.errors) error(e)
      throw Err(`Transaction signing errors (${signed.errors.length})`, signed)
    }
    if (!signed.complete) throw new Error('Transaction not fully signed', signed)
    debug('REDEEM: SIGNATURE:', signed);
    return await rest.tx(await rpc.sendrawtransaction(tx.hex));
  }
}

/** Compiled SimplicityHL program.
  *
  * This is a WASM object descriptor passed from the Rust side, augmented
  * with properties and methods by the JS [SimplicityHL] constructor function. */
interface SimplicityHL {
  /** Code of program. */
  source:      string
  /** CMR hash .*/
  cmr:          string
  /** The program's P2TR address. */
  p2tr:         string
  /** The program's template arguments. */
  args?:        SimplicityHL.Args,
  /** Transfer funds to program. */
  commit        (_: SimplicityHL.Commit & SimplicityHL.Connection):  Promise<string>
  /** Generate transaction to transfer funds to program. */
  commitTx      (_: SimplicityHL.Commit): SimplicityHL.Transaction
  /** Transfer funds from program. */
  redeem        (_: SimplicityHL.Redeem & SimplicityHL.Connection): Promise<string>
  /** Generate transaction to redeem funds from program. */
  redeemTx      (_: SimplicityHL.Redeem): SimplicityHL.Transaction
  /** Get sighash for redeem to sign by witness. */
  redeemSighash (_: SimplicityHL.Redeem): string;
}

/** SimplicityHL integration. */
namespace SimplicityHL {

  /** Connection to Elements RPC for sending and signing transactions. */
  export type Connection = (Log & Partial<Pick<Bitcoin, 'rpc'|'rest'>>) & {
    send? (hex: Uint8Array): Fn.Async<unknown>
    sign? (hex: Uint8Array): Fn.Async<Uint8Array>
  };

  /** Create a Secp256k1 keypair in Rust. */
  export async function Keypair (secret: Uint8Array) {
    const { keypair } = await SimplicityHL.Wasm();
    return keypair(secret) as Keypair;
  }

  /** Secp256k1 keypair.
    *
    * TODO: Move to ../Bitcoin (but it doesn't have a WASM yet) */
  export interface Keypair {
    signSchnorr    (message: Uint8Array): Uint8Array;
    xOnlyPublicKey ():                    Uint8Array;
  }

  /** Parameters for commit transaction. */
  export interface Call { tx: unknown, amount: Num, fee: Num }

  /** Parameters for commit transaction. */
  export interface Commit extends Call { from: string }

  /** Parameters for redeem transaction. */
  export interface Redeem extends Call { to: string, witness?: Args }

  /** Collection of SimplicityHL program arguments (template parameters or witness values). */
  export interface Args extends Record<string, Arg> {}

  /** SimplicityHL program argument (template parameter or witness value). */
  export interface Arg { type: string, value: unknown };

  /** SimplicityHL program argument constructors.
    *
    * TODO: Fully cover https://github.com/BlockstreamResearch/SimplicityHL/blob/master/src/types.rs#L815 */
  export namespace Arg {
    /** SimplicityHL signature field (32 bytes). */
    export const Signature = U256('Signature');
    /** SimplicityHL public key field (32 bytes). */
    export const Pubkey    = U256('Pubkey');
    /** SimplicityHL message field (32 bytes). */
    export const Message   = U256('Message');

    /** Name-tagged 32-byte array, equivalent to U256. */
    function U256 (type: string) {
      /** Construct the given kind of U256-like. */
      return Fn.Name(type, function defU256 (
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
    bytes:       Uint8Array,
    hex:         string,
    tx:          {
      input:     unknown[]
      output:    unknown[]
      version:   unknown
      lock_time: { block: number }|{ seconds: number }
    }
  };

  /** API of internal WASM module. */
  export interface Wasm {
    cmr_to_p2tr: Fn.Returns<string>,
    compile:     Fn<[string, object?], SimplicityHL>,
    toJSON:      Fn.Returns<object>,
  }

  /** Load SimplicityHL WASM module. */
  export function Wasm (
    wasm = process.env['FADROMA_SIMF_WASM'] || import.meta.resolve('./pkg/fadroma_simf_bg.wasm'),
    wrap = process.env['FADROMA_SIMF_WRAP'] || import.meta.resolve('./pkg/fadroma_simf.js'),
  ) {
    return WasmLoader<Wasm>(wasm, wrap)()
  }
}
