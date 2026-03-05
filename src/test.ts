#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run --allow-write=/tmp/fadroma --allow-import=cdn.skypack.dev:443,deno.land:443 --allow-net=127.0.0.1:8941,liquidtestnet.com:443,blockstream.info:443
import { deepStrictEqual as equal, rejects, throws, ok } from 'node:assert';
import { Base16, Fn, Test, Run, sleep } from '../../../library/index.ts';
import { pubECDSA } from 'npm:@scure/btc-signer/utils.js';
import { p2wpkh } from 'npm:@scure/btc-signer';
import Btc, { BtcRpc, Esplora, LiquidTestnet, ElementsRegtest, BITCOIN } from '../../Bitcoin/Bitcoin.ts';
import * as BtcTest from '../../Bitcoin/Bitcoin.test.ts';
import { Keypair, Program, Wasm, Arg, Args } from './sdk.ts';
const { is, has } = Test;
const { INITIAL_COINS } = ElementsRegtest;
/** Non-private key. */
const SECRET = new Uint8Array(Array(32).fill(1));
/** WASM-backed Secp256k1 keypair for Schnorr signing. */
const KEYPAIR = await Keypair(SECRET);
/** Public key for ECDSA (transactions). */
const PUB_ECDSA = pubECDSA(SECRET);
/** When starting the localnet, the genesis balance is not indexed. */
const BALANCE_EMPTY = { bitcoin: 0 };
/** After RPC rescanblockchain, it shoud look like this. */
const BALANCE_INITIAL = { [ElementsRegtest.ASSETS.REISSUE]: 1, bitcoin: Number(INITIAL_COINS / BITCOIN) };
/** Test the SimplicityHL support in Fadroma. */
export default Test(import.meta, 'SimplicityHL',

  // Check that the API entrypoints are present on the WASM module:
  Test('WASM', () => Wasm(),
    has('paramTypes',     is('function')),
    has('witnessTypes',   is('function')),
    has('compiler',       is('function')),
    has('keypair',        is('function')),
    has('pst',            is('function')),
    has('sendUnsignedTx', is('function')),
    has('sendUnsigned',   is('function')),
    has('sendSigned',     is('function'), (sendSigned: Fn) => {
      throws(()=>sendSigned());
      throws(()=>sendSigned({}));
      throws(()=>sendSigned(KEYPAIR));
      throws(()=>sendSigned(KEYPAIR, {}));
    })),

  // Tests that run on temporary localnet:
  Test('elementsregtest', () => ElementsRegtest(),
    Run.Verbose(true), // Pipe the localnet's output to stderr
    BtcRpc.CreateWallet('test-simf', BtcTest.AssertBalance(BALANCE_EMPTY)),
    BtcRpc.Rescan(BtcTest.AssertBalance(BALANCE_INITIAL)),
    BtcTest.Send("100000", 8), // Fund deployer (non-secret key 8) from genesis wallet
    await TestSend(), // Test the basic transaction primitive (WASM init here is async)
    Test('Programs', // Test SimplicityHL commitment and redemption transactions.

      // Empty program, always passes:
      TestProgram("unit program", 'fn main () {}', {
        p2tr: 'ert1p9jcvyzkdwdqtf49kta4xpc5g35xkfcexwfsl8v70w2gwttelncyspjlnrz',
        cmr: 'c40a10263f7436b4160acbef1c36fba4be4d95df181a968afeab5eac247adff7',
        fee: 2.7e-7 }),

      // Correct assertion, always passes:
      TestProgram("assert true", 'fn main () { assert!(true) }', {
        p2tr: 'ert1per0vg2wvc4ua2rsndm8j6062r7z7ys7q6wcvwumepgz8t5m6hfhsrd8d8q',
        cmr: '633f62f67589423aafcd3ce0a4dc41f6192403c4aeb61997f438dbd7b96c5cf7',
        fee: 2.7e-7 }),

      // Incorrect assertion, always fails:
      TestProgram("assert false fails", 'fn main () { assert!(false) }', {
        shouldFail: true,
        p2tr: 'ert1p7p4rgaw5dmhxt6qutf2v3rtuy6afghfgktmmedkpju5uamxdz5js3hdug9',
        cmr: 'd3c6b9ecfc2876ec72f0099c6f454b7b34645d08c1f220c05ae80e77eed4bdf3',
        fee: 2.7e-7 }),

      // Test basic language features. Guards against general failure of all jets
      // (Symptom of mislinked WASM, see other mentions in README and/or comments.)
      TestProgram("basic jets work", `fn main () {
        let ab: u16 = <(u8, u8)>::into((0x10, 0x01));
        assert!(jet::eq_16(ab, 0x1001));
        let ab: u8  = <(u4, u4)>::into((0b1011, 0b1101));
        assert!(jet::eq_8(ab, 0b10111101));
      }`, {
        p2tr: 'ert1pmy9edmq0yfrc477jvcc835umyajlgjsnyujplt8nppr45zrwl7qs02gj3x',
        cmr: 'b8b3509f12177723609e3995101ff589e504361ce32ec4d417bba3b37bbb7fac',
        fee: 2.7e-7, }),

      // Witness signing:
      TestProgram("pay to pubkey", `fn main () {
        jet::bip_0340_verify((param::PK, jet::sig_all_hash()), witness::SIG)
      }`, {
        p2tr: 'ert1ppe00tyu7xnl96056wpth5fhas3hesnehglzstluxn77fe9xx2atsaqwx5h',
        cmr: 'b1b4447ce3082324635798876f1ae6c9aec9a228eb6e21e3cb991f8970986965',
        argTypes: { PK: "u256" },
        witTypes: { SIG: "[u8; 64]" },
        provideArgs: () => ({ PK: Arg.Pubkey(KEYPAIR.xOnlyPublicKey()) }),
        provideWits: (sighash: Uint8Array<ArrayBufferLike>) => ({
          SIG: Arg.Signature(KEYPAIR.signSchnorr(sighash)),
        }),
        fee: 2.7e-7, })),

    // Shutdown the localnet.
    // TODO: wrapper ElementsRegtest(async () => { do things }); then autokilled
    Run.Kill(9)),

  // Tests that touch Liquid Testnet using Esplora
  Test('liquidtestnet', () => LiquidTestnet(),
    await TestSend()));

function testTransactionOutputs (
  tx: { hex: unknown, vout: unknown[] }, p2tr: string, amount: number, cost: number, remaining?: number
) {
  equal(tx.vout.length, 3);
  console.log({tx});
  hasVout(isBalance, _ => `balance: program ${p2tr} must receive ${amount}`);
  hasVout(isFee,     _ => `fee: no deploy fee matching ${cost}`);
  //hasVout((x: Btc.Vout)=>x.value===remaining, v => `remaining: must be ${v}`);
  return tx
  function hasVout (f: Fn, msg: (v)=>string) {
     if (tx.vout.filter(f).length !== 1) throw new Error(`post deploy: ${msg(tx.vout)}`);
  }
  function isBalance (x: Btc.Vout) {
    return ((x.value===amount) && (x.scriptPubKey.address == p2tr));
  }
  function isFee (x: Btc.Vout) {
    return x.value === cost;
  }
}

async function TestSend ({
  secret1 = new Uint8Array(Array(32).fill(8)), pubkey1 = pubECDSA(secret1),
  secret2 = new Uint8Array(Array(32).fill(9)), pubkey2 = pubECDSA(secret2),
  amount = '3000', fee = '12000',
} = {}) {
  const { sendSigned, keypair } = await Wasm();
  return Fn.Name('Test sendSigned', async ({
    debug = console.debug,
    rpc,
    rest,
    esplora,
    callFaucet,
    tx: inputTx,
    identity,
    ASSETS,
    NETWORK,
    P2WPKH,
    sender    = P2WPKH(pubkey1, NETWORK).address,
    recipient = P2WPKH(pubkey2, NETWORK).address,
  }: Btc) => {
    // If no input TX is passed, but a faucet is available, use that.
    if (!inputTx) {
      // TODO: try with pre-existing balance:
      // const utxos = await esplora.getAddressUtxos(addr);
      if (callFaucet) {
        const { txid } = await callFaucet(sender);
        if (txid === null) throw new Error(`faucet call failed: ${sender}`);
        await sleep(15000); // give it a few
        inputTx = await esplora.getTxInfo(txid);
      } else {
        throw new Error(`required: inputTx, callFaucet, or utxo: ${sender}`)
      }
    }
    // Support both REST and Esplora API formats.
    const spka = (x: Btc.Vout|Esplora.Vout) => x?.scriptPubKey?.address ?? x?.scriptpubkey_address;
    const voutIndex = (x: Btc.Vout|Esplora.Vout) => x?.n ?? x?.vout;
    // Find the unspent transaction output
    const enumerate = <T>(x: T, index: number): [number, T] => [index, x];
    const isOwnedBySender = (x: Btc.Vout|Esplora.Vout) => spka(x) === sender;
    const [index, vout] = inputTx.vout.map(enumerate).filter(([_, x])=>isOwnedBySender(x))[0];
    if (!vout) throw new Error('no vout matched in previous tx');
    console.log({vout});
    // TX2: Fund recipient from sender.
    const asset = ASSETS.DEFAULT;
    const utxos = [{asset, txid: inputTx.txid, vout: index, value: vout.value, recipient: spka(vout),}]
    const signed = sendSigned(keypair(secret1), { sender, recipient, asset, amount, fee, utxos, });
    console.debug({ signed });
    const id = await rpc.sendrawtransaction(signed.signedHex);
    const tx = await rest.tx(id);
    await rpc.rescanblockchain();
  })
}

/** Define example program. */
function TestProgram (name: string, src: string, {
  shouldFail = false as boolean,
  /** Expected deploy fee. */
  fee         = null as null|number,
  /** Expected commitment Merkle root of program. */
  cmr         = null as null|string,
  /** Expected pay-to-taproot address of program. */
  p2tr        = null as null|string,
  argTypes    = {} as Record<string, string>,
  witTypes    = {} as Record<string, string>,
  /** Function that provides parameter data. */
  provideArgs = null as null|Fn.Returns<Fn.Async<Args>>,
  /** Function that provides witness data. */
  provideWits = null as null|Fn<[Uint8Array<ArrayBufferLike>], Fn.Async<object>>,
} = {}) {
  const cost = fee;
  return Fn.Name(`${name} (${p2tr||'unspecified P2TR'})`, testExample, {
    shouldFail, name, src, cost, cmr, p2tr, argTypes, witTypes, provideArgs, provideWits,
  });
  async function testExample ({ rpc, rest, ID, ASSETS, P2WPKH }: Btc) {
    // Compile the program.
    const genesis = await rpc.getblockhash(0);
    const opts = { genesis, chain: ID, args: provideArgs ? await provideArgs() : undefined };
    const prog = await Program(src, opts);
    // Check against expected program address.
    // (Only possible for programs  without params.)
    if (p2tr) equal(prog.p2tr, p2tr);
    // Fund program from deployer:
    const id = await rpc.sendtoaddress(p2tr, String(1));
    // Create local spender wallet and import it to RPC:
    const recipient = P2WPKH(PUB_ECDSA).address;
    await rpc.importaddress(recipient);
    // Note current balance:
    await rpc.rescanblockchain();
    const balance = ((await rpc.getreceivedbyaddress(recipient, 0)) as { bitcoin: number }).bitcoin;
    // Find commit (deploy) output = redeem (spend) input:
    const asset = ASSETS.DEFAULT;
    const prev = testTransactionOutputs(await rest.tx(id), p2tr, 1, cost);
    const txid = prev.txid;
    const vout = prev.vout.filter(x=>x.scriptPubKey.address === p2tr)[0];
    if (!vout) throw new Error('no corresponding vout found');
    const utxos = [{ txid, asset, vout: vout.n, recipient: vout.scriptPubKey.address, value: vout.value }];
    // To get SIGHASH_ALL for signing, first the rest of the transaction must be specified:
    const redeemFee    = 1e-4;
    const redeemAmount = 1. - redeemFee;
    const sighashOpts  = { asset, utxos, recipient, amount: redeemAmount, fee: redeemFee };
    const sighash      = prog.redeemSighash(sighashOpts);
    ok(sighash instanceof Uint8Array, 'sighash expected to be returned from WASM as Uint8Array')
    ok(Base16.encode(sighash), 'sighash expected to be base16-encodable');
    // Try spending from program:
    const redeemArgs = { rpc, rest, ...sighashOpts, witness: provideWits ? await provideWits(sighash) : {} };
    if (shouldFail) {
      // TX is expected to fail
      rejects(()=>prog.rpcRedeem(redeemArgs));
      // Balance is expected to remain the same
      equal(await rpc.getreceivedbyaddress(recipient, 0), { bitcoin: balance });
    } else {
      // TX is expected to pass
      await prog.rpcRedeem(redeemArgs);
      // Balance is expected to increase
      equal(await rpc.getreceivedbyaddress(recipient, 0), { bitcoin: balance + redeemAmount });
    }
  }
}
