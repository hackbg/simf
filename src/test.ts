#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run --allow-write=/tmp/fadroma --allow-import=cdn.skypack.dev:443,deno.land:443 --allow-net=127.0.0.1:8941,liquidtestnet.com:443,blockstream.info:443
import { deepStrictEqual as equal, rejects, throws } from 'node:assert';
import * as SimplicityHL from './sdk.ts';
import { pubECDSA } from 'npm:@scure/btc-signer/utils.js';
import { p2wpkh } from 'npm:@scure/btc-signer';
import Bitcoin from '../../Bitcoin/Bitcoin.ts';
import { Base16 } from '../../../library/Number.ts';
import Test from '../../../library/Test.ts';
import Fn from '../../../library/Fn.ts';

const { is: Is, has: Has } = Test;

/** Elementsregtest config. TODO: test on testnet. */
const NETWORK = { bech32: 'ert', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef, };

/** Non-private key. */
const SECRET = new Uint8Array(Array(32).fill(1));

/** WASM-backed Secp256k1 keypair for Schnorr signing. */
const KEYPAIR = await SimplicityHL.Keypair(SECRET);

/** Public key for ECDSA (transactions). */
const PUB_ECDSA = pubECDSA(SECRET);

/** Test the SimplicityHL support in Fadroma. */
export default Test(import.meta, 'SimplicityHL',

  // Test SimplicityHL on localnet. TODO: test on Liquid Testnet
  TestSimplicityHL(Bitcoin.ElementsRegtest),

  // Check that the API entrypoints are present on the WASM module:
  Test('WASM', () => SimplicityHL.Wasm(),
    Has('paramTypes',       Is('function')),
    Has('witnessTypes',     Is('function')),
    Has('compiler',         Is('function')),
    Has('keypair',          Is('function')),
    Has('pst',              Is('function')),
    Has('split',            Is('function')),
    Has('splitSigned',      Is('function'), TestSplitSigned()),
    Has('splitMulti',       Is('function')),
    Has('splitMultiSigned', Is('function'))),

)

function TestSplitSigned ({
  secret1   = new Uint8Array(Array(32).fill(8)),
  pubkey1   = pubECDSA(secret1),
  sender    = p2wpkh(pubkey1, NETWORK).address,
  secret2   = new Uint8Array(Array(32).fill(9)),
  pubkey2   = pubECDSA(secret2),
  recipient = p2wpkh(pubkey2, NETWORK).address,
  amount    = '10000',
  fee       = '5760',
} = {}) {
  throws(()=>splitSigned());
  throws(()=>splitSigned({}));
  throws(()=>splitSigned(KEYPAIR));
  throws(()=>splitSigned(KEYPAIR, {}));
  return Fn.Name('Test splitSigned', async (splitSigned: Fn) => {
    let btc;
    try {
      btc = await Bitcoin.ElementsRegtest()
      const { rpc, rest } = btc;
      await rpc.createwallet(name);
      await rpc.rescanblockchain();
      // Fund sender from node's wallet
      const id = await rpc.sendtoaddress(sender, String(100000));
      await rpc.importaddress(sender);
      await rpc.rescanblockchain();
      // Fund recipient directly from sender.
      const tx = await rest.tx(id);
      const previous = tx.hex;
      const options = { previous, sender, recipient, amount: '10000', fee: '5760' };
      const signer = await SimplicityHL.Keypair(secret1);
      const hex = splitSigned(signer, options);
      const id2 = await rpc.sendrawtransaction(hex);
      const tx2 = await rest.tx(id2);
      await rpc.rescanblockchain();
    } finally {
      btc.kill();
    }
  })
  process.exit(123);
}

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
    Bitcoin.Verbose(true), // Pipe the localnet's output to stderr
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

      // Check against expected program address.
      // (Only possible for programs  without params.)
      if (p2tr) equal(prog.p2tr, p2tr);

      // Fund program from deployer
      const id = await rpc.sendtoaddress(p2tr, String(1));
      const previous = testSplitTx(await rest.tx(id), p2tr, 1, cost);

      // Create local spender wallet and import it to RPC:
      const recipient = p2wpkh(PUB_ECDSA, NETWORK).address;
      await rpc.importaddress(recipient);

      // Note current balance:
      await rpc.rescanblockchain();
      const balance = ((await rpc.getreceivedbyaddress(recipient, 0)) as { bitcoin: number }).bitcoin;

      const fee         = 1e-4;
      const amount      = 1. - fee;

      // Try the new code path:
      const asset = Bitcoin.ElementsRegtest.BITCOIN;
      const txid  = previous.txid;
      const vout  = previous.vout.filter(x=>x.scriptPubKey.address === p2tr)[0];
      if (!vout) throw new Error('no corresponding vout found');
      const utxos = [{ txid, vout: vout.n, recipient: vout.scriptPubKey.address, asset, value: vout.value }];
      const sighashMultiOpts = { asset, utxos, recipient, amount, fee };
      const sighashMulti = Base16.encode(prog.redeemSighashMulti(sighashMultiOpts));

      // Try spending from program:
      const sighashOpts = { previous: previous.hex, amount, fee, recipient };
      const sighash     = prog.redeemSighash(sighashOpts);
      equal(Base16.encode(sighash), sighashMulti, 'discrepancy in sighash code paths');

      const witness     = provideWitness ? await provideWitness(sighash) : {};
      const redeemArgs  = { rpc, rest, ...sighashOpts, witness };

      if (shouldFail) {
        // TX is expected to fail
        rejects(()=>prog.rpcRedeem(redeemArgs));
        // Balance is expected to remain the same
        equal(await rpc.getreceivedbyaddress(recipient, 0), { bitcoin: balance });
      } else {
        // TX is expected to pass
        await prog.rpcRedeem(redeemArgs);
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
  tx: { hex: unknown, vout: unknown[] }, p2tr: string, amount: number, cost: number, remaining?: number
) {
  equal(tx.vout.length, 3);
  const hasVout   = (f: Fn, t: ()=>string) => equal(tx.vout.filter(f).length, 1, `post deploy: ${t(tx.vout.filter(f)[0])}`);
  const isBalance = (x: Bitcoin.Vout)=>((x.value===amount) && (x.scriptPubKey.address == p2tr));
  const isFee     = (x: Bitcoin.Vout)=>x.value===cost;
  hasVout(isBalance, v => `balance: program ${p2tr} must receive ${amount}, not ${v}`);
  hasVout(isFee,     v => `fee: deploy fee must be ${cost}, not ${v}`);
  //hasVout((x: Bitcoin.Vout)=>x.value===remaining, v => `remaining: must be ${v}`);
  return tx
}
