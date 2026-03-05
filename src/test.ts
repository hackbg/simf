#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run --allow-write=/tmp/fadroma --allow-import=cdn.skypack.dev:443,deno.land:443 --allow-net=127.0.0.1:8941,liquidtestnet.com:443,blockstream.info:443
import { deepStrictEqual as equal, rejects, throws, ok } from 'node:assert';
import { Base16, Fn, Test, Run } from '../../../library/index.ts';
import { pubECDSA } from 'npm:@scure/btc-signer/utils.js';
import { p2wpkh } from 'npm:@scure/btc-signer';
import Bitcoin from '../../Bitcoin/Bitcoin.ts';
import * as SimplicityHL from './sdk.ts';
const { is, has } = Test;
const { DECIMAL, ElementsRegtest } = Bitcoin;
const { INITIAL_COINS, REISSUE } = ElementsRegtest;
/** ElementsRegtest config. */
const NETWORK   = { bech32: 'ert', pubKeyhash: 0x6f, scripthash: 0xc4, wif: 0xef, };
/** Non-private key. */
const SECRET    = new Uint8Array(Array(32).fill(1));
/** WASM-backed Secp256k1 keypair for Schnorr signing. */
const KEYPAIR   = await SimplicityHL.Keypair(SECRET);
/** Public key for ECDSA (transactions). */
const PUB_ECDSA = pubECDSA(SECRET);
/** Test the SimplicityHL support in Fadroma. */
export default Test(import.meta, 'SimplicityHL',
  // Check that the API entrypoints are present on the WASM module:
  Test('WASM', () => SimplicityHL.Wasm(),
    has('paramTypes',   is('function')),
    has('witnessTypes', is('function')),
    has('compiler',     is('function')),
    has('keypair',      is('function')),
    has('pst',          is('function')),
    has('sendSigned',   is('function')),
    has('sendInspect',  is('function'))),
  // Tests on temporary localnet
  Test('elementsregtest', () => Bitcoin.ElementsRegtest(),
    Run.Verbose(true), // Pipe the localnet's output to stderr
    Bitcoin.CreateWallet('test-simf', hasBalance({ bitcoin: 0 })),
    Bitcoin.Rescan(hasBalance({ [REISSUE]: 1, bitcoin: Number(INITIAL_COINS / DECIMAL) })),
    await TestSend(), // Test the basic transaction primitive (WASM init here is async)
    Test('Programs', // Test SimplicityHL commitment and redemption transactions.

      // Empty program, always passes:
      Example("unit program", 'fn main () {}', {
        p2tr: 'ert1p9jcvyzkdwdqtf49kta4xpc5g35xkfcexwfsl8v70w2gwttelncyspjlnrz',
        cmr: 'c40a10263f7436b4160acbef1c36fba4be4d95df181a968afeab5eac247adff7',
        fee: 2.7e-7 }),

      // Correct assertion, always passes:
      Example("assert true", 'fn main () { assert!(true) }', {
        p2tr: 'ert1per0vg2wvc4ua2rsndm8j6062r7z7ys7q6wcvwumepgz8t5m6hfhsrd8d8q',
        cmr: '633f62f67589423aafcd3ce0a4dc41f6192403c4aeb61997f438dbd7b96c5cf7',
        fee: 2.7e-7 }),

      // Incorrect assertion, always fails:
      Example("assert false fails", 'fn main () { assert!(false) }', {
        p2tr: 'ert1p7p4rgaw5dmhxt6qutf2v3rtuy6afghfgktmmedkpju5uamxdz5js3hdug9',
        cmr: 'd3c6b9ecfc2876ec72f0099c6f454b7b34645d08c1f220c05ae80e77eed4bdf3',
        shouldFail: true,
        fee: 2.7e-7 }),

      // Test basic language features. Guards against general failure of all jets
      // (Symptom of mislinked WASM, see other mentions in README and/or comments.)
      Example("basic jets work", `fn main () {
        let ab: u16 = <(u8, u8)>::into((0x10, 0x01));
        assert!(jet::eq_16(ab, 0x1001));
        let ab: u8  = <(u4, u4)>::into((0b1011, 0b1101));
        assert!(jet::eq_8(ab, 0b10111101));
      }`, {
        p2tr: 'ert1pmy9edmq0yfrc477jvcc835umyajlgjsnyujplt8nppr45zrwl7qs02gj3x',
        cmr: 'b8b3509f12177723609e3995101ff589e504361ce32ec4d417bba3b37bbb7fac',
        fee: 2.7e-7, }),

      // Witness signing:
      Example("pay to pubkey", `fn main () {
        jet::bip_0340_verify((param::PK, jet::sig_all_hash()), witness::SIG)
      }`, {
        p2tr: 'ert1ppe00tyu7xnl96056wpth5fhas3hesnehglzstluxn77fe9xx2atsaqwx5h',
        cmr: 'b1b4447ce3082324635798876f1ae6c9aec9a228eb6e21e3cb991f8970986965',
        fee: 2.7e-7,

        paramTypes:     { PK: "u256" },
        provideParams:  () => ({ PK: SimplicityHL.Arg.Pubkey(KEYPAIR.xOnlyPublicKey()) }),

        witnessTypes:   { SIG: "[u8; 64]" },
        provideWitness: (sighash: Uint8Array<ArrayBufferLike>) => ({
          SIG: SimplicityHL.Arg.Signature(KEYPAIR.signSchnorr(sighash)), }) })),

    // Shutdown the localnet.
    // TODO: ElementsRegtest(async () => { do things }); then autokilled
    Run.Kill(9)));

async function TestSend ({
  secret1   = new Uint8Array(Array(32).fill(8)),
  pubkey1   = pubECDSA(secret1),
  sender    = p2wpkh(pubkey1, NETWORK).address,
  secret2   = new Uint8Array(Array(32).fill(9)),
  pubkey2   = pubECDSA(secret2),
  recipient = p2wpkh(pubkey2, NETWORK).address,
  amount    = '10000',
  fee       = '5760',
} = {}) {
  const { sendSigned } = await SimplicityHL.Wasm();
  throws(()=>sendSigned());
  throws(()=>sendSigned({}));
  throws(()=>sendSigned(KEYPAIR));
  throws(()=>sendSigned(KEYPAIR, {}));
  return Fn.Name('Test sendSigned', async ({ rpc, rest }: Bitcoin) => {
    // Init localnet
    //await rpc.createwallet(name);
    //await rpc.rescanblockchain();

    // TX1: Fund new sender from genesis wallet
    const id = await rpc.sendtoaddress(sender, String(100000));
    await rpc.importaddress(sender);
    await rpc.rescanblockchain();

    // Find the unspend transaction output
    const previous = await rest.tx(id);
    const asset = () => `${ElementsRegtest.BITCOIN}`;
    const txid = previous.txid;
    const vout = previous.vout.filter(x=>x.scriptPubKey.address === sender)[0];
    if (!vout) throw new Error('no corresponding vout found');

    // TX2: Fund recipient from sender.
    const utxos = () => [{ txid, asset: asset(), vout: vout.n, recipient: vout.scriptPubKey.address, value: vout.value }]
    const opts = () => ({ sender, recipient, asset: asset(), amount, fee, utxos: utxos(), })
    console.debug(opts());
    const key = await SimplicityHL.Keypair(secret1);
    const signedSendTx = sendSigned(key, opts());
    console.debug({ signedSendTx });
    const id2 = await rpc.sendrawtransaction(signedSendTx.signedHex);
    const tx2 = await rest.tx(id2);
    await rpc.rescanblockchain();
  })
}

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
  async function testExample ({ rpc, rest }: Bitcoin) {
    // Compile the program.
    const genesis = await rpc.getblockhash(0);
    const opts = { genesis, chain: ElementsRegtest.ID, args: provideParams ? await provideParams() : undefined };
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

    // Generate sighash by new code path:
    const asset = ElementsRegtest.BITCOIN;
    const txid  = previous.txid;
    const vout  = previous.vout.filter(x=>x.scriptPubKey.address === p2tr)[0];
    if (!vout) throw new Error('no corresponding vout found');
    const utxos = [{ txid, asset, vout: vout.n, recipient: vout.scriptPubKey.address, value: vout.value }];
    const sighashOpts = { asset, utxos, recipient, amount, fee };
    const sighash = prog.redeemSighash(sighashOpts);
    ok(sighash instanceof Uint8Array, 'sighash expected to be returned from WASM as Uint8Array')
    ok(Base16.encode(sighash), 'sighash expected to be base16-encodable');

    // Try spending from program:
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
  }
}

/** Define test case for expected wallet balance. */
function hasBalance <T> (balance: T) {
  return Fn.Name(`Wallet balance ${balance}`, (info: { balance: T }) => equal(info.balance, balance))
}

function testSplitTx (
  tx: { hex: unknown, vout: unknown[] }, p2tr: string, amount: number, cost: number, remaining?: number
) {
  equal(tx.vout.length, 3);
  console.log({tx});
  hasVout(isBalance, _ => `balance: program ${p2tr} must receive ${amount}`);
  hasVout(isFee,     _ => `fee: no deploy fee matching ${cost}`);
  //hasVout((x: Bitcoin.Vout)=>x.value===remaining, v => `remaining: must be ${v}`);
  return tx
  function hasVout (f: Fn, msg: (v)=>string) {
     if (tx.vout.filter(f).length !== 1) throw new Error(`post deploy: ${msg(tx.vout)}`);
  }
  function isBalance (x: Bitcoin.Vout) {
    return ((x.value===amount) && (x.scriptPubKey.address == p2tr));
  }
  function isFee (x: Bitcoin.Vout) {
    return x.value === cost;
  }
}
