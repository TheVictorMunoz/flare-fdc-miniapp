/** Live form validation for Advanced / Web2Json request fields. */

/**
 * The verifier requires a non-empty absolute HTTPS URL with no query-string
 * parameters embedded in it (those go in the separate `queryParams` field).
 */
export function validateUrl(value: string): string | null {
  const s = value.trim();
  if (!s) return "URL is required.";
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return "Must be a valid absolute URL (e.g. https://api.example.com/data).";
  }
  if (parsed.protocol !== "https:") {
    return "Only HTTPS URLs are accepted by the FDC verifier.";
  }
  if (parsed.search) {
    return "Move query parameters into the Query params field below — do not embed them in the URL.";
  }
  return null;
}

/**
 * Builtins the FDC Web2Json verifier rejects (not in its restricted jq subset).
 * See https://dev.flare.network/fdc/attestation-types/web2-json
 */
const UNSUPPORTED_JQ = [
  "floor",
  "ceil",
  "round",
  "sqrt",
  "fabs",
  "reduce",
  "recurse",
  "inputs",
  "foreach",
  "while",
  "until",
  "walk",
];

/**
 * postProcessJq is a jq filter (not JSON). We can't fully parse jq in the
 * browser, so we check the shape FDC recipes use: a non-empty object
 * constructor with balanced delimiters, plus a few known-unsupported builtins.
 */
export function validatePostProcessJq(expr: string): string | null {
  const s = expr.trim();
  if (!s) return "Required — write a jq expression that returns an object.";
  if (!s.startsWith("{") || !s.endsWith("}")) {
    return "Should return a jq object, e.g. {field: .path}";
  }
  const bal = balancedDelimiters(s);
  if (bal) return bal;
  for (const name of UNSUPPORTED_JQ) {
    // Match as a jq identifier / builtin call, not as a substring of a field name.
    if (new RegExp(`(?:^|[^\\w.])${name}\\b`).test(s)) {
      return `FDC jq subset does not support \`${name}\`. Truncate with tostring | split(".")[0] | tonumber instead of floor.`;
    }
  }
  return null;
}

export function validateJsonField(label: string, value: string): string | null {
  const s = value.trim();
  if (!s) return `${label} is required.`;
  try {
    JSON.parse(s);
    return null;
  } catch {
    return `${label} must be valid JSON.`;
  }
}

/** FDC Web2Json verifier rejects >15 header entries (`INVALID: INVALID HEADERS`). */
const MAX_WEB2JSON_HEADERS = 15;

/**
 * Headers must be a JSON object of string→string (or string→number/bool coerced
 * by the verifier). Cap entry count to the verifier limit.
 */
export function validateHeaders(value: string): string | null {
  const jsonErr = validateJsonField("Headers", value);
  if (jsonErr) return jsonErr;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim());
  } catch {
    return "Headers must be valid JSON.";
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return 'Headers must be a JSON object, e.g. {"Accept":"application/json"}.';
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  for (const [k, v] of entries) {
    if (!k.trim()) return "Header names must be non-empty.";
    if (v !== null && typeof v === "object") {
      return `Header "${k}" must be a string (or number/boolean), not an object.`;
    }
  }

  if (entries.length > MAX_WEB2JSON_HEADERS) {
    return `Too many headers (${entries.length}). The FDC verifier allows at most ${MAX_WEB2JSON_HEADERS} — remove browser chrome (sec-*, origin, referer, user-agent) and keep only what the API needs.`;
  }

  return null;
}

/**
 * abiSignature is a JSON-encoded Solidity ABI tuple component — the schema
 * for the object returned by postProcessJq. Shape:
 *   { "components": [{ "name", "type", "internalType"? }], "name": "task", "type": "tuple" }
 */
export function validateAbiSignature(value: string): string | null {
  const s = value.trim();
  if (!s) return "Required — declare the Solidity tuple for the jq result.";

  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return "Must be valid JSON describing a Solidity ABI tuple.";
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return 'Expected an object like {"components":[...],"name":"task","type":"tuple"}.';
  }

  const sig = parsed as Record<string, unknown>;
  if (sig.type !== "tuple") {
    return 'Top-level "type" must be "tuple".';
  }
  if (typeof sig.name !== "string" || !sig.name.trim()) {
    return 'Missing tuple "name" (e.g. "task").';
  }
  if (!Array.isArray(sig.components) || sig.components.length === 0) {
    return '"components" must be a non-empty array of fields.';
  }

  const names = new Set<string>();
  for (let i = 0; i < sig.components.length; i++) {
    const c = sig.components[i];
    const label = `components[${i}]`;
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      return `${label} must be an object with name and type.`;
    }
    const comp = c as Record<string, unknown>;
    if (typeof comp.name !== "string" || !comp.name.trim()) {
      return `${label} needs a non-empty "name".`;
    }
    if (names.has(comp.name)) {
      return `Duplicate field name "${comp.name}".`;
    }
    names.add(comp.name);
    if (typeof comp.type !== "string" || !comp.type.trim()) {
      return `${label} ("${comp.name}") needs a Solidity "type".`;
    }
    if (!isSolidityAbiType(comp.type)) {
      return `${label} ("${comp.name}") has invalid Solidity type "${comp.type}".`;
    }
    if (
      comp.internalType !== undefined &&
      typeof comp.internalType !== "string"
    ) {
      return `${label} ("${comp.name}") "internalType" must be a string.`;
    }
  }

  return null;
}

/** Elementary Solidity ABI types, optionally with fixed/dynamic arrays. */
const SOLIDITY_BASE =
  /^(address|bool|string|bytes|bytes(?:[1-9]|[12]\d|3[0-2])|u?int(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256))$/;

function isSolidityAbiType(type: string): boolean {
  let t = type;
  // Strip trailing [] or [N] array suffixes
  while (/\[\d*\]$/.test(t)) {
    t = t.replace(/\[\d*\]$/, "");
  }
  return SOLIDITY_BASE.test(t);
}

function balancedDelimiters(s: string): string | null {
  const stack: string[] = [];
  const open: Record<string, string> = { "{": "}", "[": "]", "(": ")" };
  const close: Record<string, string> = { "}": "{", "]": "[", ")": "(" };
  let inString: '"' | "'" | null = null;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if (c in open) {
      stack.push(c);
      continue;
    }
    if (c in close) {
      const expected = close[c];
      if (stack.pop() !== expected) {
        return `Unbalanced ${c} in jq expression.`;
      }
    }
  }
  if (inString) return "Unterminated string in jq expression.";
  if (stack.length) return `Unbalanced ${stack[stack.length - 1]} in jq expression.`;
  return null;
}
