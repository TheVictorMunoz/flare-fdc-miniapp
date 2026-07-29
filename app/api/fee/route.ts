import { NextRequest, NextResponse } from "next/server";
import { fdcRequestFeeConfigurationsAbi } from "@/lib/flare";
import { publicClient, resolveContract, CONTRACT } from "@/lib/server";

export const runtime = "nodejs";

/** Reads the FDC request fee (in wei) for a given abiEncodedRequest. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const abiEncodedRequest = String(body.abiEncodedRequest ?? "");
  if (!abiEncodedRequest.startsWith("0x")) {
    return NextResponse.json(
      { error: "abiEncodedRequest is required." },
      { status: 400 }
    );
  }

  try {
    const feeConfig = await resolveContract(
      CONTRACT.fdcRequestFeeConfigurations
    );
    const fee = (await publicClient().readContract({
      address: feeConfig,
      abi: fdcRequestFeeConfigurationsAbi,
      functionName: "getRequestFee",
      args: [abiEncodedRequest as `0x${string}`],
    })) as bigint;
    const feeWei = fee.toString();
    return NextResponse.json({
      fee: feeWei,
      feeConfig,
      calls: [
        `eth_call FdcRequestFeeConfigurations(${feeConfig}).getRequestFee → ${feeWei} wei`,
      ],
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Failed to read fee." },
      { status: 502 }
    );
  }
}
