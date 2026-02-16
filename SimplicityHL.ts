import process from 'node:process';
import Fn from '../../library/Fn.ts';
import WasmLoader from '../../library/Wasm.ts';
import { Num, Base16 } from '../../library/Number.ts';
import type Btc from '../Bitcoin/Bitcoin.ts';

export default SimplicityHL;

/** For given SimplicityHL source, construct object representing its compiled form.
  *
  * Example:
  *
  *   #!/usr/bin/env -S deno --allow-read=.
  *   import { Btc, SimplicityHL } from '@hackbg/fadroma';
  *   
  *   // Connect:
  *   const { rpc, rest } = await Btc.LiquidTestnet();
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
async function SimplicityHL (source: string, args?: SimplicityHL.Args): Promise<SimplicityHL> {

  const { compile } = await SimplicityHL.Wasm();
  const program = compile(source, { args }) as SimplicityHL;
  const fields = (program as unknown as  { toJSON (): unknown }).toJSON();
  const result = Object.assign(program, fields, { commit, redeem });

  if (typeof result.args === 'string') {
    result.args = JSON.parse(result.args as unknown as string);
  }

  return result

  async function commit ({
    rpc, rest, log: _0, warn:_1, debug = console.debug, ...options
  }: SimplicityHL.Connection & SimplicityHL.CommitContext) {
    const tx = program.commitTx(options);
    debug('COMMIT: INPUT:  ', tx.tx.input);
    debug('COMMIT: OUTPUT: ', tx.tx.output);
    return await rest.tx(await rpc.sendrawtransaction(tx.hex));
  }

  async function redeem ({
    rpc, rest, log: _0, warn: _1, debug = console.debug, ...options
  }: SimplicityHL.Connection & SimplicityHL.RedeemContext) {
    const tx = program.redeemTx(options);
    debug('REDEEM: INPUT:  ', tx.tx.input);
    debug('REDEEM: OUTPUT: ', tx.tx.output);
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
  commit        (_: SimplicityHL.CommitContext & SimplicityHL.Connection):  Promise<string>
  /** Generate transaction to transfer funds to program. */
  commitTx      (_: SimplicityHL.CommitContext): SimplicityHL.Transaction
  /** Transfer funds from program. */
  redeem        (_: SimplicityHL.RedeemContext & SimplicityHL.Connection): Promise<string>
  /** Generate transaction to redeem funds from program. */
  redeemTx      (_: SimplicityHL.RedeemContext): SimplicityHL.Transaction
  /** Get sighash for redeem to sign by witness. */
  redeemSighash (_: SimplicityHL.RedeemContext): string;
}

/** SimplicityHL integration. */
namespace SimplicityHL {

  export type Connection = Pick<Btc, 'rpc'|'rest'|'log'|'warn'|'debug'>;

  /** Load SimplicityHL WASM module. */
  export function Wasm (
    wasm = process.env['FADROMA_SIMF_WASM'] || import.meta.resolve('./pkg/fadroma_simf_bg.wasm'),
    wrap = process.env['FADROMA_SIMF_WRAP'] || import.meta.resolve('./pkg/fadroma_simf.js'),
  ) {
    return WasmLoader<Wasm>(wasm, wrap)()
  }

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
    export const Pubkey = U256('Pubkey');

    /** SimplicityHL message field (32 bytes). */
    export const Message = U256('Message');

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

  /** Parameters for commit transaction. */
  export interface CallContext { tx: unknown, amount: Num, fee: Num }

  /** Parameters for commit transaction. */
  export interface CommitContext extends CallContext { from: string }

  /** Parameters for redeem transaction. */
  export interface RedeemContext extends CallContext { to: string, witness?: Args }

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
}
