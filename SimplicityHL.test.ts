#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run --allow-write=/tmp/fadroma --allow-import=cdn.skypack.dev:443,deno.land:443 --allow-net=127.0.0.1:8941,liquidtestnet.com:443,blockstream.info:443
import { p2wpkh }   from 'npm:@scure/btc-signer';
import { pubECDSA } from 'npm:@scure/btc-signer/utils.js';
import * as SimplicityHL from './SimplicityHL.ts';
import Bitcoin      from '../Bitcoin/Bitcoin.ts';
import Test         from '../../library/Test.ts';
import Fn           from '../../library/Fn.ts';
import { deepStrictEqual as equal, rejects } from 'node:assert';
const { is: Is, has: Has } = Test;
/** Non-private key. */
const SECRET = new Uint8Array(Array(32).fill(1));
/** WASM-backed Secp256k1 keypair for Schnorr signing. */
const KEYPAIR = await SimplicityHL.Keypair(SECRET);
/** Public key for ECDSA (transactions). */
const PUB_ECDSA = pubECDSA(SECRET);
/** Test the SimplicityHL support in Fadroma. */
export default Test(import.meta, 'SimplicityHL',
  // Check that the API entrypoints are present on the WASM module:
  Test('WASM', () => SimplicityHL.Wasm(),
    Has('tx',              Is('function')),
    Has('pst',             Is('function')),
    Has('keypair',         Is('function')),
    Has('splitPsbt',       Is('function')),
    Has('splitPsbtSigned', Is('function')),
    Has('paramTypes',      Is('function')),
    Has('witnessTypes',    Is('function')),
    Has('compiler',        Is('function'))),
  // Test SimplicityHL on localnet.
  TestSimplicityHL(Bitcoin.ElementsRegtest),
  // TODO: Test SimplicityHL on remote testnet:
  // TestSimplicityHL('liquidtestnet',  Bitcoin.LiquidTestnet),
)
/** Test SimplicityHL programs. */
function TestSimplicityHL (Chain: typeof Bitcoin.ElementsRegtest) {
  // Genesis hash is needed to redeem with witness
  let genesis: string|null = null;
  // Initial balance after rescan
  const initial1 = { [Chain.REISSUE]: 1, bitcoin: Number(Chain.INITIAL_COINS / Bitcoin.DECIMAL) };
  // Compile and deploy example programs:
  return Test(Chain.ID, () => Chain(),

    // FIXME: These steps don't apply on remote testnet,
    // and can just be moved to localnet constructor options.
    Bitcoin.Verbose(false), // Pipe the localnet's output to stderr
    Bitcoin.CreateWallet('test-simf', testHasBalance({ bitcoin: 0 })),
    Bitcoin.Rescan(testHasBalance(initial1)),
    async function fetchGenesisHash (context) {
      genesis = await context.rpc.getblockhash(0);
      return context
    },

    // FIXME: Some of the values won't apply on remote testnet:
    // And now we can test the included example programs:
    // - empty program, always runs
    Example("unit program", 'fn main () {}', {
      fee: 2.4e-7,
      cmr: 'c40a10263f7436b4160acbef1c36fba4be4d95df181a968afeab5eac247adff7',
      p2tr: 'ert1p9jcvyzkdwdqtf49kta4xpc5g35xkfcexwfsl8v70w2gwttelncyspjlnrz',
      paramTypes: {},
      witnessTypes: {},
    }),

    // - correct assertion, always runs
    Example("assert true", 'fn main () { assert!(true) }', {
      fee: 2.7e-7,
      cmr: '633f62f67589423aafcd3ce0a4dc41f6192403c4aeb61997f438dbd7b96c5cf7',
      p2tr: 'ert1per0vg2wvc4ua2rsndm8j6062r7z7ys7q6wcvwumepgz8t5m6hfhsrd8d8q',
      paramTypes: {},
      witnessValues: {},
    }),

    // - incorrect assertion, always fails
    Example("assert false fails", 'fn main () { assert!(false) }', {
      shouldFail:    true,
      fee: 2.7e-7,
      cmr: 'd3c6b9ecfc2876ec72f0099c6f454b7b34645d08c1f220c05ae80e77eed4bdf3',
      p2tr: 'ert1p7p4rgaw5dmhxt6qutf2v3rtuy6afghfgktmmedkpju5uamxdz5js3hdug9',
      paramTypes: {},
      witnessValues: {},
    }),

    // - some jet calls
    Example("basic jets work", `fn main () {
      let ab: u16 = <(u8, u8)>::into((0x10, 0x01));     assert!(jet::eq_16(ab, 0x1001));
      let ab: u8  = <(u4, u4)>::into((0b1011, 0b1101)); assert!(jet::eq_8(ab, 0b10111101));
    }`, {
      fee: 2.7e-7,
      cmr: 'b8b3509f12177723609e3995101ff589e504361ce32ec4d417bba3b37bbb7fac',
      p2tr: 'ert1pmy9edmq0yfrc477jvcc835umyajlgjsnyujplt8nppr45zrwl7qs02gj3x',
      paramTypes: {},
      witnessValues: {},
    }),

    // - witness signing
    Example("pay to pubkey", `fn main () {
      jet::bip_0340_verify((param::PK, jet::sig_all_hash()), witness::SIG)
    }`, {
      fee: 2.7e-7,
      cmr: 'b1b4447ce3082324635798876f1ae6c9aec9a228eb6e21e3cb991f8970986965',
      p2tr: 'ert1ppe00tyu7xnl96056wpth5fhas3hesnehglzstluxn77fe9xx2atsaqwx5h',
      paramTypes: { PK: "u256" },
      witnessTypes: { SIG: "[u8; 64]" },
      provideParams: () => ({ PK: SimplicityHL.Arg.Pubkey(KEYPAIR.xOnlyPublicKey()) }),
      provideWitness: (sighash: Uint8Array<ArrayBufferLike>) => ({
        SIG: SimplicityHL.Arg.Signature(KEYPAIR.signSchnorr(sighash)),
      })
    }),
    
    // Shutdown the localnet.
    (context: Bitcoin) => context.kill(9));

  /** Define example program. */
  function Example (name: string, src: string, {
    shouldFail = false as boolean,
    /** Expected deploy fee. */
    fee            = null as null|number,
    /** Expected commitment Merkle root of program. */
    cmr            = null as null|string,
    /** Expected pay-to-taproot address of program. */
    p2tr           = null as null|string,
    paramTypes     = {} as Record<string, string>,
    witnessTypes   = {} as Record<string, string>,
    /** Function that provides parameter data. */
    provideParams  = null as null|Fn.Returns<Fn.Async<SimplicityHL.Args>>,
    /** Function that provides witness data. */
    provideWitness = null as null|Fn<[Uint8Array<ArrayBufferLike>], Fn.Async<object>>,
  } = {}) {
    const fail = shouldFail;
    const cost = fee;
    return Fn.Name(`${name} (${p2tr||'unspecified P2TR'})`, testExample, {
      shouldFail, name, src, cost, cmr, p2tr, paramTypes, witnessTypes,
      provideParams,
      provideWitness,
    })
    async function testExample (context: Bitcoin) {
      const { rpc, rest } = context;
      // Compile the program.
      const opts = { genesis, chain: Chain.ID, args: provideParams ? await provideParams() : undefined };
      const prog = await SimplicityHL.Program(src, opts);
      // Check against pre-defined CMR/P2TR.
      if (p2tr) equal(prog.p2tr, p2tr);
      // Fund program from deployer
      const id = await rpc.sendtoaddress(p2tr, String(1));
      const previous = testSplitTx(await rest.tx(id), p2tr, 1, cost).hex;
      // Create local spender wallet and import it to RPC:
      const network = { bech32: 'ert', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef, };
      const recipient = p2wpkh(PUB_ECDSA, network).address;
      await rpc.importaddress(recipient);
      // Note current balance:
      await rpc.rescanblockchain();
      const balance = ((await rpc.getreceivedbyaddress(recipient, 0)) as { bitcoin: number }).bitcoin;
      // Try spending from program:
      const fee = 1e-4;
      const amount = 1. - fee;
      const sighash = prog.redeemSighash({ previous, amount, fee, recipient });
      const witness = provideWitness ? await provideWitness(sighash) : {};
      const redeemArgs = { rpc, rest, previous, amount, fee, witness, recipient };
      if (fail) {
        // TX is expected to fail
        rejects(()=>prog.redeem(redeemArgs));
        // Balance is expected to remain the same
        equal(await rpc.getreceivedbyaddress(recipient, 0), { bitcoin: balance });
      } else {
        // TX is expected to pass
        await prog.redeem(redeemArgs);
        // Balance is expected to increase
        equal(await rpc.getreceivedbyaddress(recipient, 0), { bitcoin: balance + amount });
      }
      return context;
    }
  }
}
/** Define test case for expected wallet balance. */
function testHasBalance <T> (balance: T) {
  return Fn.Name(`Balance is ${balance}`, (info: { balance: T }) => equal(info.balance, balance))
}
function testSplitTx (
  tx: { hex: unknown, vout: unknown[] }, p2tr: string, amount: number, cost: number, _remaining?: number
) {
  equal(tx.vout.length, 3);
  const hasVout   = (f: Fn, t: string) => equal(tx.vout.filter(f).length, 1, `post deploy: ${t}`);
  const isBalance = (x: Bitcoin.Vout)=>((x.value===amount) && (x.scriptPubKey.address == p2tr));
  const isFee     = (x: Bitcoin.Vout)=>x.value===cost;
  hasVout(isBalance, `balance: program ${p2tr} must receive ${amount}`);
  hasVout(isFee,     `fee: deploy fee must be ${cost}`);
  //hasVout((x: Bitcoin.Vout)=>x.value===bitcoin, `remaining: must be ${bitcoin}`);
  return tx
}
