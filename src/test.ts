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

// Test the spend helper.
function TestSend (amount = 3000n, fee = 12000n) {
  return Fn.Name(`Spend ${amount} for ${fee}`, testSend);
  async function testSend (chain: Btc) {
    const from  = chain.P2WPKH(keypair1.publicKey()).address;
    const to    = chain.P2WPKH(keypair2.publicKey()).address;
    const utxo  = await chain.getUtxo(from);
    return Object.assign(chain, await SimplicityHL.Spend()
      .asset(utxo.asset)
      .input(utxo, keypair1)
      .output(to, amount)
      .fee(fee).broadcast(chain));
  }
}

// Self-explanatory.
export function TestOnTestnet () {
  // Tests that touch Liquid Testnet using Esplora
  return Test('liquidtestnet', () => LiquidTestnet(),
    TestSend(), // Test the basic transaction primitive
    'Programs'  // TODO: Separate fixtures to reuse P2TR source/type defs
  );
}

// Self-explanatory.
export function TestOnLocalnet () {
  // Tests that run on temporary localnet:
  return ElementsRegtest.Test({},
    Rpc.SendFromWallet("100000", ElementsRegtest.P2WPKH(keypair1.publicKey()).address),
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
  provideArgs = null as null|Fn.Returns<Async<SimplicityHL.Args>>,
  /** Function that provides witness data. */
  provideWits = null as null|Fn<[Uint8Array<ArrayBufferLike>], Async<object>>,
} = {}) {

  return Fn.Name(`${name} (${p2tr||'unspecified P2TR'})`, testProgram, {
    shouldFail, name, src, fee, cmr, p2tr, argTypes, witTypes, provideArgs, provideWits,
  });

  // Test the SimplicityHL program specified above on the given chain.
  async function testProgram (chain: Btc) {

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
    const commitSource = await chain.getUtxo(chain.P2WPKH(keypair1.publicKey()).address);
    const commitAmount = BigInt(commitSource.amount * 1e8) - BigInt(fee * 1e8);
    const commitTxid = await SimplicityHL.Spend() // TODO wrap as program.commit() ?
      .asset(commitSource.asset)
      .input(commitSource, keypair1)
      .output(program.p2tr, commitAmount)
      .fee(fee)
      .broadcast(chain);

    // Note current recipient balance:
    const recipient = chain.P2WPKH(keypair1.publicKey()).address;
    const recipientBalance = async (asset = 'bitcoin') =>
      BigInt((await chain.getBalance(recipient, 0))[asset] * 1e8);
    const balance = await recipientBalance();

    // Find commit (deploy) output = redeem (spend) input:
    const asset = commitSource.asset;
    const prev = await chain.getTxInfo(commitTxid);
    const txid = prev.txid;
    const vout = prev.vout.filter(x=>x.scriptPubKey.address === p2tr)[0];
    if (!vout) throw new Error('no corresponding vout found');
    const utxos = [{ txid, asset, vout: vout.n, address: vout.scriptPubKey.address, amount: vout.value }];

    // To get SIGHASH_ALL for signing, first the rest of the transaction must be specified:

    const redeemFee    = 1e-4;
    const redeemAmount = commitAmount - BigInt(redeemFee * 1e8);
    const sighashOpts  = { asset, utxos, recipient, amount: redeemAmount, fee: redeemFee };
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
    const redeemTx = program.redeemTx({ ...sighashOpts, witness });
    // TX is expected to pass
    await chain.broadcast(redeemTx.hex);
    // Balance is expected to increase
    equal(await recipientBalance(), balance + redeemAmount);
  }
}

