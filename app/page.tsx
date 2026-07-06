"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  createWalletClient,
  createPublicClient,
  custom,
  type Address,
} from "viem";
import {
  coston2,
  COSTON2_CHAIN_ID_HEX,
  fdcHubAbi,
  votingRoundIdFromTimestamp,
} from "@/lib/flare";

// Canonical Web2Json example from the Flare dev hub: fetch a Star Wars
// character and prove a few fields on-chain. Edit any field to attest your
// own public API instead.
const DEFAULT_REQUEST = {
  url: "https://swapi.info/api/people/3",
  httpMethod: "GET",
  headers: "{}",
  queryParams: "{}",
  body: "{}",
  postProcessJq:
    '{name: .name, height: .height, mass: .mass, numberOfFilms: (.films | length), uid: (.url | split("/") | .[-2] | tonumber)}',
  abiSignature:
    '{"components":[{"internalType":"string","name":"name","type":"string"},{"internalType":"uint256","name":"height","type":"uint256"},{"internalType":"uint256","name":"mass","type":"uint256"},{"internalType":"uint256","name":"numberOfFilms","type":"uint256"},{"internalType":"uint256","name":"uid","type":"uint256"}],"name":"task","type":"tuple"}',
};

type Req = typeof DEFAULT_REQUEST;

declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function Home() {
  const [account, setAccount] = useState<Address | null>(null);
  const [req, setReq] = useState<Req>(DEFAULT_REQUEST);

  const [abiEncodedRequest, setAbiEncodedRequest] = useState<string | null>(
    null
  );
  const [fee, setFee] = useState<string | null>(null);
  const [fdcHub, setFdcHub] = useState<Address | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [votingRoundId, setVotingRoundId] = useState<number | null>(null);
  const [proof, setProof] = useState<any>(null);
  const [decoded, setDecoded] = useState<any>(null);
  const [valid, setValid] = useState<boolean | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string) => {
    setLog((l) => [...l, msg]);
    requestAnimationFrame(() => {
      logRef.current?.scrollTo(0, logRef.current.scrollHeight);
    });
  }, []);

  const setField = (k: keyof Req, v: string) =>
    setReq((r) => ({ ...r, [k]: v }));

  // ---- Step 1: connect wallet -------------------------------------------
  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("No injected wallet found. Install MetaMask.");
      return;
    }
    try {
      const [addr] = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: COSTON2_CHAIN_ID_HEX }],
        });
      } catch (switchErr: any) {
        if (switchErr?.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: COSTON2_CHAIN_ID_HEX,
                chainName: coston2.name,
                nativeCurrency: coston2.nativeCurrency,
                rpcUrls: coston2.rpcUrls.default.http,
                blockExplorerUrls: [coston2.blockExplorers!.default.url],
              },
            ],
          });
        } else {
          throw switchErr;
        }
      }
      setAccount(addr as Address);
      addLog(`Wallet connected: ${addr}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to connect wallet.");
    }
  }, [addLog]);

  // ---- Step 2: prepare request + read fee -------------------------------
  const prepare = useCallback(async () => {
    setError(null);
    setBusy("prepare");
    setAbiEncodedRequest(null);
    setFee(null);
    try {
      addLog("Encoding attestation request at the verifier…");
      const res = await fetch("/api/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "prepare failed");
      setAbiEncodedRequest(json.abiEncodedRequest);
      addLog(`abiEncodedRequest ready (${json.abiEncodedRequest.length} chars)`);

      addLog("Reading request fee + resolving FdcHub…");
      const [feeRes, cfgRes] = await Promise.all([
        fetch("/api/fee", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ abiEncodedRequest: json.abiEncodedRequest }),
        }),
        fetch("/api/config"),
      ]);
      const feeJson = await feeRes.json();
      const cfgJson = await cfgRes.json();
      if (!feeRes.ok) throw new Error(feeJson.error ?? "fee read failed");
      if (!cfgRes.ok) throw new Error(cfgJson.error ?? "config read failed");
      setFee(feeJson.fee);
      setFdcHub(cfgJson.fdcHub);
      addLog(`Fee: ${feeJson.fee} wei · FdcHub: ${cfgJson.fdcHub}`);
    } catch (e: any) {
      setError(e?.message ?? "prepare failed");
    } finally {
      setBusy(null);
    }
  }, [req, addLog]);

  // ---- Step 3: submit on-chain ------------------------------------------
  const submit = useCallback(async () => {
    if (!account || !abiEncodedRequest || fee === null || !fdcHub) return;
    setError(null);
    setBusy("submit");
    try {
      const wallet = createWalletClient({
        account,
        chain: coston2,
        transport: custom(window.ethereum),
      });
      const pub = createPublicClient({
        chain: coston2,
        transport: custom(window.ethereum),
      });

      addLog("Submitting requestAttestation to FdcHub…");
      const hash = await wallet.writeContract({
        address: fdcHub,
        abi: fdcHubAbi,
        functionName: "requestAttestation",
        args: [abiEncodedRequest as `0x${string}`],
        value: BigInt(fee),
      });
      setTxHash(hash);
      addLog(`Tx sent: ${hash}`);

      const receipt = await pub.waitForTransactionReceipt({ hash });
      const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
      const round = votingRoundIdFromTimestamp(Number(block.timestamp));
      setVotingRoundId(round);
      addLog(`Included in block ${receipt.blockNumber} · voting round ${round}`);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "submit failed");
    } finally {
      setBusy(null);
    }
  }, [account, abiEncodedRequest, fee, fdcHub, addLog]);

  // ---- Step 4: poll DA layer for the proof ------------------------------
  const fetchProof = useCallback(async () => {
    if (votingRoundId === null || !abiEncodedRequest) return;
    setError(null);
    setBusy("proof");
    setProof(null);
    try {
      const maxAttempts = 30; // ~5 min at 10s
      for (let i = 0; i < maxAttempts; i++) {
        addLog(`Polling DA layer for round ${votingRoundId} (attempt ${i + 1})…`);
        const res = await fetch("/api/proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            votingRoundId,
            requestBytes: abiEncodedRequest,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "proof fetch failed");
        if (!json.pending) {
          setProof(json.proof);
          addLog("Proof retrieved from the Data Availability layer.");
          return;
        }
        await new Promise((r) => setTimeout(r, 10_000));
      }
      throw new Error("Timed out waiting for round finalization. Try again.");
    } catch (e: any) {
      setError(e?.message ?? "proof fetch failed");
    } finally {
      setBusy(null);
    }
  }, [votingRoundId, abiEncodedRequest, addLog]);

  // ---- Step 5: verify on-chain ------------------------------------------
  const verify = useCallback(async () => {
    if (!proof) return;
    setError(null);
    setBusy("verify");
    setValid(null);
    try {
      addLog("Calling FdcVerification.verifyWeb2Json on-chain…");
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "verify failed");
      setValid(json.valid);
      addLog(`On-chain verification returned: ${json.valid}`);

      const resp = proof.response ?? proof.data ?? proof.attestation;
      const rb = resp?.responseBody ?? resp?.response_body;
      if (rb) setDecoded(rb);
    } catch (e: any) {
      setError(e?.message ?? "verify failed");
    } finally {
      setBusy(null);
    }
  }, [proof, addLog]);

  const shortAddr = useMemo(
    () => (account ? `${account.slice(0, 6)}…${account.slice(-4)}` : null),
    [account]
  );

  const explorerTx = txHash
    ? `${coston2.blockExplorers!.default.url}/tx/${txHash}`
    : null;

  return (
    <div className="wrap">
      <header className="hero">
        <span className="pill">Flare Data Connector · Coston2</span>
        <h1>Prove Web2 data on-chain</h1>
        <p>
          Run the full FDC <strong>Web2Json</strong> attestation lifecycle from
          your browser: encode a request, submit it on-chain, wait for the
          voting round to finalize, fetch the Merkle proof, and verify it
          against the on-chain Merkle root — all on the Coston2 testnet.
        </p>
      </header>

      <div className="wallet-bar">
        <div>
          {account ? (
            <span className="addr">Connected · {shortAddr}</span>
          ) : (
            <span className="addr">Wallet not connected</span>
          )}
        </div>
        {!account && <button onClick={connect}>Connect wallet</button>}
      </div>

      {error && (
        <div className="step">
          <div className="status err">⚠ {error}</div>
        </div>
      )}

      {/* Step 1 */}
      <section className="step">
        <div className="step-head">
          <div className={`step-num ${abiEncodedRequest ? "done" : ""}`}>1</div>
          <h2>Configure the Web2 request</h2>
        </div>
        <p className="hint">
          Any public JSON API. <code>postProcessJq</code> shapes the response;
          <code> abiSignature</code> declares the Solidity struct it decodes to.
        </p>
        <label>URL</label>
        <input
          value={req.url}
          onChange={(e) => setField("url", e.target.value)}
        />
        <div className="grid-2">
          <div>
            <label>HTTP method</label>
            <input
              value={req.httpMethod}
              onChange={(e) => setField("httpMethod", e.target.value)}
            />
          </div>
          <div>
            <label>Query params (JSON)</label>
            <input
              value={req.queryParams}
              onChange={(e) => setField("queryParams", e.target.value)}
            />
          </div>
        </div>
        <label>postProcessJq</label>
        <textarea
          value={req.postProcessJq}
          onChange={(e) => setField("postProcessJq", e.target.value)}
        />
        <label>abiSignature</label>
        <textarea
          value={req.abiSignature}
          onChange={(e) => setField("abiSignature", e.target.value)}
        />
        <div className="row">
          <button onClick={prepare} disabled={busy !== null}>
            {busy === "prepare" ? <span className="spin" /> : null}
            Prepare request
          </button>
        </div>
        {abiEncodedRequest && (
          <>
            <div className="code">{abiEncodedRequest}</div>
            {fee !== null && (
              <div className="status ok">
                Fee: {fee} wei · FdcHub resolved from registry
              </div>
            )}
          </>
        )}
      </section>

      {/* Step 2 */}
      <section
        className={`step ${
          abiEncodedRequest && account ? "" : "disabled"
        }`}
      >
        <div className="step-head">
          <div className={`step-num ${txHash ? "done" : ""}`}>2</div>
          <h2>Submit the attestation on-chain</h2>
        </div>
        <p className="hint">
          Calls <code>FdcHub.requestAttestation</code> with the encoded request
          and the required fee. Confirm the transaction in your wallet.
        </p>
        <div className="row">
          <button onClick={submit} disabled={busy !== null || !account}>
            {busy === "submit" ? <span className="spin" /> : null}
            Submit request
          </button>
        </div>
        {txHash && (
          <div className="status ok">
            Submitted in voting round <strong>{votingRoundId}</strong> ·{" "}
            <a href={explorerTx!} target="_blank" rel="noreferrer">
              view tx
            </a>
          </div>
        )}
      </section>

      {/* Step 3 */}
      <section className={`step ${votingRoundId !== null ? "" : "disabled"}`}>
        <div className="step-head">
          <div className={`step-num ${proof ? "done" : ""}`}>3</div>
          <h2>Fetch the Merkle proof</h2>
        </div>
        <p className="hint">
          The voting round finalizes a few rounds (~90s each) after submission.
          This polls the Data Availability layer until the proof is ready.
        </p>
        <div className="row">
          <button onClick={fetchProof} disabled={busy !== null}>
            {busy === "proof" ? <span className="spin" /> : null}
            Fetch proof
          </button>
        </div>
        {proof && (
          <div className="code">{JSON.stringify(proof, null, 2)}</div>
        )}
      </section>

      {/* Step 4 */}
      <section className={`step ${proof ? "" : "disabled"}`}>
        <div className="step-head">
          <div className={`step-num ${valid === true ? "done" : ""}`}>4</div>
          <h2>Verify on-chain</h2>
        </div>
        <p className="hint">
          Calls <code>FdcVerification.verifyWeb2Json</code>, which checks the
          Merkle proof against the root stored on-chain by the validators.
        </p>
        <div className="row">
          <button onClick={verify} disabled={busy !== null}>
            {busy === "verify" ? <span className="spin" /> : null}
            Verify proof
          </button>
          {valid === true && <span className="badge ok">✓ Verified on-chain</span>}
          {valid === false && (
            <span className="badge err">✗ Not valid</span>
          )}
        </div>
        {decoded && (
          <div className="code">
            {JSON.stringify(decoded, null, 2)}
          </div>
        )}
      </section>

      <div className="log" ref={logRef}>
        {log.length === 0 ? (
          <div>— activity log —</div>
        ) : (
          log.map((l, i) => <div key={i}>{l}</div>)
        )}
      </div>

      <footer>
        Built on the{" "}
        <a href="https://dev.flare.network/fdc/overview" target="_blank" rel="noreferrer">
          Flare Data Connector
        </a>
        . Need test C2FLR? Use the{" "}
        <a href="https://faucet.flare.network/coston2" target="_blank" rel="noreferrer">
          Coston2 faucet
        </a>
        .
      </footer>
    </div>
  );
}
