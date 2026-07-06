import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Server-side proxy to the Coston2 Data Availability layer.
 * Returns the attestation response + Merkle proof for a finalized round,
 * or { pending: true } if the round has not finalized yet.
 *
 * Input (JSON): { votingRoundId: number, requestBytes: string }
 */
export async function POST(req: NextRequest) {
  const base =
    process.env.COSTON2_DA_LAYER_URL ??
    "https://ctn2-data-availability.flare.network/";
  const apiKey = process.env.VERIFIER_API_KEY_TESTNET;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const votingRoundId = Number(body.votingRoundId);
  const requestBytes = String(body.requestBytes ?? "");
  if (!Number.isFinite(votingRoundId) || !requestBytes) {
    return NextResponse.json(
      { error: "votingRoundId and requestBytes are required." },
      { status: 400 }
    );
  }

  const url =
    base.replace(/\/$/, "") + "/api/v1/fdc/proof-by-request-round-raw";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["X-API-KEY"] = apiKey;

  let daRes: Response;
  try {
    daRes = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ votingRoundId, requestBytes }),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not reach DA layer: ${e?.message ?? e}` },
      { status: 502 }
    );
  }

  const text = await daRes.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  // Round not finalized yet: DA layer 404s or returns an empty proof.
  const hasProof =
    json &&
    (json.proof || json.merkleProof) &&
    (json.response_hex || json.responseHex);

  if (daRes.status === 404 || !hasProof) {
    return NextResponse.json({ pending: true, details: json });
  }

  if (!daRes.ok) {
    return NextResponse.json(
      { error: "DA layer error.", details: json },
      { status: daRes.status }
    );
  }

  return NextResponse.json({ pending: false, proof: json });
}
