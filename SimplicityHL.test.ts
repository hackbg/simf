#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run --allow-write=/tmp/fadroma --allow-import=cdn.skypack.dev:443,deno.land:443 --allow-net=127.0.0.1:8941,liquidtestnet.com:443,blockstream.info:443
import Fn from '../../library/Fn.ts';
import Test from '../../library/Test.ts';
import Bitcoin from '../Bitcoin/Bitcoin.ts';
import SimplicityHL from './SimplicityHL.ts';
import { Base16 } from '../../library/Number.ts';
import { p2wpkh } from 'npm:@scure/btc-signer';
import { pubECDSA, pubSchnorr, signSchnorr } from 'npm:@scure/btc-signer/utils.js';
import { deepStrictEqual as equal, rejects } from 'node:assert';
const { is: Is, has: Has } = Test;
/** Non-private key. */
const SECRET = new Uint8Array(Array(32).fill(1));
/** WASM-backed Secp256k1 keypair for Schnorr signing. */
const KEYPAIR = await SimplicityHL.Keypair(SECRET);
/** Public key for ECDSA (transactions). */
const PUB_ECDSA = pubECDSA(SECRET);
/** Sign (ECDSA) transaction with test private key. */
const signEcdsa = (data: Uint8Array<ArrayBufferLike> = new Uint8Array()) => signSchnorr(data, SECRET);
/** Public key for Schnorr (witnesses). */
const PUB_SCHNORR = pubSchnorr(SECRET);
/** Sign (Schnorr) witness data with test private key. */
const signSchnorr = (data: Uint8Array<ArrayBufferLike> = new Uint8Array()) => signSchnorr(data, SECRET);
/** Test the SimplicityHL support in Fadroma. */
export default Test(import.meta, 'SimplicityHL',
  // Check that the API entrypoints are present on the WASM module:
  Test('WASM', () => SimplicityHL.Wasm(),
    Has('keypair', Is('function')),
    Has('compiler', Is('function'))),
  // Test SimplicityHL on localnet.
  TestSimplicityHL(Bitcoin.ElementsRegtest),
  // TODO: Test SimplicityHL on remote testnet:
  // TestSimplicityHL('liquidtestnet',  Bitcoin.LiquidTestnet),
)
/** Test SimplicityHL programs. */
function TestSimplicityHL (Chain) {
  let genesis = null;
  const initial0 = { bitcoin: 0 };
  const initial1 = { [Chain.REISSUE]: 1, bitcoin: Number(Chain.INITIAL_COINS / Bitcoin.DECIMAL) };
  // Compile and deploy example programs:
  return Test(Chain.ID, () => Chain(),

    // FIXME: These steps don't apply on remote testnet,
    // and can just be moved to localnet constructor options.

    // Optionally, pipe the localnet's output to stderr:
    Bitcoin.Verbose(true),
    // Create test wallet, which is first seen as empty:
    Bitcoin.CreateWallet('test-simf', testHasBalance(initial0)),
    // But, after rescan, turns out to not be empty - it contains default balances:
    Bitcoin.Rescan(testHasBalance(initial1)),

    async function fetchGenesisHash (context) {
      genesis = await context.rpc.getblockhash(0);
      console.log({genesis});
      return context
    },

    // FIXME: Some of the values won't apply on remote testnet:
    // And now we can test the included example programs:
    // - empty program, always runs
    Example(true,  "unit program",       2.4e-7,
      'c40a10263f7436b4160acbef1c36fba4be4d95df181a968afeab5eac247adff7',
      'ert1p9jcvyzkdwdqtf49kta4xpc5g35xkfcexwfsl8v70w2gwttelncyspjlnrz',
      'fn main () {}'),
    // - correct assertion, always runs
    Example(true,  "assert true",        2.7e-7,
      '633f62f67589423aafcd3ce0a4dc41f6192403c4aeb61997f438dbd7b96c5cf7',
      'ert1per0vg2wvc4ua2rsndm8j6062r7z7ys7q6wcvwumepgz8t5m6hfhsrd8d8q',
      'fn main () { assert!(true) }'),
    // - incorrect assertion, always fails
    Example(false, "assert false fails", 2.7e-7,
      'd3c6b9ecfc2876ec72f0099c6f454b7b34645d08c1f220c05ae80e77eed4bdf3',
      'ert1p7p4rgaw5dmhxt6qutf2v3rtuy6afghfgktmmedkpju5uamxdz5js3hdug9',
      'fn main () { assert!(false) }'),
    // - some jet calls
    Example(true,  "basic jets work",    2.7e-7,
      'b8b3509f12177723609e3995101ff589e504361ce32ec4d417bba3b37bbb7fac',
      'ert1pmy9edmq0yfrc477jvcc835umyajlgjsnyujplt8nppr45zrwl7qs02gj3x',
      `fn main () { let ab: u16 = <(u8, u8)>::into((0x10, 0x01));     assert!(jet::eq_16(ab, 0x1001));
                    let ab: u8  = <(u4, u4)>::into((0b1011, 0b1101)); assert!(jet::eq_8(ab, 0b10111101)); }`),
    // - witness signing
    Example(true,  "pay to pubkey",      2.7e-7,
      'b1b4447ce3082324635798876f1ae6c9aec9a228eb6e21e3cb991f8970986965',
      'ert1ppe00tyu7xnl96056wpth5fhas3hesnehglzstluxn77fe9xx2atsaqwx5h',
      `fn main () { jet::bip_0340_verify((param::PK, jet::sig_all_hash()), witness::SIG) }`,
      () => ({ PK: SimplicityHL.Arg.Pubkey(KEYPAIR.xOnlyPublicKey()) }),
      (sighash: Uint8Array) => ({ SIG: SimplicityHL.Arg.Signature(KEYPAIR.signSchnorr(sighash)), })),
    // - more complex signing
    Example(true,  "pay to pubkey hash", 2.7e-7,
      'e65e19e139a13583a0a7efb24be13c20d578f06f51b2a7fe7c7b9097072dbabe',
      'tex1p305439usq06f4maelan8txnxshktvayu9z5gnwu6zrrxm9vmlufqcshcuv',
      `fn sha2 (string: u256) -> u256 { let hasher: Ctx8 = jet::sha_256_ctx_8_init();
                                        let hasher: Ctx8 = jet::sha_256_ctx_8_add_32(hasher, string);
                                        jet::sha_256_ctx_8_finalize(hasher) }
       fn main () { assert!(jet::eq_256(sha2(witness::PUB), param::PKH));
                    jet::bip_0340_verify((witness::PUB, jet::sig_all_hash()), witness::SIG) }`,
      () => ({ PKH: SimplicityHL.Arg.Pubkey(KEYPAIR.xOnlyPublicKey()) /*FIXME hashit*/ }),
      (sighash: Uint8Array) => ({ SIG: SimplicityHL.Arg.Signature(KEYPAIR.signSchnorr(sighash))
                                , PUB: SimplicityHL.Arg.Pubkey(KEYPAIR.xOnlyPublicKey()), })),
    // - multisig: TODO
    
    // Shutdown the localnet.
    (btc: Bitcoin) => btc.kill(9));

  /** Define example program. */
  function Example (
    /** Is the example expected to work? */
    pass: boolean,
    /** Human-readable identifier. */
    name: string,
    /** Expected deploy fee. */
    cost: number,
    /** Expected commitment Merkle root of program. */
    cmr:  string,
    /** Expected pay-to-taproot address of program. */
    p2tr: string,
    /** Source code of program. */
    src:  string,
    /** Function that provides parameter data. */
    args?: Fn.Returns<Fn.Async<SimplicityHL.Args>>,
    /** Function that provides witness data. */
    wits?: Fn<[Uint8Array], Fn.Async<object>>,
  ) {
    const fail = !pass
    const meta = { name, cost, cmr, p2tr, src, fail, wits };
    return Fn.Name(`${name} (${p2tr||'unspecified P2TR'})`, testExample, meta)
    async function testExample ({ rpc, rest }: Bitcoin) {

      // Compile the program.
      const opts = { genesis, chain: Chain.ID, args: args ? await args() : undefined }
      const prog = await SimplicityHL(src, opts);

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
      console.log({ sighash });
      const witness = wits ? await wits(sighash) : {};
      console.log({ witness });

      // Ultimate execution context.
      // TODO: Simplify/separate context from args/?
      const context = { rpc, rest, /*sign,*/ previous, amount, fee, witness, recipient };

      if (fail) {

        // TX is expected to fail
        rejects(()=>prog.redeem(context));

        // Balance is expected to remain the same
        equal(await rpc.getreceivedbyaddress(recipient, 0), { bitcoin: balance });

      } else {

        // TX is expected to pass
        await prog.redeem(context);

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

  // TODO:
  /* https://github.com/BlockstreamResearch/SimplicityHL/blob/master/examples/escrow_with_delay.simf
   * https://docs.ivylang.org/bitcoin/language/ExampleContracts.html#escrowwithdelay */
  //function EscrowProgram ({
    //sender    = '0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    //recipient = '0xc6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
    //escrow    = '0xf9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
    //timeout   = '1000',
  //} = {}) { return `
    //fn main () {
      //// Depending on provided witness:
      //match witness::TRANSFER_OR_TIMEOUT {
        //// Transfer to receiver:
        //Left(maybe_sigs: [Option<Signature>; 3]) => spend_confirm(maybe_sigs),
        //// or return to sender:
        //Right(sender_sig: Signature) => spend_revoke(sender_sig), } }
    //fn spend_revoke (sender_sig: Signature) {
      //checksig(${sender}, sender_sig);
      //jet::check_lock_distance(${timeout}); }
    //fn spend_confirm (maybe_sigs: [Option<Signature>; 3]) {
      //let threshold: u8 = 2;
      //let [sig1, sig2, sig3]: [Option<Signature>; 3] = maybe_sigs;
      //let counter1: u8 = checksig_add(0,        ${sender},    sig1);
      //let counter2: u8 = checksig_add(counter1, ${recipient}, sig2);
      //let counter3: u8 = checksig_add(counter2, ${escrow},    sig3);
      //assert!(jet::eq_8(counter3, threshold)); }
    //fn checksig_add (counter: u8, pk: Pubkey, maybe_sig: Option<Signature>) -> u8 {
      //match maybe_sig {
        //None => counter,
        //Some(sig: Signature) => {
          //checksig(pk, sig);
          //let (carry, new_counter): (bool, u8) = jet::increment_8(counter);
          //assert!(not(carry));
          //new_counter } } }
    //fn checksig (pk: Pubkey, sig: Signature) {
      //jet::bip_0340_verify((pk, jet::sig_all_hash()), sig); }
    //fn not (bit: bool) -> bool {
      //<u1>::into(jet::complement_1(<bool>::into(bit))) }
  //` }
  //function EscrowProgramWitness (
    //value = "Right(0xedb6865094260f8558728233aae017dd0969a2afe5f08c282e1ab659bf2462684c99a64a2a57246358a0d632671778d016e6df7381293dd5bb9f0999d38640d4)",
  //) { return { TRANSFER_OR_TIMEOUT: Either('[Option<Signature>; 3]', 'Signature', value) } }

  //[>* Test cmr_to_p2tr on a given example. <]
  //function testAddress ({ cmr, p2tr: expectedP2TR }: Example) {
    //return (cmrToP2TR: Fn) => {
      //throws(()=>cmrToP2TR());
      //if (cmr) {
        //const p2tr = cmrToP2TR(cmr);
        //if (expectedP2TR) equal(p2tr, expectedP2TR);
      //}
      //return cmrToP2TR
    //}
  //}

  //[>* Test compile on a given example. <]
  //function testCompile ({ src, cmr }: Example) {
    //return Fn.Name(`Compile (${src.length}b)`, (compile: Fn) => {
      //const result = compile(src, {}) as { toJSON: Fn.Returns<{ cmr: unknown }> };
      //if (cmr) equal(result.toJSON().cmr, cmr);
      //return compile;
    //});
  //}
