/* tslint:disable */
/* eslint-disable */

export class Keypair {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  signSchnorr(message: Uint8Array): Uint8Array;
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
   * Output the hash which must be signed by the witness for the spend to be valid.
   */
  redeemSighash(options: object): string;
  /**
   * Use this in JS to get the properties of the compiled program.
   */
  toJSON(): object;
  /**
   * Generate a transaction to fund the program's P2TR address.
   */
  commitTx(options: object): object;
  /**
   * Generate a transaction to spend funds from the program's P2TR address.
   */
  redeemTx(options: object): object;
  /**
   * Programs stringify to their P2TR addresses.
   */
  toString(): string;
}

/**
 * Create SimplicityHL P2TR address from a [Cmr]
 * (Commitment Merkle root), such as that of a
 * compiled Simplicity program.
 */
export function cmr_to_p2tr(cmr: any, arg1: any): string;

/**
 * Compile a SimplicityHL [Program].
 */
export function compile(source: string, options: object): Program;

/**
 * Create [secp256k1] keypair from 32-byte secret.
 */
export function keypair(secret: Uint8Array): Keypair;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly cmr_to_p2tr: (a: any, b: any) => [number, number, number];
  readonly __wbg_keypair_free: (a: number, b: number) => void;
  readonly __wbg_program_free: (a: number, b: number) => void;
  readonly compile: (a: any, b: any) => [number, number, number];
  readonly keypair: (a: any) => [number, number, number];
  readonly keypair_signSchnorr: (a: number, b: any) => any;
  readonly keypair_xOnlyPublicKey: (a: number) => any;
  readonly program_commitTx: (a: number, b: any) => [number, number, number];
  readonly program_redeemSighash: (a: number, b: any) => [number, number, number, number];
  readonly program_redeemTx: (a: number, b: any) => [number, number, number];
  readonly program_toJSON: (a: number) => any;
  readonly program_toString: (a: number) => [number, number];
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
