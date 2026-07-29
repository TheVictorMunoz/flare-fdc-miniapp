/**
 * Infer a Web2Json postProcessJq + abiSignature pair from a sample JSON
 * response. Picks scalar leaves (and array lengths) so the result is a flat
 * object FDC can ABI-encode.
 */

export interface InferredAttestation {
  postProcessJq: string;
  abiSignature: string;
}

interface Field {
  name: string;
  /** jq expression that yields the value (no surrounding key) */
  jqExpr: string;
  type: string;
}

const MAX_FIELDS = 8;
const MAX_DEPTH = 4;

function tuple(components: Array<{ name: string; type: string }>): string {
  return JSON.stringify({
    components: components.map((c) => ({
      internalType: c.type,
      name: c.name,
      type: c.type,
    })),
    name: "task",
    type: "tuple",
  });
}

/** Turn ["bitcoin","usd"] into a camelCase field name. Skip array indices. */
function pathToName(path: string[]): string {
  const parts = path
    .filter((p) => !/^\d+$/.test(p))
    .map((p) => p.replace(/[^a-zA-Z0-9_]/g, "_"));
  if (!parts.length) return "value";
  return parts
    .map((p, i) => {
      if (!p) return i === 0 ? "field" : "";
      if (i === 0) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .filter(Boolean)
    .join("")
    .replace(/^[^a-zA-Z_]/, "f")
    .slice(0, 48) || "value";
}

/** jq path like .bitcoin.usd, .["odd-key"], or .[0].name */
function pathToJq(path: string[]): string {
  if (!path.length) return ".";
  let s = "";
  for (const p of path) {
    if (/^\d+$/.test(p)) {
      s += `[${p}]`;
    } else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p)) {
      s += "." + p;
    } else {
      s += `["${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
    }
  }
  // Root array / odd-key access must be `.[0]` / `.["k"]` — bare `[0]` is a jq parse error.
  if (s.startsWith("[")) return "." + s;
  return s || ".";
}

function uniquify(name: string, used: Set<string>): string {
  let n = name;
  let i = 2;
  while (used.has(n)) {
    n = `${name}${i}`;
    i++;
  }
  used.add(n);
  return n;
}

function collectFields(
  value: unknown,
  path: string[],
  out: Field[],
  used: Set<string>
): void {
  if (out.length >= MAX_FIELDS) return;
  if (path.length > MAX_DEPTH) return;

  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    if (path.length === 0) {
      // Root array — attest length only
      out.push({
        name: uniquify("count", used),
        jqExpr: "length",
        type: "uint256",
      });
      if (value.length && typeof value[0] === "object" && value[0] !== null) {
        collectFields(value[0], ["0"], out, used);
      }
      return;
    }
    out.push({
      name: uniquify(pathToName([...path, "count"]), used),
      jqExpr: `(${pathToJq(path)} | length)`,
      type: "uint256",
    });
    return;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    for (const key of keys) {
      if (out.length >= MAX_FIELDS) break;
      collectFields(obj[key], [...path, key], out, used);
    }
    return;
  }

  if (typeof value === "boolean") {
    out.push({
      name: uniquify(pathToName(path), used),
      jqExpr: pathToJq(path),
      type: "bool",
    });
    return;
  }

  if (typeof value === "number") {
    const name = uniquify(pathToName(path), used);
    const jqPath = pathToJq(path);
    if (Number.isInteger(value)) {
      out.push({
        name,
        jqExpr: jqPath,
        type: value < 0 ? "int256" : "uint256",
      });
    } else {
      // FDC jq has no floor — truncate via tostring/split/tonumber (×1e6).
      out.push({
        name: uniquify(name.endsWith("1e6") ? name : `${name}1e6`, used),
        jqExpr: `((${jqPath} * 1000000) | tostring | split(".")[0] | tonumber)`,
        type: value < 0 ? "int256" : "uint256",
      });
    }
    return;
  }

  if (typeof value === "string") {
    // Numeric strings → uint256 when safe
    if (/^-?\d+$/.test(value) && value.length < 78) {
      const n = Number(value);
      out.push({
        name: uniquify(pathToName(path), used),
        jqExpr: `(${pathToJq(path)} | tonumber)`,
        type: n < 0 ? "int256" : "uint256",
      });
      return;
    }
    out.push({
      name: uniquify(pathToName(path), used),
      jqExpr: pathToJq(path),
      type: "string",
    });
  }
}

/**
 * Build postProcessJq + abiSignature from a parsed JSON response sample.
 * Falls back to a single string field if nothing useful is found.
 */
export function inferAttestationFromJson(data: unknown): InferredAttestation {
  const fields: Field[] = [];
  const used = new Set<string>();
  collectFields(data, [], fields, used);

  if (!fields.length) {
    return {
      postProcessJq: "{value: (. | tostring)}",
      abiSignature: tuple([{ name: "value", type: "string" }]),
    };
  }

  const limited = fields.slice(0, MAX_FIELDS);
  const postProcessJq =
    "{" + limited.map((f) => `${f.name}: ${f.jqExpr}`).join(", ") + "}";

  return {
    postProcessJq,
    abiSignature: tuple(limited.map((f) => ({ name: f.name, type: f.type }))),
  };
}
