# Flare FDC Miniapp — Web2Json attestation

A small Next.js app that runs the **entire Flare Data Connector (FDC) Web2Json
attestation lifecycle** from the browser, on the **Coston2 testnet**:

1. **Configure** a public Web2 JSON API request (URL + a `jq` transform + an ABI
   signature for the shape you want on-chain).
2. **Prepare** — the request is encoded by Flare's verifier server.
3. **Submit** — your wallet calls `FdcHub.requestAttestation` with the fee.
4. **Wait & fetch proof** — after the voting round finalizes (~a few 90s rounds),
   the app pulls the response + Merkle proof from the Data Availability layer.
5. **Verify** — the app calls `FdcVerification.verifyWeb2Json` on-chain, proving
   the data matches the Merkle root the validators committed.

The default example attests a [SWAPI](https://swapi.info) Star Wars character —
edit any field to attest your own API (prices, weather, sports, IoT, anything a
public JSON endpoint returns).

> Web2Json is available on **Coston & Coston2 only**.

## Why the server routes?

The FDC verifier and DA layer need an API key and don't send CORS headers, so
the browser can't call them directly. The app proxies them through Next.js route
handlers (`app/api/*`), which keep `VERIFIER_API_KEY_TESTNET` server-side. The
only thing the browser signs is the `requestAttestation` transaction.

All protocol contract addresses are resolved at runtime from the
**FlareContractRegistry** (`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`, the same
on every Flare network) — nothing is hardcoded.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in VERIFIER_API_KEY_TESTNET
npm run dev
```

Open http://localhost:3000.

You'll need:

- **A wallet** (MetaMask) — the app adds/switches to Coston2 for you.
- **Test C2FLR** — get it from the [Coston2 faucet](https://faucet.flare.network/coston2).
- **A verifier API key** — set `VERIFIER_API_KEY_TESTNET` in `.env.local`. See
  the [FDC getting-started guide](https://dev.flare.network/fdc/getting-started).

### Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `VERIFIER_API_KEY_TESTNET` | Auth for the testnet verifier / DA layer | _(required)_ |
| `WEB2JSON_VERIFIER_URL_TESTNET` | Verifier base URL | `https://fdc-verifiers-testnet.flare.network/` |
| `COSTON2_DA_LAYER_URL` | Data Availability layer base URL | `https://ctn2-data-availability.flare.network/` |
| `COSTON2_RPC_URL` | RPC for server-side reads | `https://coston2-api.flare.network/ext/C/rpc` |

## Project layout

```
app/
  page.tsx            5-step FDC flow UI (client)
  api/prepare/        POST → verifier prepareRequest  (returns abiEncodedRequest)
  api/fee/            POST → FdcRequestFeeConfigurations.getRequestFee
  api/config/         GET  → resolved FDC contract addresses
  api/proof/          POST → DA layer proof-by-request-round (polled)
  api/verify/         POST → FdcVerification.verifyWeb2Json (on-chain read)
lib/
  flare.ts            chain def, registry, ABIs, voting-round math, encoders
  server.ts           viem public client + registry address resolver
  proof.ts            normalize DA response → verifier tuple
contracts/
  Web2JsonConsumer.sol  reference contract that trusts & stores attested data
```

## The on-chain consumer

This miniapp verifies proofs against the canonical `FdcVerification` contract, so
**no deploy is required** to see verification succeed. `contracts/Web2JsonConsumer.sol`
shows how a real dapp would consume the same proof — verify it, then `abi.decode`
the `responseBody.abiEncodedData` into a typed struct and store it. Deploy it with
the [Flare Hardhat starter](https://github.com/flare-foundation/flare-hardhat-starter)
if you want to try the full end-to-end write path.

## How the voting round is computed

```
votingRoundId = floor((blockTimestamp - 1658429955) / 90)
```

The app reads the block your `requestAttestation` tx landed in and derives the
round from its timestamp, then polls the DA layer for that round.

## References

- [FDC overview](https://dev.flare.network/fdc/overview)
- [FDC getting started](https://dev.flare.network/fdc/getting-started)
- [FDC by hand](https://dev.flare.network/fdc/guides/fdc-by-hand)
- [Web2Json announcement](https://flare.network/news/fip14-and-stp10-introduce-support-for-new-fdc-web2-attestations)

## License

MIT
