// Live self-test of the offchain/read parts of the FDC flow on Coston2.
// Does NOT sign or send anything. Proves: registry resolution, verifier
// prepareRequest, and the on-chain fee read actually work end to end.
import { createPublicClient, http } from "viem";

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const VERIFIER =
  process.env.WEB2JSON_VERIFIER_URL_TESTNET ??
  "https://fdc-verifiers-testnet.flare.network/";
const API_KEY =
  process.env.VERIFIER_API_KEY_TESTNET ?? "00000000-0000-0000-0000-000000000000";

const toB32 = (s) => {
  const h = Buffer.from(s, "utf8").toString("hex");
  return "0x" + h.padEnd(64, "0");
};

const registryAbi = [
  {
    type: "function",
    name: "getContractAddressByName",
    stateMutability: "view",
    inputs: [{ name: "_name", type: "string" }],
    outputs: [{ type: "address" }],
  },
];
const feeAbi = [
  {
    type: "function",
    name: "getRequestFee",
    stateMutability: "view",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [{ type: "uint256" }],
  },
];

const client = createPublicClient({ transport: http(RPC) });
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => console.log("  \x1b[31m✗\x1b[0m " + m);

async function resolve(name) {
  return client.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "getContractAddressByName",
    args: [name],
  });
}

const run = async () => {
  console.log("\n[1] Resolve FDC contracts from FlareContractRegistry (Coston2)");
  let fdcHub, feeCfg, fdcVer;
  try {
    [fdcHub, feeCfg, fdcVer] = await Promise.all([
      resolve("FdcHub"),
      resolve("FdcRequestFeeConfigurations"),
      resolve("FdcVerification"),
    ]);
    ok(`FdcHub                       = ${fdcHub}`);
    ok(`FdcRequestFeeConfigurations  = ${feeCfg}`);
    ok(`FdcVerification              = ${fdcVer}`);
  } catch (e) {
    bad("registry resolution failed: " + e.message);
    return;
  }

  console.log("\n[2] Verifier prepareRequest (Web2Json / PublicWeb2)");
  const body = {
    attestationType: toB32("Web2Json"),
    sourceId: toB32("PublicWeb2"),
    requestBody: {
      url: "https://swapi.info/api/people/3",
      httpMethod: "GET",
      headers: "{}",
      queryParams: "{}",
      body: "{}",
      postProcessJq:
        '{name: .name, height: .height, mass: .mass, numberOfFilms: .films | length, uid: (.url | split("/") | .[-1] | tonumber)}',
      abiSignature:
        '{"components": [{"internalType": "string", "name": "name", "type": "string"},{"internalType": "uint256", "name": "height", "type": "uint256"},{"internalType": "uint256", "name": "mass", "type": "uint256"},{"internalType": "uint256", "name": "numberOfFilms", "type": "uint256"},{"internalType": "uint256", "name": "uid", "type": "uint256"}],"name": "task","type": "tuple"}',
    },
  };
  const url = VERIFIER.replace(/\/$/, "") + "/verifier/web2/Web2Json/prepareRequest";
  let abiEncodedRequest;
  for (const headerName of ["X-API-KEY", "X-apikey"]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", [headerName]: API_KEY },
        body: JSON.stringify(body),
      });
      const txt = await res.text();
      let j;
      try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
      if (!res.ok) {
        bad(`[${headerName}] HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
        continue;
      }
      abiEncodedRequest = j.abiEncodedRequest ?? j.abi_encoded_request;
      ok(`[${headerName}] status=${j.status} abiEncodedRequest len=${abiEncodedRequest?.length}`);
      break;
    } catch (e) {
      bad(`[${headerName}] fetch error: ${e.message}`);
    }
  }
  if (!abiEncodedRequest) { bad("no abiEncodedRequest obtained; stopping"); return; }

  console.log("\n[3] On-chain fee read: FdcRequestFeeConfigurations.getRequestFee");
  try {
    const fee = await client.readContract({
      address: feeCfg,
      abi: feeAbi,
      functionName: "getRequestFee",
      args: [abiEncodedRequest],
    });
    ok(`getRequestFee = ${fee} wei`);
  } catch (e) {
    bad("fee read failed: " + e.message);
  }

  console.log("\nDone. (submit + proof + verify require a funded Coston2 key)\n");
};

run().catch((e) => { console.error(e); process.exit(1); });
