import { NextResponse } from "next/server";
import { resolveContract, CONTRACT } from "@/lib/server";

export const runtime = "nodejs";

/** Returns FDC contract addresses resolved from the on-chain registry. */
export async function GET() {
  try {
    const [fdcHub, fdcRequestFeeConfigurations, fdcVerification] =
      await Promise.all([
        resolveContract(CONTRACT.fdcHub),
        resolveContract(CONTRACT.fdcRequestFeeConfigurations),
        resolveContract(CONTRACT.fdcVerification),
      ]);
    return NextResponse.json({
      fdcHub,
      fdcRequestFeeConfigurations,
      fdcVerification,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Failed to resolve contracts." },
      { status: 502 }
    );
  }
}
