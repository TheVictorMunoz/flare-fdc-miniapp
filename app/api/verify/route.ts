import { NextRequest, NextResponse } from "next/server";
import { fdcVerificationAbi } from "@/lib/flare";
import { publicClient, resolveContract, CONTRACT } from "@/lib/server";
import { normalizeProof } from "@/lib/proof";

export const runtime = "nodejs";

/**
 * Calls FdcVerification.verifyWeb2Json on-chain (read-only) with the proof
 * returned by the DA layer. Returns { valid: boolean }.
 *
 * Input (JSON): { proof } — the raw DA-layer proof-by-request-round response.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let proofArg;
  try {
    proofArg = normalizeProof(body.proof);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Malformed proof." },
      { status: 400 }
    );
  }

  try {
    const verification = await resolveContract(CONTRACT.fdcVerification);
    const valid = (await publicClient().readContract({
      address: verification,
      abi: fdcVerificationAbi,
      functionName: "verifyWeb2Json",
      args: [proofArg as any],
    })) as boolean;
    return NextResponse.json({ valid });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "On-chain verification call failed." },
      { status: 502 }
    );
  }
}
