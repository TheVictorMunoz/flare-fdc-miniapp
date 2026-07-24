"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { coston2 } from "@/lib/flare";
import { recipeById } from "@/lib/recipes";
import ProofCard from "@/components/ProofCard";

export default function ProofPage() {
  return (
    <Suspense fallback={<div className="wrap" />}>
      <ProofView />
    </Suspense>
  );
}

function ProofView() {
  const params = useSearchParams();
  const r = params.get("r"); // abiEncodedRequest
  const round = params.get("round");
  const tx = params.get("tx");
  const recipeId = params.get("recipe");

  const [status, setStatus] = useState<"loading" | "ok" | "invalid" | "error">(
    "loading"
  );
  const [valid, setValid] = useState<boolean | null>(null);
  const [attested, setAttested] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const explorerBase = coston2.blockExplorers!.default.url;
  const recipe = recipeById(recipeId);

  const reverify = useCallback(async () => {
    if (!r || round === null) {
      setStatus("error");
      setErr("This proof link is missing its request data.");
      return;
    }
    setStatus("loading");
    setErr(null);
    try {
      // 1) Re-fetch the Merkle proof from Flare's Data Availability layer.
      const proofRes = await fetch("/api/proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ votingRoundId: Number(round), requestBytes: r }),
      });
      const proofJson = await proofRes.json();
      if (!proofRes.ok) throw new Error(proofJson.error ?? "proof fetch failed");
      if (proofJson.pending) throw new Error("Round not finalized yet — try again shortly.");

      // 2) Re-run the on-chain verification. This is the trust anchor: the
      //    viewer's own request proves the data against Flare, not our word.
      const verifyRes = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: proofJson.proof }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyJson.error ?? "verify failed");

      setValid(verifyJson.valid);
      if (verifyJson.attested) setAttested(verifyJson.attested);
      setStatus(verifyJson.valid ? "ok" : "invalid");
    } catch (e: any) {
      setStatus("error");
      setErr(e?.message ?? "Could not re-verify this proof.");
    }
  }, [r, round]);

  useEffect(() => {
    reverify();
  }, [reverify]);

  return (
    <div className="wrap">
      <div className="bg-orbs" aria-hidden>
        <span />
        <span />
      </div>

      <header className="hero">
        <span className="pill">Flare Data Connector · verified proof</span>
        <h1>
          A fact, <span className="grad">proven</span>.
        </h1>
        <p>
          This proof is being re-verified <strong>right now, in your browser</strong>,
          against the Flare Data Connector on Coston2. Nothing here is taken on trust —
          the check below runs live against the chain.
        </p>
      </header>

      {status === "error" ? (
        <div className="alert err">⚠ {err}</div>
      ) : (
        <ProofCard
          recipeId={recipeId}
          sourceName={recipe?.sourceName}
          attested={attested}
          txHash={tx}
          votingRoundId={round !== null ? Number(round) : null}
          valid={valid}
          verifying={status === "loading"}
          explorerBase={explorerBase}
        />
      )}

      <div className="reverify-row">
        <button className="btn ghost" onClick={reverify} disabled={status === "loading"}>
          {status === "loading" && <span className="spin" />} Re-verify against Flare
        </button>
        <Link className="btn" href="/">
          Prove your own fact →
        </Link>
      </div>

      <footer>
        Powered by the{" "}
        <a href="https://dev.flare.network/fdc/overview" target="_blank" rel="noreferrer">
          Flare Data Connector
        </a>
        .
      </footer>
    </div>
  );
}
