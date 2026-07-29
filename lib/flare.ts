import { defineChain } from "viem";

/**
 * Flare Testnet Coston2 chain definition for viem.
 * Native currency is C2FLR (test tokens, free from the faucet).
 */
export const coston2 = defineChain({
  id: 114,
  name: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] },
  },
  blockExplorers: {
    default: {
      name: "Coston2 Explorer",
      url: "https://coston2-explorer.flare.network",
    },
  },
  testnet: true,
});

export const COSTON2_CHAIN_ID_HEX = "0x72"; // 114

/** Coston2 Systems Explorer — FDC / FSP voting rounds, finalizations, providers. */
export const COSTON2_SYSTEMS_EXPLORER =
  "https://coston2-systems-explorer.flare.network";

export function votingRoundExplorerUrl(votingRoundId: number): string {
  return `${COSTON2_SYSTEMS_EXPLORER}/voting-round/${votingRoundId}`;
}

/**
 * The FlareContractRegistry is deployed at the same address on every Flare
 * network. All protocol contracts (FdcHub, FdcVerification, fee config, ...)
 * are resolved through it by name so we never hardcode moving addresses.
 * https://dev.flare.network/network/guides/flare-contracts-registry
 */
export const CONTRACT_REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as const;

/**
 * FDC voting-round timing on Coston2. A round is 90s; round N finalizes a
 * few rounds after the request lands, which is why the app polls the DA layer.
 * votingRoundId = floor((blockTimestamp - firstVotingRoundStartTs) / duration)
 *
 * firstVotingRoundStartTs is the authoritative value from the
 * FlareSystemsManager contract (verified on-chain). Note: the FDC
 * getting-started doc lists 1658429955, which is 45s early and rounds the
 * epoch up by one near boundaries — 1658430000 is correct.
 */
export const FIRST_VOTING_ROUND_START_TS = 1658430000;
export const VOTING_EPOCH_DURATION_SECONDS = 90;

export function votingRoundIdFromTimestamp(timestampSeconds: number): number {
  return Math.floor(
    (timestampSeconds - FIRST_VOTING_ROUND_START_TS) /
      VOTING_EPOCH_DURATION_SECONDS
  );
}

// ---------------------------------------------------------------------------
// Attestation type / source id encoding
// ---------------------------------------------------------------------------

/** UTF-8 encode a short name and right-pad with zero bytes to 32 bytes (0x + 64 hex). */
export function toBytes32Hex(name: string): `0x${string}` {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length > 32) throw new Error(`"${name}" is longer than 32 bytes`);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return ("0x" + hex.padEnd(64, "0")) as `0x${string}`;
}

export const ATTESTATION_TYPE_WEB2JSON = toBytes32Hex("Web2Json");
export const SOURCE_ID_PUBLIC_WEB2 = toBytes32Hex("PublicWeb2");

// ---------------------------------------------------------------------------
// Minimal ABIs (only the functions this app calls)
// ---------------------------------------------------------------------------

export const contractRegistryAbi = [
  {
    type: "function",
    name: "getContractAddressByName",
    stateMutability: "view",
    inputs: [{ name: "_name", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const fdcRequestFeeConfigurationsAbi = [
  {
    type: "function",
    name: "getRequestFee",
    stateMutability: "view",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const fdcHubAbi = [
  {
    type: "function",
    name: "requestAttestation",
    stateMutability: "payable",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [],
  },
] as const;

/**
 * IWeb2Json.Response — the `data` field of the proof. The DA layer's
 * `proof-by-request-round-raw` endpoint returns this ABI-encoded as
 * `response_hex`, which we decode against exactly these components.
 * Mirrors @flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol.
 */
export const web2JsonResponseComponents = [
  { name: "attestationType", type: "bytes32" },
  { name: "sourceId", type: "bytes32" },
  { name: "votingRound", type: "uint64" },
  { name: "lowestUsedTimestamp", type: "uint64" },
  {
    name: "requestBody",
    type: "tuple",
    components: [
      { name: "url", type: "string" },
      { name: "httpMethod", type: "string" },
      { name: "headers", type: "string" },
      { name: "queryParams", type: "string" },
      { name: "body", type: "string" },
      { name: "postProcessJq", type: "string" },
      { name: "abiSignature", type: "string" },
    ],
  },
  {
    name: "responseBody",
    type: "tuple",
    components: [{ name: "abiEncodedData", type: "bytes" }],
  },
] as const;

/**
 * IWeb2Json.Proof as consumed by FdcVerification.verifyWeb2Json:
 * { bytes32[] merkleProof, Response data }.
 */
export const web2JsonProofComponents = [
  { name: "merkleProof", type: "bytes32[]" },
  { name: "data", type: "tuple", components: web2JsonResponseComponents },
] as const;

export const fdcVerificationAbi = [
  {
    type: "function",
    name: "verifyWeb2Json",
    stateMutability: "view",
    inputs: [{ name: "_proof", type: "tuple", components: web2JsonProofComponents }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const CONTRACT_NAMES = {
  fdcHub: "FdcHub",
  fdcRequestFeeConfigurations: "FdcRequestFeeConfigurations",
  fdcVerification: "FdcVerification",
} as const;
