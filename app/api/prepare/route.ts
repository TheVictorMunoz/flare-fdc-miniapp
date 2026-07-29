import { NextRequest, NextResponse } from "next/server";
import {
  ATTESTATION_TYPE_WEB2JSON,
  SOURCE_ID_PUBLIC_WEB2,
} from "@/lib/flare";

export const runtime = "nodejs";

/**
 * Server-side proxy to the FDC testnet verifier.
 * Keeps VERIFIER_API_KEY_TESTNET off the client and avoids browser CORS.
 *
 * Input (JSON): the Web2Json requestBody fields.
 * Output (JSON): { abiEncodedRequest } as returned by the verifier.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.VERIFIER_API_KEY_TESTNET;
  const base =
    process.env.WEB2JSON_VERIFIER_URL_TESTNET ??
    "https://fdc-verifiers-testnet.flare.network/";

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Creating new proofs isn't available on this deployment right now. You can still open and re-verify any shared proof link.",
      },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requestBody = {
    url: String(body.url ?? ""),
    httpMethod: String(body.httpMethod ?? "GET"),
    headers: String(body.headers ?? "{}"),
    queryParams: String(body.queryParams ?? "{}"),
    body: String(body.body ?? "{}"),
    postProcessJq: String(body.postProcessJq ?? ""),
    abiSignature: String(body.abiSignature ?? ""),
  };

  if (!requestBody.url) {
    return NextResponse.json({ error: "`url` is required." }, { status: 400 });
  }

  const url =
    base.replace(/\/$/, "") + "/verifier/web2/Web2Json/prepareRequest";

  const payload = {
    attestationType: ATTESTATION_TYPE_WEB2JSON,
    sourceId: SOURCE_ID_PUBLIC_WEB2,
    requestBody,
  };

  let verifierRes: Response;
  try {
    verifierRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not reach verifier: ${e?.message ?? e}` },
      { status: 502 }
    );
  }

  const text = await verifierRes.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!verifierRes.ok) {
    return NextResponse.json(
      { error: "Verifier rejected the request.", details: json },
      { status: verifierRes.status }
    );
  }

  const abiEncodedRequest =
    json.abiEncodedRequest ?? json.abi_encoded_request ?? null;

  if (json.status && json.status !== "VALID") {
    return NextResponse.json(
      { error: `Verifier status: ${json.status}`, details: json },
      { status: 400 }
    );
  }

  if (!abiEncodedRequest) {
    return NextResponse.json(
      { error: "Verifier returned no abiEncodedRequest.", details: json },
      { status: 502 }
    );
  }

  return NextResponse.json({ abiEncodedRequest, requestBody, verifierUrl: url });
}
