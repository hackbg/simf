#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run --allow-write=/tmp/fadroma --allow-import=cdn.skypack.dev:443,deno.land:443 --allow-net=127.0.0.1:8941,liquidtestnet.com:443,blockstream.info:443
import { deepStrictEqual as equal, rejects, throws, ok } from 'node:assert';
import { Base16, Fn, Async, Test, Run, sleep } from '../../../library/index.ts';
import Btc, { Rpc, LiquidTestnet, ElementsRegtest } from '../../Bitcoin/index.ts';
import * as SimplicityHL from './sdk.ts';
const ALICE = await SimplicityHL.Keypair(new Uint8Array(Array(32).fill(8)));
const BOB   = await SimplicityHL.Keypair(new Uint8Array(Array(32).fill(9)));
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
      throws(()=>sendSigned(ALICE));
      throws(()=>sendSigned(BOB, {}));
    }));
}

// Self-explanatory.
export function TestOnLocalnet () {
  // Tests that run on temporary localnet:
  return ElementsRegtest.Test({},
    Rpc.SendFromWallet("1000000", ElementsRegtest.P2WPKH(ALICE.publicKey()).address),
    TestSend(), // Test the basic transaction primitive
    Test('Programs', // Test SimplicityHL commitment and redemption transactions.
      // Empty program, always passes:
      TestProgram("unit program", 'fn main () {}', {
        address: 'ert1p9jcvyzkdwdqtf49kta4xpc5g35xkfcexwfsl8v70w2gwttelncyspjlnrz',
        commitFee: 27n
      }),
      // Correct assertion, always passes:
      TestProgram("assert true", 'fn main () { assert!(true) }', {
        address: 'ert1per0vg2wvc4ua2rsndm8j6062r7z7ys7q6wcvwumepgz8t5m6hfhsrd8d8q',
        commitFee: 27n
      }),
      // Incorrect assertion, always fails:
      TestProgram("assert false fails", 'fn main () { assert!(false) }', {
        shouldFail: true,
        address: 'ert1p7p4rgaw5dmhxt6qutf2v3rtuy6afghfgktmmedkpju5uamxdz5js3hdug9',
        commitFee: 27n
      }),
      // Test basic language features. Guards against general failure of all jets
      // (Symptom of mislinked WASM, see other mentions in README and/or comments.)
      TestProgram("basic jets work", `fn main () {
        let ab: u16 = <(u8, u8)>::into((0x10, 0x01));
        assert!(jet::eq_16(ab, 0x1001));
        let ab: u8  = <(u4, u4)>::into((0b1011, 0b1101));
        assert!(jet::eq_8(ab, 0b10111101));
      }`, {
        address: 'ert1pmy9edmq0yfrc477jvcc835umyajlgjsnyujplt8nppr45zrwl7qs02gj3x',
        commitFee: 27n, }),
      // Witness signing:
      TestProgram("pay to pubkey", `fn main () {
        jet::bip_0340_verify((param::PK, jet::sig_all_hash()), witness::SIG)
      }`, {
        address: 'ert1pa69jdawgz5wu5uc8ce2cv7lcqf64kadyl4wsrddparl25erfj2vq9824m9',
        argTypes: { PK: "u256" },
        witTypes: { SIG: "[u8; 64]" },
        provideArgs: () => ({
          PK: SimplicityHL.Arg.Pubkey(ALICE.xOnlyPublicKey())
        }),
        provideWits: (sighash: Uint8Array<ArrayBufferLike>) => ({
          SIG: SimplicityHL.Arg.Signature(ALICE.signSchnorr(sighash)),
        }),
        commitFee: 27n, })),
  );
}

// Self-explanatory.
export function TestOnTestnet () {
  // Tests that touch Liquid Testnet using Esplora
  return Test('liquidtestnet', () => LiquidTestnet(),
    TestSend(), // Test the basic transaction primitive
    Test('Programs',
      TestProgram("unit program", 'fn main () {}', {
        address: 'tex1p9jcvyzkdwdqtf49kta4xpc5g35xkfcexwfsl8v70w2gwttelncyshxjk56',
        commitFee: 27n }),
      TestProgram("assert true", 'fn main () { assert!(true) }', {
        address: 'tex1per0vg2wvc4ua2rsndm8j6062r7z7ys7q6wcvwumepgz8t5m6hfhs4e2gsc',
        commitFee: 27n }),
      TestProgram("assert false fails", 'fn main () { assert!(false) }', {
        shouldFail: true,
        address: 'tex1p7p4rgaw5dmhxt6qutf2v3rtuy6afghfgktmmedkpju5uamxdz5js8rqela',
        commitFee: 27n }),
      TestProgram("basic jets work", `fn main () {
        let ab: u16 = <(u8, u8)>::into((0x10, 0x01));
        assert!(jet::eq_16(ab, 0x1001));
        let ab: u8  = <(u4, u4)>::into((0b1011, 0b1101));
        assert!(jet::eq_8(ab, 0b10111101));
      }`, {
        address: 'tex1pmy9edmq0yfrc477jvcc835umyajlgjsnyujplt8nppr45zrwl7qse79hx7',
        commitFee: 27n, }),
      TestProgram("pay to pubkey", `fn main () {
        jet::bip_0340_verify((param::PK, jet::sig_all_hash()), witness::SIG)
      }`, {
        address: 'tex1pa69jdawgz5wu5uc8ce2cv7lcqf64kadyl4wsrddparl25erfj2vqnn8sva',
        argTypes: { PK: "u256" },
        witTypes: { SIG: "[u8; 64]" },
        provideArgs: () => ({
          PK: SimplicityHL.Arg.Pubkey(ALICE.xOnlyPublicKey())
        }),
        provideWits: (sighash: Uint8Array<ArrayBufferLike>) => ({
          SIG: SimplicityHL.Arg.Signature(ALICE.signSchnorr(sighash)),
        }),
        commitFee: 27n, })));
}

// Test the spend helper.
function TestSend (amount = 1000n, fee = 1000n) {
  return Fn.Name(`Spend ${amount} for ${fee}`, testSend);
  async function testSend (chain: Btc) {
    const debug = (chain.debug ?? console.debug) || (()=>{});
    const from = chain.P2WPKH(ALICE.publicKey()).address;
    const to   = chain.P2WPKH(BOB.publicKey()).address;
    const utxo = await chain.getUtxo(from);
    const sent = await SimplicityHL.Spend().asset(utxo.asset)
      .input(utxo, ALICE).output(to, amount).fee(fee).broadcast(chain);
    debug({sent});
    await chain.waitForTx(sent);
  }
}

/** Define example program. */
function TestProgram (name: string, src: string, {
  /** Program runs that should fail. */
  shouldFail  = false as boolean,
  /** Expected deploy fee. */
  commitFee   = 100n,
  /** Expected commitment Merkle root of program. */
  cmr         = null as null|string,
  /** Expected pay-to-taproot address of program. */
  address        = null as null|string,
  /** Expected compile-time signature of program. */
  argTypes    = {} as Record<string, string>,
  /** Expected runtime signature of program. */
  witTypes    = {} as Record<string, string>,
  /** Function that provides parameter data. */
  provideArgs = null as null|Fn.Returns<Async<SimplicityHL.Args>>,
  /** Function that provides witness data. */
  provideWits = null as null|Fn<[Uint8Array<ArrayBufferLike>], Async<object>>,
} = {}) {

  return Fn.Name(`${name} (${address||'unspecified P2TR'})`, testProgram, {
    shouldFail, name, src, commitFee, cmr, address, argTypes, witTypes, provideArgs, provideWits,
  });

  // Test the SimplicityHL program specified above on the given chain.
  async function testProgram (chain: Btc) {
    const debug = (chain.debug ?? console.debug) || (()=>{});

    // Compile this program with these arguments for this chain.
    const program = await SimplicityHL.Program(src, {
      // Expected program address, optional. Makes it safer.
      address,
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

    // Fund program from deployer:
    const sender       = chain.P2WPKH(ALICE.publicKey()).address;
    const commitSource = await chain.getUtxo(sender, x => x.amount >= commitFee);
    const commitAmount = commitSource.value - commitFee;
    const commitTxid   = await SimplicityHL.Spend() // TODO wrap as program.commit() ?
      .asset(commitSource.asset)
      .input(commitSource, ALICE)
      .output(program.p2tr, commitAmount)
      .fee(commitFee)
      .broadcast(chain);

    debug('Commit TX:', commitTxid);

    // Note current recipient balance:
    const recipient = chain.P2WPKH(ALICE.publicKey()).address;
    const recipientBalance = async (asset = 'bitcoin') => Btc.toSat((await chain.getBalance(recipient, 0))[asset] ?? 0);
    const balance = await recipientBalance();

    // Find commit (deploy) output = redeem (spend) input:
    // This is a tad different across RPC vs Esplora, TODO move to lib too:
    const asset = commitSource.asset;
    const prev = await chain.waitForTx(commitTxid);
    debug('Redeem from:', prev);
    let index = null;
    const vout = prev.vout.find((x: Btc.Utxo, i: number) => {
      if (toSPKA(x) === program.p2tr) {
        index = i;
        return true;
      }
    });
    if (!vout) throw new Error('no corresponding vout found');
    const redeemSource = { txid: commitTxid, asset, vout: index, address: toSPKA(vout), amount: commitAmount };
    debug('Redeem UTXO:', redeemSource);

    // To get SIGHASH_ALL for signing, first the rest of the transaction must be specified:
    const redeemFee    = 200n;
    const redeemAmount = 200n;
    const sighashOpts  = { asset, utxos: [redeemSource], recipient, amount: redeemAmount, fee: redeemFee };
    debug('Redeem opts:', sighashOpts);
    const sighash = program.redeemSighash(sighashOpts);
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
    const { hex, ...redeemPset } = program.redeemTx({ ...sighashOpts, witness });
    debug('Redeeming:', redeemPset);

    // TX is expected to pass
    const redeemTxid = await chain.broadcast(hex);
    const redeemTx = await chain.waitForTx(redeemTxid);
    debug('Redeemed:', redeemTx);

    // Balance is expected to increase
    //debug(await chain.getBalance(recipient, 0));
    //debug(await chain.getBalance(recipient, 0));
    //debug(await recipientBalance());
    //debug(await recipientBalance());
    //equal(await recipientBalance(), balance + redeemAmount);
  }

}

const toSPKA = (x: Btc.Utxo) => x.scriptpubkey_address || x.scriptPubKey?.address;
