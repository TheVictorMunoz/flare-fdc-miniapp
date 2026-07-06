import { decodeAbiParameters } from "viem";
import { web2JsonResponseComponents } from "@/lib/flare";

// The DA layer's `proof-by-request-round-raw` endpoint returns:
//   { response_hex: "0x...", proof: ["0x...", ...] }
// `response_hex` is the ABI-encoded IWeb2Json.Response. We decode it against
// the Response components and pair it with the Merkle path to form the
// { merkleProof, data } tuple that FdcVerification.verifyWeb2Json expects.
// This mirrors the canonical flare-hardhat-starter Web2Json flow.

export interface Web2JsonProofArg {
  merkleProof: `0x${string}`[];
  data: unknown; // decoded Response tuple, passed straight to the verifier
}

function pick<T>(obj: any, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return undefined;
}

/**
 * Turn a raw DA-layer response into the verifier argument.
 * Throws if the proof/response_hex are missing (round not finalized yet).
 */
export function decodeWeb2JsonProof(daResponse: any): Web2JsonProofArg {
  const proof = pick<string[]>(daResponse, "proof", "merkleProof");
  const responseHex = pick<`0x${string}`>(
    daResponse,
    "response_hex",
    "responseHex"
  );
  if (!proof || !responseHex) {
    throw new Error("Proof not available yet (round may not be finalized).");
  }

  const [data] = decodeAbiParameters(
    [{ type: "tuple", components: web2JsonResponseComponents as any }],
    responseHex
  );

  return { merkleProof: proof as `0x${string}`[], data };
}

/**
 * Decode the inner Web2Json payload (`responseBody.abiEncodedData`) using the
 * request's own `abiSignature`, so the UI can show the attested fields.
 */
export function decodeAttestedData(data: any): Record<string, unknown> | null {
  try {
    const abiSignature: string = data?.requestBody?.abiSignature;
    const abiEncodedData: `0x${string}` = data?.responseBody?.abiEncodedData;
    if (!abiSignature || !abiEncodedData) return null;
    const sig = JSON.parse(abiSignature); // a single tuple component
    const decoded = decodeAbiParameters([sig], abiEncodedData);
    const out: Record<string, unknown> = {};
    (sig.components ?? []).forEach((c: any, i: number) => {
      const v = (decoded[0] as any)[i] ?? (decoded[0] as any)[c.name];
      out[c.name] = typeof v === "bigint" ? v.toString() : v;
    });
    return out;
  } catch {
    return null;
  }
}
