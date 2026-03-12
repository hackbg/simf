#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run --allow-write=/tmp/fadroma --allow-import=cdn.skypack.dev:443,deno.land:443 --allow-net=127.0.0.1:8941,liquidtestnet.com:443,blockstream.info:443
import { deepStrictEqual as equal, rejects, throws, ok } from 'node:assert';
import { Base16, Fn, Async, Test, Run, sleep } from '../../../library/index.ts';
import Btc, { Rpc, LiquidTestnet, ElementsRegtest } from '../../Bitcoin/index.ts';
import * as SimplicityHL from './sdk.ts';
const keypair1 = await SimplicityHL.Keypair(new Uint8Array(Array(32).fill(8)));
const keypair2 = await SimplicityHL.Keypair(new Uint8Array(Array(32).fill(9)));
const { is, has } = Test;

/** Test the SimplicityHL support in Fadroma. */
export default Test(import.meta, 'SimplicityHL', TestWasm(), TestOnLocalnet(), TestOnTestnet())

// Check that the API entrypoints are present on the WASM module:
export function TestWasm () {
  return Test('WASM', () => SimplicityHL.Wasm(),
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
      throws(()=>sendSigned(keypair1));
      throws(()=>sendSigned(keypair2, {}));
    }));
}

// Self-explanatory.
export function TestOnLocalnet () {
  // Tests that run on temporary localnet:
  return ElementsRegtest.Test({},
    Rpc.SendFromWallet("1000000", ElementsRegtest.P2WPKH(keypair1.publicKey()).address),
    TestSend(), // Test the basic transaction primitive
    Test('Programs', // Test SimplicityHL commitment and redemption transactions.
      // Empty program, always passes:
      TestProgram("unit program", 'fn main () {}', {
        p2tr: 'ert1p9jcvyzkdwdqtf49kta4xpc5g35xkfcexwfsl8v70w2gwttelncyspjlnrz',
        fee: 2.7e-7
      }),
      // Correct assertion, always passes:
      TestProgram("assert true", 'fn main () { assert!(true) }', {
        p2tr: 'ert1per0vg2wvc4ua2rsndm8j6062r7z7ys7q6wcvwumepgz8t5m6hfhsrd8d8q',
        fee: 2.7e-7
      }),
      // Incorrect assertion, always fails:
      TestProgram("assert false fails", 'fn main () { assert!(false) }', {
        shouldFail: true,
        p2tr: 'ert1p7p4rgaw5dmhxt6qutf2v3rtuy6afghfgktmmedkpju5uamxdz5js3hdug9',
        fee: 2.7e-7
      }),
      // Test basic language features. Guards against general failure of all jets
      // (Symptom of mislinked WASM, see other mentions in README and/or comments.)
      TestProgram("basic jets work", `fn main () {
        let ab: u16 = <(u8, u8)>::into((0x10, 0x01));
        assert!(jet::eq_16(ab, 0x1001));
        let ab: u8  = <(u4, u4)>::into((0b1011, 0b1101));
        assert!(jet::eq_8(ab, 0b10111101));
      }`, {
        p2tr: 'ert1pmy9edmq0yfrc477jvcc835umyajlgjsnyujplt8nppr45zrwl7qs02gj3x',
        fee: 2.7e-7, }),
      // Witness signing:
      TestProgram("pay to pubkey", `fn main () {
        jet::bip_0340_verify((param::PK, jet::sig_all_hash()), witness::SIG)
      }`, {
        p2tr: 'ert1pa69jdawgz5wu5uc8ce2cv7lcqf64kadyl4wsrddparl25erfj2vq9824m9',
        argTypes: { PK: "u256" },
        witTypes: { SIG: "[u8; 64]" },
        provideArgs: () => ({
          PK: SimplicityHL.Arg.Pubkey(keypair1.xOnlyPublicKey())
        }),
        provideWits: (sighash: Uint8Array<ArrayBufferLike>) => ({
          SIG: SimplicityHL.Arg.Signature(keypair1.signSchnorr(sighash)),
        }),
        fee: 2.7e-7, })),
    // Shutdown the localnet.
    // TODO: wrapper ElementsRegtest(async () => { do things }); then autokilled
    () => sleep(1000),
    Run.Kill(9)
  );
}

// Self-explanatory.
export function TestOnTestnet () {
  // Tests that touch Liquid Testnet using Esplora
  return Test('liquidtestnet', () => LiquidTestnet(),
    TestSend(), // Test the basic transaction primitive
    Test('Programs',
      TestProgram("unit program", 'fn main () {}', {
        p2tr: 'tex1p9jcvyzkdwdqtf49kta4xpc5g35xkfcexwfsl8v70w2gwttelncyshxjk56',
        fee: 2.7e-7 })),
  );
}

// Test the spend helper.
function TestSend (amount = 3000n, fee = 12000n) {
  return Fn.Name(`Spend ${amount} for ${fee}`, testSend);
  async function testSend (chain: Btc) {
    const from = chain.P2WPKH(keypair1.publicKey()).address;
    const to   = chain.P2WPKH(keypair2.publicKey()).address;
    const utxo = await chain.getUtxo(from);
    return Object.assign(chain, await SimplicityHL.Spend()
      .asset(utxo.asset)
      .input(utxo, keypair1)
      .output(to, amount)
      .fee(fee).broadcast(chain));
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
  /** Expected compile-time signature of program. */
  argTypes    = {} as Record<string, string>,
  /** Expected runtime signature of program. */
  witTypes    = {} as Record<string, string>,
  /** Function that provides parameter data. */
  provideArgs = null as null|Fn.Returns<Async<SimplicityHL.Args>>,
  /** Function that provides witness data. */
  provideWits = null as null|Fn<[Uint8Array<ArrayBufferLike>], Async<object>>,
} = {}) {

  return Fn.Name(`${name} (${p2tr||'unspecified P2TR'})`, testProgram, {
    shouldFail, name, src, fee, cmr, p2tr, argTypes, witTypes, provideArgs, provideWits,
  });

  // Test the SimplicityHL program specified above on the given chain.
  async function testProgram (chain: Btc) {
    const debug = (chain.debug ?? console.debug) || (()=>{});
    // Compile this program with these arguments for this chain.
    const program = await SimplicityHL.Program(src, {
      // Expected program address, optional. Makes it safer.
      address: p2tr,
      // Represents config such as HRP, prefix bytes...
      // TODO expose
      chain:   chain.ID,
      // Need chain's genesis hash to compile for the chain.
      genesis: await chain.getBlockHash(0),
      // Parameter values are specified by the test case.
      // It's a function so they can be made context-dependent,
      // but for now they are constant.
      args:    provideArgs ? await provideArgs() : undefined,
    });

    // Check against expected program address, if provided.
    if (p2tr) equal(program.p2tr, p2tr);

    // Fund program from deployer:
    const commitSource = Btc.Utxo(await chain.getUtxo(chain.P2WPKH(keypair1.publicKey()).address));
    const commitFee    = Btc.toSat(fee??1e-4);
    const commitAmount = (Btc.toSat(commitSource.amount) / 10n) - commitFee;
    const commitTxid   = await SimplicityHL.Spend() // TODO wrap as program.commit() ?
      .asset(commitSource.asset).input(commitSource, keypair1)
      .output(program.p2tr, commitAmount).fee(commitFee).broadcast(chain);
    debug('Commit TX:', commitTxid);

    // Note current recipient balance:
    const recipient = chain.P2WPKH(keypair1.publicKey()).address;
    const recipientBalance = async (asset = 'bitcoin') =>
      Btc.toSat((await chain.getBalance(recipient, 0))[asset] ?? 0);
    const balance = await recipientBalance();

    // Find commit (deploy) output = redeem (spend) input:
    // This is a tad different across RPC vs Esplora, TODO move to lib too:
    const asset = commitSource.asset;

    // Nasty wait-for-TX loop because of potential race condition between Esplora endpoints
    let prev;
    let retries = 30;
    while (retries > 0) try {
      prev = await chain.getTxInfo(commitTxid);
      break;
    } catch (e) {
      retries--;
      debug(e);
      debug('Waiting for tx', commitTxid);
      await sleep(1000);
    }
    const txid = prev.txid;

    debug('Redeem from:', prev);
    const toSPKA = (x: Btc.Utxo) => x.scriptpubkey_address || x.scriptPubKey?.address;
    let index = null;
    const finder = (x: Btc.Utxo, i: number) => {
      if (toSPKA(x) === p2tr) {
        index = i;
        return true;
      }
    };
    const vout = prev.vout.find(finder);
    if (!vout) throw new Error('no corresponding vout found');
    const redeemSource = Btc.Utxo({ txid, asset, vout: index, address: toSPKA(vout), amount: vout.value });
    debug('Redeem UTXO:', redeemSource);

    // To get SIGHASH_ALL for signing, first the rest of the transaction must be specified:
    const redeemFee    = 1000n;
    const redeemAmount = commitAmount - redeemFee;
    const sighashOpts  = { asset, utxos: [redeemSource], recipient, amount: redeemAmount, fee: redeemFee };
    debug('Redeem opts:', sighashOpts);
    const sighash      = program.redeemSighash(sighashOpts);
    ok(sighash instanceof Uint8Array, 'sighash expected to be returned from WASM as Uint8Array')
    ok(Base16.encode(sighash), 'sighash expected to be base16-encodable');

    // Construct redeem transaction with witnesses:
    const witness = provideWits ? await provideWits(sighash) : {};
    if (shouldFail) {
      // Program runtime failure is caught at redeem TX construction.
      throws(()=>program.redeemTx({ ...sighashOpts, witness }));
      return
    }

    // Spend from program:
    const { hex, ...redeemTx } = program.redeemTx({ ...sighashOpts, witness });
    debug('Redeeming:', redeemTx);
    // TX is expected to pass
    await chain.broadcast(hex);
    // Balance is expected to increase
    equal(await recipientBalance(), balance + redeemAmount);
  }
}

