// FULL end-to-end FDC Web2Json round-trip on Coston2, headless (no browser).
// Proves the whole flow the miniapp performs: prepare -> submit -> wait ->
// fetch proof -> verify on-chain.
//
// Requires a funded Coston2 key (get C2FLR: https://faucet.flare.network/coston2):
//   PRIVATE_KEY=0x... VERIFIER_API_KEY_TESTNET=<uuid> node scripts/e2e.mjs
//
// Mirrors flare-hardhat-starter/scripts/fdcExample/Web2Json.ts.
import {
  createPublicClient,
  createWalletClient,
  http,
  decodeAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.COSTON2_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const VERIFIER = (process.env.WEB2JSON_VERIFIER_URL_TESTNET ?? "https://fdc-verifiers-testnet.flare.network/").replace(/\/$/, "");
const DA = (process.env.COSTON2_DA_LAYER_URL ?? "https://ctn2-data-availability.flare.network/").replace(/\/$/, "");
const API_KEY = process.env.VERIFIER_API_KEY_TESTNET ?? "00000000-0000-0000-0000-000000000000";
const PK = process.env.PRIVATE_KEY;

const FIRST_TS = 1658430000, DUR = 90; // authoritative FlareSystemsManager value
const toB32 = (s) => "0x" + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const info = (m) => console.log("  · " + m);

const RESP = [
  { name: "attestationType", type: "bytes32" },
  { name: "sourceId", type: "bytes32" },
  { name: "votingRound", type: "uint64" },
  { name: "lowestUsedTimestamp", type: "uint64" },
  { name: "requestBody", type: "tuple", components: [
    { name: "url", type: "string" }, { name: "httpMethod", type: "string" },
    { name: "headers", type: "string" }, { name: "queryParams", type: "string" },
    { name: "body", type: "string" }, { name: "postProcessJq", type: "string" },
    { name: "abiSignature", type: "string" } ] },
  { name: "responseBody", type: "tuple", components: [{ name: "abiEncodedData", type: "bytes" }] },
];
const registryAbi = [{ type: "function", name: "getContractAddressByName", stateMutability: "view", inputs: [{ name: "_name", type: "string" }], outputs: [{ type: "address" }] }];
const feeAbi = [{ type: "function", name: "getRequestFee", stateMutability: "view", inputs: [{ type: "bytes" }], outputs: [{ type: "uint256" }] }];
const hubAbi = [{ type: "function", name: "requestAttestation", stateMutability: "payable", inputs: [{ type: "bytes" }], outputs: [] }];
const verAbi = [{ type: "function", name: "verifyWeb2Json", stateMutability: "view", inputs: [{ type: "tuple", components: [ { name: "merkleProof", type: "bytes32[]" }, { name: "data", type: "tuple", components: RESP } ] }], outputs: [{ type: "bool" }] }];

if (!PK) { console.error("Set PRIVATE_KEY (a funded Coston2 test key) to run the full flow."); process.exit(1); }

const account = privateKeyToAccount(PK);
const chain = { id: 114, name: "Coston2", nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const resolve = (n) => pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: "getContractAddressByName", args: [n] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\nAccount: ${account.address}`);
  const bal = await pub.getBalance({ address: account.address });
  ok(`Balance: ${bal} wei`);
  if (bal === 0n) { console.error("Account has no C2FLR. Fund it at https://faucet.flare.network/coston2"); process.exit(1); }

  console.log("\n[1] Prepare request at verifier");
  const requestBody = {
    url: "https://swapi.info/api/people/3", httpMethod: "GET", headers: "{}",
    queryParams: "{}", body: "{}",
    postProcessJq: "{name: .name, height: .height, mass: .mass, numberOfFilms: .films | length, uid: (.url | split(\"/\") | .[-1] | tonumber)}",
    abiSignature: '{"components": [{"internalType": "string", "name": "name", "type": "string"},{"internalType": "uint256", "name": "height", "type": "uint256"},{"internalType": "uint256", "name": "mass", "type": "uint256"},{"internalType": "uint256", "name": "numberOfFilms", "type": "uint256"},{"internalType": "uint256", "name": "uid", "type": "uint256"}],"name": "task","type": "tuple"}',
  };
  const prep = await fetch(`${VERIFIER}/verifier/web2/Web2Json/prepareRequest`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
    body: JSON.stringify({ attestationType: toB32("Web2Json"), sourceId: toB32("PublicWeb2"), requestBody }),
  }).then((r) => r.json());
  if (prep.status !== "VALID") { console.error("Verifier:", prep); process.exit(1); }
  const abiEncodedRequest = prep.abiEncodedRequest;
  ok(`abiEncodedRequest (${abiEncodedRequest.length} chars)`);

  console.log("\n[2] Submit requestAttestation to FdcHub");
  const [hub, feeCfg, ver] = await Promise.all([resolve("FdcHub"), resolve("FdcRequestFeeConfigurations"), resolve("FdcVerification")]);
  const fee = await pub.readContract({ address: feeCfg, abi: feeAbi, functionName: "getRequestFee", args: [abiEncodedRequest] });
  info(`FdcHub ${hub} · fee ${fee} wei`);
  const hash = await wallet.writeContract({ address: hub, abi: hubAbi, functionName: "requestAttestation", args: [abiEncodedRequest], value: fee });
  ok(`tx ${hash}`);
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  const blk = await pub.getBlock({ blockNumber: rcpt.blockNumber });
  const round = Math.floor((Number(blk.timestamp) - FIRST_TS) / DUR);
  ok(`mined in block ${rcpt.blockNumber} · voting round ${round}`);

  console.log("\n[3] Poll DA layer for the proof");
  let daJson = null, hitRound = null;
  const candidates = [round, round - 1, round + 1]; // resilient to epoch-boundary rounding
  for (let i = 0; i < 40 && !daJson; i++) {
    info(`attempt ${i + 1}…`);
    for (const r of candidates) {
      const res = await fetch(`${DA}/api/v1/fdc/proof-by-request-round-raw`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ votingRoundId: r, requestBytes: abiEncodedRequest }),
      });
      if (res.ok) {
        const j = await res.json();
        if ((j.proof || j.merkleProof) && (j.response_hex || j.responseHex)) { daJson = j; hitRound = r; break; }
      }
    }
    if (!daJson) await sleep(10000);
  }
  if (!daJson) { console.error("Timed out waiting for finalization."); process.exit(1); }
  ok(`proof retrieved from round ${hitRound} (${daJson.proof.length} merkle nodes)`);

  console.log("\n[4] Verify on-chain: FdcVerification.verifyWeb2Json");
  const [data] = decodeAbiParameters([{ type: "tuple", components: RESP }], daJson.response_hex ?? daJson.responseHex);
  const valid = await pub.readContract({ address: ver, abi: verAbi, functionName: "verifyWeb2Json", args: [{ merkleProof: daJson.proof, data }] });
  ok(`verifyWeb2Json => ${valid}`);
  const [attested] = decodeAbiParameters([JSON.parse(requestBody.abiSignature)], data.responseBody.abiEncodedData);
  console.log("\n  Attested data:", JSON.stringify(attested, (_, v) => typeof v === "bigint" ? v.toString() : v));
  console.log(valid ? "\n\x1b[32mFULL ONCHAIN ROUND-TRIP PASSED\x1b[0m\n" : "\n\x1b[31mVERIFICATION RETURNED FALSE\x1b[0m\n");
  process.exit(valid ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
