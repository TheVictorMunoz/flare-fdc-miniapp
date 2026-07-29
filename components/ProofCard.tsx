"use client";

import { formatHeadline, recipeById } from "@/lib/recipes";

export interface ProofCardProps {
  recipeId?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  attested?: Record<string, string> | null;
  txHash?: string | null;
  votingRoundId?: number | null;
  valid: boolean | null; // null while unknown
  verifying?: boolean; // re-verifying against chain
  explorerBase: string;
  network?: string;
  /** When present, renders a Share button. */
  shareUrl?: string | null;
  onShare?: () => void;
  copied?: boolean;
}

export default function ProofCard({
  recipeId,
  sourceName,
  sourceUrl,
  attested,
  txHash,
  votingRoundId,
  valid,
  verifying,
  explorerBase,
  network = "Coston2",
  shareUrl,
  onShare,
  copied,
}: ProofCardProps) {
  const recipe = recipeById(recipeId);
  const head = formatHeadline(recipeId, attested);
  const emoji = recipe?.emoji ?? "✦";
  const isCustom = !recipe || recipe.id === "custom";
  const title = isCustom ? "Custom attestation" : recipe.title;

  const state = verifying
    ? "verifying"
    : valid === true
    ? "valid"
    : valid === false
    ? "invalid"
    : "unknown";

  const fields = attested
    ? Object.entries(attested).filter(([, v]) => v !== undefined && v !== null)
    : [];

  return (
    <div className={`proofcard ${state}`}>
      <div className="pc-glow" aria-hidden />
      <div className="pc-top">
        <div className="pc-source">
          <span className="pc-emoji">{emoji}</span>
          <div>
            <div className="pc-title">{title}</div>
            <div className="pc-sub">
              via{" "}
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noreferrer">
                  {sourceName ?? "public API"}
                </a>
              ) : (
                sourceName ?? "public API"
              )}
            </div>
          </div>
        </div>
        <div className={`pc-stamp ${state}`}>
          {state === "verifying" && (
            <>
              <span className="spin" /> Verifying…
            </>
          )}
          {state === "valid" && <>✓ Verified on-chain</>}
          {state === "invalid" && <>✗ Not valid</>}
          {state === "unknown" && <>Awaiting verification</>}
        </div>
      </div>

      {isCustom && fields.length > 0 ? (
        <div className="pc-fields pc-fields-all">
          {fields.map(([k, v]) => (
            <div className="pc-field" key={k}>
              <span className="pc-field-k">{k}</span>
              <span className="pc-field-v">{String(v)}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="pc-headline">
            <div className="pc-value">{head.value}</div>
            <div className="pc-label">{head.label}</div>
          </div>

          {fields.length > 1 && (
            <div className="pc-fields">
              {fields.map(([k, v]) => (
                <div className="pc-chip" key={k}>
                  <span className="pc-chip-k">{k}</span>
                  <span className="pc-chip-v">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="pc-meta">
        <div className="pc-meta-row">
          <span>Network</span>
          <b>{network}</b>
        </div>
        {votingRoundId !== null && votingRoundId !== undefined && (
          <div className="pc-meta-row">
            <span>Voting round</span>
            <b>#{votingRoundId}</b>
          </div>
        )}
        {txHash && (
          <div className="pc-meta-row">
            <span>Request tx</span>
            <a href={`${explorerBase}/tx/${txHash}`} target="_blank" rel="noreferrer">
              {txHash.slice(0, 10)}…{txHash.slice(-8)}
            </a>
          </div>
        )}
      </div>

      <div className="pc-foot">
        <span className="pc-flare">
          <span className="pc-dot" /> Secured by the Flare Data Connector
        </span>
        {shareUrl && onShare && (
          <button className="pc-share" onClick={onShare}>
            {copied ? "Link copied ✓" : "Share proof"}
          </button>
        )}
      </div>
    </div>
  );
}
