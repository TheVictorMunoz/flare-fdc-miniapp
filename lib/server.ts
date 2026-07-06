import "server-only";
import { createPublicClient, http, type Address } from "viem";
import {
  coston2,
  CONTRACT_REGISTRY_ADDRESS,
  contractRegistryAbi,
  CONTRACT_NAMES,
} from "@/lib/flare";

let cachedClient: ReturnType<typeof createPublicClient> | null = null;

export function publicClient() {
  if (!cachedClient) {
    const rpc =
      process.env.COSTON2_RPC_URL ?? coston2.rpcUrls.default.http[0];
    cachedClient = createPublicClient({
      chain: coston2,
      transport: http(rpc),
    });
  }
  return cachedClient;
}

const addressCache = new Map<string, Address>();

/** Resolve a Flare protocol contract address by name via the registry. */
export async function resolveContract(name: string): Promise<Address> {
  const cached = addressCache.get(name);
  if (cached) return cached;
  const addr = (await publicClient().readContract({
    address: CONTRACT_REGISTRY_ADDRESS,
    abi: contractRegistryAbi,
    functionName: "getContractAddressByName",
    args: [name],
  })) as Address;
  if (!addr || addr === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Registry has no address for "${name}".`);
  }
  addressCache.set(name, addr);
  return addr;
}

export const CONTRACT = CONTRACT_NAMES;
