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
  *   console.log(await program.fund({ rpc, rest, tx, amount: 1, fee: 1e-4, from: you }));
  *   
  *   // Invoke:
  *   const witness = { ...see tests for example witness data... };
  *   console.log(await program.spend({ rpc, rest, tx, amount: 1, fee: 1e-4, to: you, witness }));
  *
  **/
async function SimplicityHL (source: string, args?: SimplicityHL.Args): Promise<SimplicityHL> {
  const { compile } = await SimplicityHL.Wasm();
  const program = compile(source, { args }) as SimplicityHL;
  const fields = (program as unknown as  { toJSON (): unknown }).toJSON()
  return Object.assign(program, fields, { fund, spend });
  async function fund (context: Pick<Btc, 'rpc'|'rest'> & SimplicityHL.Fund) {
    const { rpc, rest, ...options } = context;
    return await rest.tx(await rpc.sendrawtransaction(program.fundTx(options).hex));
  }
  async function spend (context: Pick<Btc, 'rpc'|'rest'> & SimplicityHL.Spend) {
    const { rpc, rest, ...options } = context;
    return await rest.tx(await rpc.sendrawtransaction(program.spendTx(options).hex));
  }
}

/** Compiled SimplicityHL program (WASM object). */
interface SimplicityHL {
  /** Code of program. */
  source:      string
  /** CMR hash .*/
  cmr:         string
  /** The program's P2TR address. */
  p2tr:        string
  /** Transfer funds to program. */
  fund         (_: Pick<Btc, 'rpc'|'rest'> & SimplicityHL.Fund):  Promise<string>
  /** Generate transaction to transfer funds to program. */
  fundTx       (_: SimplicityHL.Fund): SimplicityHL.Transaction
  /** Transfer funds from program. */
  spend        (_: Pick<Btc, 'rpc'|'rest'> & SimplicityHL.Spend): Promise<string>
  /** Generate transaction to spend funds from program. */
  spendTx      (_: SimplicityHL.Spend): SimplicityHL.Transaction
  /** Get sighash for spend to sign by witness. */
  spendSighash (_: SimplicityHL.Spend): string;
}

/** SimplicityHL integration. */
namespace SimplicityHL {

  /** Load SimplicityHL WASM module. */
  export function Wasm (
    wasm = process.env['FADROMA_SIMF_WASM'] || import.meta.resolve('./pkg/fadroma_simf_bg.wasm'),
    wrap = process.env['FADROMA_SIMF_WRAP'] || import.meta.resolve('./pkg/fadroma_simf.js'),
  ) {
    return WasmLoader<Wasm>(wasm, wrap)()
  }

  /** SimplicityHL WASM module API. */
  export interface Wasm {
    cmr_to_p2tr: Fn.Returns<string>,
    compile:     Fn<[string, object?], SimplicityHL>,
    toJSON:      Fn.Returns<object>,
  }

  /** Parameters for fund transaction. */
  export interface Fund { tx: unknown, amount: Num, fee: Num, from: string }

  /** Parameters for spend transaction. */
  export interface Spend { tx: unknown, amount: Num, fee: Num, to: string, witness?: Args }

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

  /** Collection of SimplicityHL program arguments (template parameters or witness values). */
  export interface Args extends Record<string, Arg> {}

  /** SimplicityHL program argument (template parameter or witness value). */
  export interface Arg { type: string, value: unknown };

  /** SimplicityHL program argument constructors. */
  export namespace Arg {
    /** SimplicityHL signature field. */
    export function Signature (
      value: Uint8Array<ArrayBufferLike> = new Uint8Array(new Array(32).fill(0))
    ) {
      return { type: "Signature", value: `0x${Base16.encode(value)}` }
    }
  }
}
