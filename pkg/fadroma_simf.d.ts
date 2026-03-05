/* tslint:disable */
/* eslint-disable */

export class Compiler {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Compile a SimplicityHL [Program].
   */
  compile(source: string, options: object): Program;
}

export class Keypair {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Tweaked public key for authenticating in programs.
   */
  publicKey(): Uint8Array;
  /**
   * Perform ECDSA signing (for simple transactions).
   */
  signEcdsa(message: Uint8Array): Uint8Array;
  /**
   * Perform Schnorr signing (for taproot/witnesses).
   */
  signSchnorr(message: Uint8Array): Uint8Array;
  /**
   * Tweaked public key for authenticating in programs.
   */
  xOnlyPublicKey(): Uint8Array;
}

export class Program {
  private constructor();
/**
** Return copy of self without private attributes.
*/
  toJSON(): Object;
/**
* Return stringified version of self.
*/
  toString(): string;
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Produce JSON dict of compile-time parameter types.
   */
  paramTypes(): object;
  /**
   * Partially-signed redeem transaction without witnesses.
   * For manual signing.
   */
  redeemPsbt(options: any): any;
  /**
   * Produce JSON dict of run-time parameter types.
   */
  witnessTypes(): object;
  /**
   * SIGHASH_ALL of redeem transaction.
   * Sign this to provide witness data.
   */
  redeemSighash(options: any): Uint8Array;
  /**
   * Produce JSON description of program object.
   */
  toJSON(): object;
  /**
   * Signed redeem transaction.
   * Broadcast it to redeem funds.
   */
  redeemTx(options: any): object;
}

export class Pst {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Show inner [Transaction].
   */
  toTx(): object;
  /**
   * Show [PartiallySignedTransaction]
   */
  toPset(): any;
  /**
   * Simplified sign procedure.
   */
  toSigned(keypair: Keypair): any;
}

/**
 * Create compiler, providing chain constants.
 */
export function compiler(options: any): Compiler;

/**
 * Create [secp256k1] keypair from 32-byte secret.
 */
export function keypair(secret: Uint8Array): Keypair;

/**
 * Extract parameter types from SimplicityHL source code.
 */
export function paramTypes(source: string): object;

export function pst(arg: object): Pst;

export function sendSigned(signer: Keypair, options: any): any;

export function sendUnsigned(options: any): any;

export function sendUnsignedTx(options: any): object;

/**
 * Return a clone of `pst` with signatures by `signer` added to [Input::final_script_witness].
 *
 * Currently a simplified version of the signing flow from
 * https://github.com/Blockstream/lwk/blob/master/lwk_signer/src/software.rs
 *
 * TODO: Use https://github.com/Blockstream/lwk/blob/master/lwk_signer/src/lib.rs#L40
 * to allow for signing with external wallets.
 */
export function sign(pst: Pst, signer: Keypair): Pst;

/**
 * Extract witness types from SimplicityHL source code.
 */
export function witnessTypes(source: string): object;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_compiler_free: (a: number, b: number) => void;
  readonly __wbg_keypair_free: (a: number, b: number) => void;
  readonly __wbg_program_free: (a: number, b: number) => void;
  readonly __wbg_pst_free: (a: number, b: number) => void;
  readonly compiler: (a: any) => [number, number, number];
  readonly compiler_compile: (a: number, b: any, c: any) => [number, number, number];
  readonly keypair: (a: any) => [number, number, number];
  readonly keypair_publicKey: (a: number) => any;
  readonly keypair_signEcdsa: (a: number, b: any) => any;
  readonly keypair_signSchnorr: (a: number, b: any) => any;
  readonly keypair_xOnlyPublicKey: (a: number) => any;
  readonly paramTypes: (a: any) => [number, number, number];
  readonly program_paramTypes: (a: number) => [number, number, number];
  readonly program_redeemPsbt: (a: number, b: any) => [number, number, number];
  readonly program_redeemSighash: (a: number, b: any) => [number, number, number];
  readonly program_redeemTx: (a: number, b: any) => [number, number, number];
  readonly program_toJSON: (a: number) => any;
  readonly program_witnessTypes: (a: number) => [number, number, number];
  readonly pst: (a: any) => [number, number, number];
  readonly pst_toPset: (a: number) => [number, number, number];
  readonly pst_toSigned: (a: number, b: number) => [number, number, number];
  readonly pst_toTx: (a: number) => [number, number, number];
  readonly sendSigned: (a: number, b: any) => [number, number, number];
  readonly sendUnsigned: (a: any) => [number, number, number];
  readonly sendUnsignedTx: (a: any) => [number, number, number];
  readonly sign: (a: number, b: number) => [number, number, number];
  readonly witnessTypes: (a: any) => [number, number, number];
  readonly rust_0_6_malloc: (a: number) => number;
  readonly rust_0_6_free: (a: number) => void;
  readonly rust_0_6_calloc: (a: number, b: number) => number;
  readonly rustsecp256k1zkp_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
  readonly rustsecp256k1zkp_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
  readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
  readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
  readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
  readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
