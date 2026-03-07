#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run --allow-write=/tmp/fadroma --allow-import=cdn.skypack.dev:443,deno.land:443 --allow-net=127.0.0.1:8941,liquidtestnet.com:443,blockstream.info:443
import { deepStrictEqual as equal, rejects, throws, ok } from 'node:assert';
import { Base16, Fn, Test, Run, sleep } from '../../../library/index.ts';
import { pubECDSA } from 'npm:@scure/btc-signer/utils.js';
import Btc, { BtcRpc, Esplora, LiquidTestnet, ElementsRegtest } from '../../Bitcoin/index.ts';
import { SendFromWallet, AssertBalance } from '../../Bitcoin/test.ts';
import { Signer, Keypair, Program, Wasm, Arg, Args } from './sdk.ts';
const { is, has } = Test;
const { CreateWallet, Rescan } = BtcRpc;
const { INITIAL_COINS, BITCOIN } = ElementsRegtest;
const { sendSigned, keypair } = await Wasm();

const SIGNER = await Signer(new Uint8Array(Array(32).fill(1)));

/** Test the SimplicityHL support in Fadroma. */
export default Test(import.meta, 'SimplicityHL', TestWasm(), TestOnLocalnet(), TestOnTestnet())

// Check that the API entrypoints are present on the WASM module:
export function TestWasm() {
  return Test('WASM', () => Wasm(),
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
      throws(()=>sendSigned(SIGNER.keypair));
      throws(()=>sendSigned(SIGNER.keypair, {}));
    }));
}

export function TestOnTestnet () {
  // Tests that touch Liquid Testnet using Esplora
  return Test('liquidtestnet', () => LiquidTestnet(),
    TestSend(), // Test the basic transaction primitive
    'Programs'  // TODO: Separate fixtures to reuse P2TR source/type defs
  );
}

export function TestOnLocalnet () {
  /** When starting the localnet, the genesis balance is not indexed. */
  const BALANCE_EMPTY = { bitcoin: 0 };
  /** After RPC rescanblockchain, it shoud look like this. */
  const BALANCE_INITIAL = { [ElementsRegtest.ASSETS.REISSUE]: 1, bitcoin: Number(INITIAL_COINS / BITCOIN) };
  // Tests that run on temporary localnet:
  return Test('elementsregtest',
    () => ElementsRegtest({ debugs: true, debugexclude: ['libevent'] }),
    Run.Verbose(true), // Pipe the localnet's output to stderr
    CreateWallet('test-simf', AssertBalance(BALANCE_EMPTY)),
    Rescan(AssertBalance(BALANCE_INITIAL)),
    SendFromWallet("100000", 8), // Fund deployer (non-secret key 8) from genesis wallet
    TestSend(), // Test the basic transaction primitive
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
        provideArgs: () => ({
          PK: Arg.Pubkey(SIGNER.keypair.xOnlyPublicKey())
        }),
        provideWits: (sighash: Uint8Array<ArrayBufferLike>) => ({
          SIG: Arg.Signature(SIGNER.keypair.signSchnorr(sighash)),
        }),
        fee: 2.7e-7, })),
    // Shutdown the localnet.
    // TODO: wrapper ElementsRegtest(async () => { do things }); then autokilled
    () => sleep(1000),
    Run.Kill(9)
  );
}

interface TestSend extends Btc {
  /** Chain-specific asset IDs. */
  ASSETS:      { [key: string]: unknown },
  /** Input transaction. */
  tx:          unknown
  /** To provide funds on testnet. */
  callFaucet?: Fn.Returns<Fn.Async<{ txid: string }>>,
  /** Creates a P2WPKH address configured for the given network. */
  P2WPKH:      Fn<[Uint8Array], { address: string }>,
  /** P2WPKH address that is sending funds. */
  sender:      string
  /** P2WPKH address that is receiving funds. */
  recipient:   string
}

function TestSend (signer1 = null, signer2 = null, amount = 3000n, fee = 12000n) {
  const keypair1 = keypair(new Uint8Array(Array(32).fill(8)));
  const keypair2 = keypair(new Uint8Array(Array(32).fill(9)));
  return Fn.Name('Test sendSigned', testSend);
  async function testSend ({ debug = console.debug, ...context }: TestSend) {
    const { rpc, rest, esplora, callFaucet, tx: inputTx, ASSETS, P2WPKH } = context;
    const sender    = P2WPKH(keypair1.publicKey()).address;
    const recipient = P2WPKH(keypair2.publicKey()).address;
    debug(`Send ${amount} from ${sender} to ${recipient} at ${fee}`);
    const unspent   = await rpc.listunspent(0, 9999999, [sender]); // TODO filter
    const utxo      = unspent[0]; // { asset, txid, vout, value, address }
    debug('Input:', utxo);
    const options   = { sender, recipient, asset: utxo.asset, amount, fee, utxos: [utxo] };
    const signed    = sendSigned(keypair1, options);
    debug('Signed:', signed);
    try {
      const id = await rpc!.sendrawtransaction(signed.hex);
      const tx = await rest!.tx(id);
      await rpc!.rescanblockchain();
    } catch (e) {
      await sleep(1000);
      throw e
    }
  }
}

/** Define example program. */
function TestProgram (name: string, src: string, {
  /** Program runs that should fail. */
  shouldFail  = false as boolean,
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
  return Fn.Name(`${name} (${p2tr||'unspecified P2TR'})`, testProgram, {
    shouldFail, name, src, cost, cmr, p2tr, argTypes, witTypes, provideArgs, provideWits,
  });
  async function testProgram ({ rpc, rest, ID, ASSETS, P2WPKH }: Btc) {
    // Need chain's genesis hash to compile for the chain.
    const genesis = await rpc.getblockhash(0);

    // Parameter values are specified by the test case.
    // It's a function so they can be made context-dependent,
    // but for now they are constant.
    const args = provideArgs ? await provideArgs() : undefined;

    // Ok, compile this program for this chain with these arguments.
    const prog = await Program(src, { chain: ID, genesis, args });

    // Check against expected program address, if provided.
    if (p2tr) equal(prog.p2tr, p2tr);

    // Fund program from deployer:
    // TODO: Use sendSigned
    const id = await rpc.sendtoaddress(p2tr, String(1));

    // Create local spender wallet and import it to RPC:
    const recipient = P2WPKH(SIGNER.pubEcdsa).address;
    await rpc.importaddress(recipient);

    // Note current balance:
    await rpc.rescanblockchain();
    const balance = ((await rpc.getreceivedbyaddress(recipient, 0)) as { bitcoin: number }).bitcoin;

    // Find commit (deploy) output = redeem (spend) input:
    const asset = ASSETS.DEFAULT;
    const prev = await rest.tx(id);
    assertTxOuts(prev, p2tr, 1, cost);
    const txid = prev.txid;
    const vout = prev.vout.filter(x=>x.scriptPubKey.address === p2tr)[0];
    if (!vout) throw new Error('no corresponding vout found');
    const utxos = [{ txid, asset, vout: vout.n, address: vout.scriptPubKey.address, amount: vout.value }];

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

function assertTxOuts (
  tx: { hex: unknown, vout: unknown[] },
  p2tr: string,
  amount: number,
  cost: number,
  remaining?: number,
  debug = console.debug,
) {
  equal(tx.vout.length, 3);
  debug('TX:', tx);
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

    //debug(`UTXOS of sender (${sender}):`, unspent)
    //process.exit(123);
    //// If no input TX is passed, but a faucet is available, use that.
    //if (!inputTx) {
      //// TODO: try using pre-existing UTXO of test account:
      //// const utxos = await esplora.getAddressUtxos(addr);
      //if (callFaucet) {
        //const { txid } = await callFaucet(sender);
        //if (txid === null) throw new Error(`faucet call failed: ${sender}`);
        //await sleep(15000); // give it a few
        //inputTx = await esplora!.getTxInfo(txid);
      //} else {
        //throw new Error(`required: inputTx, callFaucet, or utxo: ${sender}`)
      //}
    //}
    //debug('Previous:', inputTx);
    //// Find the unspent transaction outpu (support both REST and Esplora schemas)
    //const voutIndex = (x: Btc.Vout|Esplora.Vout) => x?.n ?? x?.vout;
    //const enumerate = <T>(x: T, index: number): [number, T] => [index, x];
    //const isOwnedBy = (sender: string) => ([_, x]) => toAddress(x) === sender;
    //const toAddress = (x: Btc.Vout|Esplora.Vout) => x?.scriptPubKey?.address ?? x?.scriptpubkey_address;
    //const [i, vout] = inputTx.vout.map(enumerate).filter(isOwnedBy(sender))[0];
    //if (!vout) throw new Error('no vout matched in previous tx');
