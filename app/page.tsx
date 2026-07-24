"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { RECIPES, recipeById, type Web2Request } from "@/lib/recipes";
import ProofCard from "@/components/ProofCard";

declare global {
  interface Window {
    ethereum?: any;
  }
}

const DEFAULT_RECIPE_ID = "btc";

export default function Home() {
  const [account, setAccount] = useState<Address | null>(null);
  const [recipeId, setRecipeId] = useState<string>(DEFAULT_RECIPE_ID);
  const [req, setReq] = useState<Web2Request>(
    () => recipeById(DEFAULT_RECIPE_ID)!.request
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [abiEncodedRequest, setAbiEncodedRequest] = useState<string | null>(null);
  const [fee, setFee] = useState<string | null>(null);
  const [fdcHub, setFdcHub] = useState<Address | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [votingRoundId, setVotingRoundId] = useState<number | null>(null);
  const [proof, setProof] = useState<any>(null);
  const [decoded, setDecoded] = useState<Record<string, string> | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);

  const [autoRun, setAutoRun] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string) => {
    setLog((l) => [...l, msg]);
    requestAnimationFrame(() => {
      logRef.current?.scrollTo(0, logRef.current.scrollHeight);
    });
  }, []);

  const recipe = recipeById(recipeId);

  const resetDownstream = useCallback(() => {
    setAbiEncodedRequest(null);
    setFee(null);
    setFdcHub(null);
    setTxHash(null);
    setVotingRoundId(null);
    setProof(null);
    setDecoded(null);
    setValid(null);
    setAutoRun(false);
    setError(null);
    setCopied(false);
  }, []);

  const selectRecipe = useCallback(
    (id: string) => {
      const r = recipeById(id);
      if (!r) return;
      setRecipeId(id);
      setReq(r.request);
      setShowAdvanced(false);
      resetDownstream();
      setLog([]);
    },
    [resetDownstream]
  );

  const setField = (k: keyof Web2Request, v: string) => {
    setReq((r) => ({ ...r, [k]: v }));
    resetDownstream();
  };

  // ---- connect wallet ----------------------------------------------------
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

  // ---- step 1: prepare ---------------------------------------------------
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

  // ---- step 3: poll DA layer --------------------------------------------
  const fetchProof = useCallback(async () => {
    if (votingRoundId === null || !abiEncodedRequest) return;
    setError(null);
    setBusy("proof");
    setProof(null);
    try {
      const maxAttempts = 40; // ~7 min at 10s
      const candidates = [votingRoundId, votingRoundId - 1, votingRoundId + 1];
      for (let i = 0; i < maxAttempts; i++) {
        addLog(`Polling DA layer around round ${votingRoundId} (attempt ${i + 1})…`);
        for (const round of candidates) {
          const res = await fetch("/api/proof", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ votingRoundId: round, requestBytes: abiEncodedRequest }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "proof fetch failed");
          if (!json.pending) {
            setProof(json.proof);
            addLog(`Proof retrieved from the Data Availability layer (round ${round}).`);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 10_000));
      }
      throw new Error("Timed out waiting for round finalization. Try Fetch proof again.");
    } catch (e: any) {
      setAutoRun(false);
      setError(e?.message ?? "proof fetch failed");
    } finally {
      setBusy(null);
    }
  }, [votingRoundId, abiEncodedRequest, addLog]);

  // ---- step 2: submit on-chain ------------------------------------------
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
      setAutoRun(true); // hand off to auto proof + verify
      addLog(`Included in block ${receipt.blockNumber} · voting round ${round}`);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "submit failed");
    } finally {
      setBusy(null);
    }
  }, [account, abiEncodedRequest, fee, fdcHub, addLog]);

  // ---- step 4: verify on-chain ------------------------------------------
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
      setAutoRun(false);
      addLog(`On-chain verification returned: ${json.valid}`);
      if (json.attested) setDecoded(json.attested);
    } catch (e: any) {
      setAutoRun(false);
      setError(e?.message ?? "verify failed");
    } finally {
      setBusy(null);
    }
  }, [proof, addLog]);

  // ---- auto-chain: after submit, fetch proof, then verify ----------------
  useEffect(() => {
    if (autoRun && votingRoundId !== null && abiEncodedRequest && !proof && busy === null) {
      fetchProof();
    }
  }, [autoRun, votingRoundId, abiEncodedRequest, proof, busy, fetchProof]);

  useEffect(() => {
    if (autoRun && proof && valid === null && busy === null) {
      verify();
    }
  }, [autoRun, proof, valid, busy, verify]);

  // ---- share -------------------------------------------------------------
  const shareUrl = useMemo(() => {
    if (valid !== true || !abiEncodedRequest || votingRoundId === null) return null;
    if (typeof window === "undefined") return null;
    const p = new URLSearchParams({
      r: abiEncodedRequest,
      round: String(votingRoundId),
      recipe: recipeId,
    });
    if (txHash) p.set("tx", txHash);
    return `${window.location.origin}/proof?${p.toString()}`;
  }, [valid, abiEncodedRequest, votingRoundId, recipeId, txHash]);

  const doShare = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }, [shareUrl]);

  const shortAddr = useMemo(
    () => (account ? `${account.slice(0, 6)}…${account.slice(-4)}` : null),
    [account]
  );
  const explorerBase = coston2.blockExplorers!.default.url;

  // progress state per step
  const s1 = abiEncodedRequest ? "done" : busy === "prepare" ? "active" : "idle";
  const s2 = txHash ? "done" : busy === "submit" ? "active" : abiEncodedRequest ? "ready" : "idle";
  const s3 = proof ? "done" : busy === "proof" ? "active" : txHash ? "ready" : "idle";
  const s4 =
    valid === true ? "done" : busy === "verify" ? "active" : proof ? "ready" : "idle";

  return (
    <div className="wrap">
      <div className="bg-orbs" aria-hidden>
        <span />
        <span />
      </div>

      <header className="hero">
        <span className="pill">Flare Data Connector · Coston2 testnet</span>
        <h1>
          Prove <span className="grad">anything</span> on-chain.
        </h1>
        <p>
          Pick a real-world fact from a public API, and Flare&apos;s decentralized
          validators attest it. You get a <strong>tamper-proof, on-chain-verified
          proof</strong> — with a link anyone can re-verify against Flare, live.
        </p>
      </header>

      <div className="wallet-bar">
        <span className="addr">
          {account ? (
            <>
              <span className="live-dot" /> Connected · {shortAddr}
            </>
          ) : (
            "Wallet not connected"
          )}
        </span>
        {!account && (
          <button className="btn" onClick={connect}>
            Connect wallet
          </button>
        )}
      </div>

      {/* Recipe gallery */}
      <section className="panel">
        <div className="panel-head">
          <h2>1 · Choose a fact to prove</h2>
          <button className="linkbtn" onClick={() => setShowAdvanced((s) => !s)}>
            {showAdvanced ? "Hide raw request" : "Advanced / custom API"}
          </button>
        </div>
        <div className="recipe-grid">
          {RECIPES.map((r) => (
            <button
              key={r.id}
              className={`recipe ${recipeId === r.id ? "sel" : ""}`}
              onClick={() => selectRecipe(r.id)}
            >
              <span className="recipe-emoji">{r.emoji}</span>
              <span className="recipe-body">
                <span className="recipe-title">{r.title}</span>
                <span className="recipe-sub">{r.subtitle}</span>
              </span>
              <span className="recipe-cat">{r.category}</span>
            </button>
          ))}
        </div>

        {showAdvanced && (
          <div className="advanced">
            <p className="hint">
              Edit any field to attest your own public JSON API. <code>postProcessJq</code>{" "}
              shapes the response; <code>abiSignature</code> declares the Solidity struct it
              decodes to.
            </p>
            <label>URL</label>
            <input value={req.url} onChange={(e) => setField("url", e.target.value)} />
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
          </div>
        )}
      </section>

      {error && <div className="alert err">⚠ {error}</div>}

      {/* Flow */}
      <section className="panel">
        <div className="panel-head">
          <h2>2 · Create the proof</h2>
          <span className="src-tag">
            source: {recipe?.sourceName ?? "custom API"}
          </span>
        </div>

        <div className="stepper">
          <Step
            n={1}
            state={s1}
            title="Prepare"
            desc="Encode the request at Flare's verifier and read the on-chain fee."
          >
            <button className="btn" onClick={prepare} disabled={busy !== null}>
              {busy === "prepare" && <span className="spin" />} Prepare request
            </button>
            {fee !== null && (
              <div className="mini ok">Fee {fee} wei · FdcHub resolved from registry</div>
            )}
          </Step>

          <Step
            n={2}
            state={s2}
            title="Submit"
            desc="Your wallet calls FdcHub.requestAttestation. Then it runs itself."
          >
            <button
              className="btn"
              onClick={submit}
              disabled={busy !== null || !account || !abiEncodedRequest}
            >
              {busy === "submit" && <span className="spin" />}
              {account ? "Submit on-chain" : "Connect wallet first"}
            </button>
            {txHash && (
              <div className="mini ok">
                Submitted · round #{votingRoundId} ·{" "}
                <a href={`${explorerBase}/tx/${txHash}`} target="_blank" rel="noreferrer">
                  view tx
                </a>
              </div>
            )}
          </Step>

          <Step
            n={3}
            state={s3}
            title="Finalize & fetch proof"
            desc="Validators finalize the round (~90s each); the Merkle proof is pulled from the DA layer."
          >
            <button className="btn ghost" onClick={fetchProof} disabled={busy !== null || votingRoundId === null}>
              {busy === "proof" && <span className="spin" />} Fetch proof
            </button>
            {busy === "proof" && (
              <div className="mini">Waiting for round finalization…</div>
            )}
          </Step>

          <Step
            n={4}
            state={s4}
            title="Verify on-chain"
            desc="FdcVerification.verifyWeb2Json checks the proof against the root the validators committed."
            last
          >
            <button className="btn ghost" onClick={verify} disabled={busy !== null || !proof}>
              {busy === "verify" && <span className="spin" />} Verify proof
            </button>
          </Step>
        </div>
      </section>

      {/* Result */}
      {(valid !== null || busy === "verify") && (
        <section className="panel result">
          <div className="panel-head">
            <h2>3 · Your proof</h2>
          </div>
          <ProofCard
            recipeId={recipeId}
            sourceName={recipe?.sourceName}
            sourceUrl={req.url}
            attested={decoded}
            txHash={txHash}
            votingRoundId={votingRoundId}
            valid={valid}
            verifying={busy === "verify"}
            explorerBase={explorerBase}
            shareUrl={shareUrl}
            onShare={doShare}
            copied={copied}
          />
          {valid === true && (
            <p className="share-hint">
              Anyone who opens your share link re-runs the on-chain verification themselves —
              the proof stands on its own, no trust in this app required.
            </p>
          )}
        </section>
      )}

      {/* Developer details */}
      <details className="devbox">
        <summary>Developer details</summary>
        {abiEncodedRequest && (
          <>
            <div className="dev-label">abiEncodedRequest</div>
            <div className="code">{abiEncodedRequest}</div>
          </>
        )}
        {proof && (
          <>
            <div className="dev-label">DA-layer proof</div>
            <div className="code">{JSON.stringify(proof, null, 2)}</div>
          </>
        )}
        {decoded && (
          <>
            <div className="dev-label">Decoded attested data</div>
            <div className="code">{JSON.stringify(decoded, null, 2)}</div>
          </>
        )}
        <div className="dev-label">Activity log</div>
        <div className="log" ref={logRef}>
          {log.length === 0 ? <div>— activity log —</div> : log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </details>

      <footer>
        Built on the{" "}
        <a href="https://dev.flare.network/fdc/overview" target="_blank" rel="noreferrer">
          Flare Data Connector
        </a>
        . Need test C2FLR? Grab some from the{" "}
        <a href="https://faucet.flare.network/coston2" target="_blank" rel="noreferrer">
          Coston2 faucet
        </a>
        .
      </footer>
    </div>
  );
}

function Step({
  n,
  state,
  title,
  desc,
  children,
  last,
}: {
  n: number;
  state: string;
  title: string;
  desc: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`step2 ${state} ${last ? "last" : ""}`}>
      <div className="step2-rail">
        <div className="step2-node">{state === "done" ? "✓" : n}</div>
        {!last && <div className="step2-line" />}
      </div>
      <div className="step2-body">
        <div className="step2-title">{title}</div>
        <div className="step2-desc">{desc}</div>
        <div className="step2-action">{children}</div>
      </div>
    </div>
  );
}
