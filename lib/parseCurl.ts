/**
 * Parse a browser/DevTools-style `curl` command into Web2Json request fields.
 * Query params are split out of the URL so `validateUrl` accepts the result.
 */

export interface ParsedCurl {
  url: string;
  httpMethod: string;
  headers: string;
  queryParams: string;
  body: string;
}

const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/** Flags that take no argument and can be ignored. */
const NOISE_FLAGS = new Set([
  "-s",
  "-S",
  "--silent",
  "--show-error",
  "-L",
  "--location",
  "-v",
  "--verbose",
  "-k",
  "--insecure",
  "-i",
  "--include",
  "-I",
  "--head",
  "-f",
  "--fail",
  "-n",
  "--netrc",
  "-N",
  "--no-buffer",
  "--compressed",
  "--http1.1",
  "--http2",
  "--http2-prior-knowledge",
  "--raw",
  "--globoff",
  "-g",
  "--path-as-is",
  "-#",
  "--progress-bar",
  "-4",
  "-6",
  "--ipv4",
  "--ipv6",
]);

/** Flags that take one argument and can be ignored. */
const NOISE_FLAGS_WITH_ARG = new Set([
  "-o",
  "--output",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "-m",
  "--max-time",
  "--connect-timeout",
  "--retry",
  "--retry-delay",
  "-w",
  "--write-out",
  "--proxy",
  "-x",
  "-u",
  "--user",
  "-b",
  "--cookie",
  "-c",
  "--cookie-jar",
  "--cert",
  "--key",
  "--cacert",
  "--capath",
  "-E",
  "--cert-type",
  "--key-type",
  "-Y",
  "--speed-limit",
  "-y",
  "--speed-time",
  "--max-redirs",
  "--limit-rate",
  "-P",
  "--ftp-port",
  "--interface",
  "--resolve",
  "--connect-to",
  "--proto",
  "--proto-redir",
  "-K",
  "--config",
]);

/**
 * Tokenize a curl command string: handles quotes, escapes, and line
 * continuations (`\` before newline).
 */
export function tokenizeCurl(input: string): string[] {
  const cleaned = input.replace(/\\\r?\n/g, " ").trim();
  if (!cleaned) return [];

  const tokens: string[] = [];
  let i = 0;
  const n = cleaned.length;

  while (i < n) {
    while (i < n && /\s/.test(cleaned[i])) i++;
    if (i >= n) break;

    const c = cleaned[i];
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      let value = "";
      while (i < n) {
        if (cleaned[i] === "\\" && quote === '"' && i + 1 < n) {
          value += cleaned[i + 1];
          i += 2;
          continue;
        }
        if (cleaned[i] === quote) {
          i++;
          break;
        }
        value += cleaned[i];
        i++;
      }
      tokens.push(value);
      continue;
    }

    let value = "";
    while (i < n && !/\s/.test(cleaned[i])) {
      if (cleaned[i] === "\\" && i + 1 < n) {
        value += cleaned[i + 1];
        i += 2;
        continue;
      }
      value += cleaned[i];
      i++;
    }
    tokens.push(value);
  }

  return tokens;
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function parseHeader(raw: string): { name: string; value: string } | null {
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  const name = raw.slice(0, idx).trim();
  const value = raw.slice(idx + 1).trim();
  if (!name) return null;
  return { name, value };
}

function parseBody(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "{}";

  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed);
  } catch {
    /* fall through */
  }

  // application/x-www-form-urlencoded → JSON object of strings
  if (/^[^=&]+=/.test(trimmed) || trimmed.includes("=")) {
    const obj: Record<string, string> = {};
    const params = new URLSearchParams(trimmed);
    let any = false;
    params.forEach((value, key) => {
      any = true;
      obj[key] = value;
    });
    if (any) return JSON.stringify(obj);
  }

  throw new Error(
    "Request body is not JSON or form-urlencoded. Paste a curl with a JSON body, or fill Body manually."
  );
}

function mergeQuery(
  fromUrl: Record<string, string>,
  fromData: Record<string, string>
): string {
  const merged = { ...fromUrl, ...fromData };
  return JSON.stringify(merged);
}

/**
 * Parse a curl command into Web2Json HTTP fields.
 * Throws Error with a short user-facing message on failure.
 */
export function parseCurl(input: string): ParsedCurl {
  const tokens = tokenizeCurl(input);
  if (!tokens.length) {
    throw new Error("Paste a curl command first.");
  }

  let start = 0;
  const first = tokens[0].toLowerCase();
  if (first === "curl" || first === "curl.exe") {
    start = 1;
  }

  let urlRaw: string | null = null;
  let method: string | null = null;
  let getMode = false; // -G: treat data as query params
  const headers: Record<string, string> = {};
  const dataChunks: string[] = [];
  const queryFromData: Record<string, string> = {};
  let jsonBody: string | null = null;

  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];

    if (NOISE_FLAGS.has(t)) continue;

    if (NOISE_FLAGS_WITH_ARG.has(t)) {
      i++; // skip argument
      continue;
    }

    // Combined short flags like -sSL — treat as noise if no known data flags
    if (/^-[a-zA-Z]+$/.test(t) && !t.startsWith("--") && t.length > 2) {
      const chars = t.slice(1).split("");
      // Only skip if all chars are known silent-style flags
      const allNoise = chars.every((ch) =>
        NOISE_FLAGS.has(`-${ch}`) || ch === "s" || ch === "S" || ch === "L" || ch === "v" || ch === "k" || ch === "i" || ch === "f"
      );
      if (allNoise) continue;
    }

    if (t === "-X" || t === "--request") {
      const next = tokens[++i];
      if (!next) throw new Error("Missing method after -X / --request.");
      method = next.toUpperCase();
      continue;
    }

    if (t === "--url") {
      const next = tokens[++i];
      if (!next) throw new Error("Missing URL after --url.");
      urlRaw = next;
      continue;
    }

    if (t === "-H" || t === "--header") {
      const next = tokens[++i];
      if (!next) throw new Error("Missing value after -H / --header.");
      const h = parseHeader(next);
      if (h) headers[h.name] = h.value;
      continue;
    }

    if (
      t === "-d" ||
      t === "--data" ||
      t === "--data-raw" ||
      t === "--data-binary" ||
      t === "--data-ascii" ||
      t === "--data-urlencode"
    ) {
      const next = tokens[++i];
      if (next === undefined) throw new Error(`Missing value after ${t}.`);
      // --data-urlencode accepts name=value or =value or @file; take name=value as-is
      dataChunks.push(next.startsWith("=") ? next.slice(1) : next);
      continue;
    }

    if (t === "--json") {
      const next = tokens[++i];
      if (next === undefined) throw new Error("Missing value after --json.");
      jsonBody = next;
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
      if (!headers["Accept"] && !headers["accept"]) {
        headers["Accept"] = "application/json";
      }
      continue;
    }

    if (t === "-G" || t === "--get") {
      getMode = true;
      continue;
    }

    // Long options with = form: --url=https://...
    if (t.startsWith("--url=")) {
      urlRaw = t.slice("--url=".length);
      continue;
    }
    if (t.startsWith("--request=")) {
      method = t.slice("--request=".length).toUpperCase();
      continue;
    }
    if (t.startsWith("--header=")) {
      const h = parseHeader(t.slice("--header=".length));
      if (h) headers[h.name] = h.value;
      continue;
    }
    if (
      t.startsWith("--data=") ||
      t.startsWith("--data-raw=") ||
      t.startsWith("--data-binary=") ||
      t.startsWith("--data-ascii=")
    ) {
      const eq = t.indexOf("=");
      dataChunks.push(t.slice(eq + 1));
      continue;
    }
    if (t.startsWith("--json=")) {
      jsonBody = t.slice("--json=".length);
      continue;
    }

    // Unknown long/short options with args we don't care about — skip if next
    // looks like a value (not a flag/url)
    if (t.startsWith("--") && !looksLikeUrl(t)) {
      const next = tokens[i + 1];
      if (next && !next.startsWith("-") && !looksLikeUrl(next)) {
        i++;
      }
      continue;
    }
    if (/^-[a-zA-Z]$/.test(t)) {
      const next = tokens[i + 1];
      if (next && !next.startsWith("-") && !looksLikeUrl(next)) {
        i++;
      }
      continue;
    }

    if (looksLikeUrl(t) || (t.startsWith("/") && !t.startsWith("//"))) {
      if (!urlRaw) urlRaw = t;
      continue;
    }

    // Positional URL without scheme (rare) — only if nothing else claimed it
    if (!urlRaw && !t.startsWith("-") && (t.includes(".") || t.includes("/"))) {
      urlRaw = t;
    }
  }

  if (!urlRaw) {
    throw new Error("Could not find a URL in the curl command.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlRaw);
  } catch {
    throw new Error("URL in curl is not valid.");
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("URL must be http(s).");
  }

  const queryFromUrl: Record<string, string> = {};
  parsedUrl.searchParams.forEach((value, key) => {
    queryFromUrl[key] = value;
  });

  // Strip query/hash from URL for FDC validateUrl
  const cleanUrl = (() => {
    const u = new URL(urlRaw);
    u.search = "";
    u.hash = "";
    return u.toString();
  })();

  let body = "{}";
  const hasData = dataChunks.length > 0 || jsonBody !== null;

  if (jsonBody !== null) {
    body = parseBody(jsonBody);
  } else if (dataChunks.length) {
    const combined = dataChunks.join("&");
    if (getMode) {
      const params = new URLSearchParams(combined);
      params.forEach((value, key) => {
        queryFromData[key] = value;
      });
    } else {
      body = parseBody(combined);
    }
  }

  let httpMethod: string;
  if (method) {
    httpMethod = method;
  } else if (getMode) {
    httpMethod = "GET";
  } else if (hasData) {
    httpMethod = "POST";
  } else {
    httpMethod = "GET";
  }

  if (!ALLOWED_METHODS.has(httpMethod)) {
    throw new Error(
      `HTTP method "${httpMethod}" is not supported. Use GET, POST, PUT, PATCH, or DELETE.`
    );
  }

  return {
    url: cleanUrl,
    httpMethod,
    headers: JSON.stringify(headers),
    queryParams: mergeQuery(queryFromUrl, queryFromData),
    body,
  };
}
