// Shapes returned by the Data Availability layer and the tuple the on-chain
// verifier expects. The DA layer has used both camelCase and snake_case field
// names across versions, so we read defensively.

export interface Web2JsonProofArg {
  merkleProof: `0x${string}`[];
  data: {
    attestationType: `0x${string}`;
    sourceId: `0x${string}`;
    votingRound: bigint;
    lowestUsedTimestamp: bigint;
    requestBody: {
      url: string;
      httpMethod: string;
      headers: string;
      queryParams: string;
      body: string;
      postProcessJq: string;
      abiSignature: string;
    };
    responseBody: { abiEncodedData: `0x${string}` };
  };
}

function pick<T>(obj: any, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return undefined;
}

function toBigInt(v: unknown, fallback = 0n): bigint {
  if (v === undefined || v === null) return fallback;
  try {
    return BigInt(v as any);
  } catch {
    return fallback;
  }
}

/**
 * Normalize a DA-layer `proof-by-request-round` response into the argument
 * accepted by FdcVerification.verifyWeb2Json.
 * Throws if the proof/response are missing (round not finalized yet).
 */
export function normalizeProof(daResponse: any): Web2JsonProofArg {
  const proof = pick<string[]>(daResponse, "proof", "merkleProof");
  const response = pick<any>(daResponse, "response", "data", "attestation");
  if (!proof || !response) {
    throw new Error("Proof not available yet (round may not be finalized).");
  }

  const requestBody = pick<any>(response, "requestBody", "request_body") ?? {};
  const responseBody = pick<any>(response, "responseBody", "response_body") ?? {};

  return {
    merkleProof: proof as `0x${string}`[],
    data: {
      attestationType: pick<`0x${string}`>(
        response,
        "attestationType",
        "attestation_type"
      )!,
      sourceId: pick<`0x${string}`>(response, "sourceId", "source_id")!,
      votingRound: toBigInt(
        pick(response, "votingRound", "voting_round")
      ),
      lowestUsedTimestamp: toBigInt(
        pick(response, "lowestUsedTimestamp", "lowest_used_timestamp")
      ),
      requestBody: {
        url: pick<string>(requestBody, "url") ?? "",
        httpMethod:
          pick<string>(requestBody, "httpMethod", "http_method") ?? "",
        headers: pick<string>(requestBody, "headers") ?? "",
        queryParams:
          pick<string>(requestBody, "queryParams", "query_params") ?? "",
        body: pick<string>(requestBody, "body") ?? "",
        postProcessJq:
          pick<string>(requestBody, "postProcessJq", "post_process_jq") ?? "",
        abiSignature:
          pick<string>(requestBody, "abiSignature", "abi_signature") ?? "",
      },
      responseBody: {
        abiEncodedData:
          pick<`0x${string}`>(
            responseBody,
            "abiEncodedData",
            "abi_encoded_data"
          ) ?? "0x",
      },
    },
  };
}
