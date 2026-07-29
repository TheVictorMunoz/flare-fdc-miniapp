import { NextRequest, NextResponse } from "next/server";
import { inferAttestationFromJson } from "@/lib/inferFromJson";

export const runtime = "nodejs";

const MAX_BYTES = 512_000;
const TIMEOUT_MS = 12_000;

/**
 * Fetch a public HTTPS JSON URL with the given Web2Json-shaped request
 * fields, then infer postProcessJq + abiSignature from the response body.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const url = String(body.url ?? "").trim();
  const httpMethod = String(body.httpMethod ?? "GET").toUpperCase();
  let headers: Record<string, string> = {};
  let queryParams: Record<string, string> = {};
  let reqBody: string = "{}";

  try {
    headers = JSON.parse(String(body.headers ?? "{}"));
  } catch {
    return NextResponse.json({ error: "headers must be valid JSON." }, { status: 400 });
  }
  try {
    queryParams = JSON.parse(String(body.queryParams ?? "{}"));
  } catch {
    return NextResponse.json(
      { error: "queryParams must be valid JSON." },
      { status: 400 }
    );
  }
  reqBody = String(body.body ?? "{}");

  if (!url) {
    return NextResponse.json({ error: "`url` is required." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL." }, { status: 400 });
  }
  if (target.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only HTTPS URLs can be probed." },
      { status: 400 }
    );
  }
  if (target.search) {
    return NextResponse.json(
      { error: "URL must not include a query string — use queryParams." },
      { status: 400 }
    );
  }

  for (const [k, v] of Object.entries(queryParams)) {
    target.searchParams.set(k, String(v));
  }

  const init: RequestInit = {
    method: httpMethod,
    headers: {
      Accept: "application/json",
      ...headers,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };

  if (httpMethod !== "GET" && httpMethod !== "HEAD" && reqBody && reqBody !== "{}") {
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
    init.body = reqBody;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), init);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not reach URL: ${e?.message ?? e}` },
      { status: 502 }
    );
  }

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json(
      { error: `Response too large (>${MAX_BYTES} bytes).` },
      { status: 502 }
    );
  }

  const text = new TextDecoder().decode(buf);
  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: `Upstream returned HTTP ${upstream.status}.`,
        details: text.slice(0, 500),
      },
      { status: 502 }
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "Response is not JSON. Web2Json requires a JSON API." },
      { status: 400 }
    );
  }

  const inferred = inferAttestationFromJson(json);
  return NextResponse.json({
    postProcessJq: inferred.postProcessJq,
    abiSignature: inferred.abiSignature,
    sampleKeys:
      json && typeof json === "object" && !Array.isArray(json)
        ? Object.keys(json as object).slice(0, 20)
        : undefined,
  });
}
