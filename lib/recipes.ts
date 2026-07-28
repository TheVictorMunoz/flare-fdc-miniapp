// ---------------------------------------------------------------------------
// Recipes — curated one-click "prove a real-world fact" presets.
//
// Each recipe is a ready-to-run FDC Web2Json request against a public JSON API
// (no API key needed by the source), plus display metadata so the UI can show
// a human headline instead of a raw struct. Selecting a recipe fills the
// request editor; you can still tweak any field ("Advanced") before proving.
//
// IMPORTANT — verified against the live Coston2 Web2Json verifier:
//   * The verifier's jq engine does NOT support `floor`/`round`, and raw
//     floats fail ABI encoding. So numeric values are attested as STRINGS
//     (or `tostring`'d) and formatted for display here; naturally-integer
//     values may use uint256 directly.
//   * The verifier can reach coinbase.com, open-meteo.com, npmjs.org and
//     swapi.info, but NOT frankfurter.app or api.github.com ("FETCH ERROR").
// Every recipe below has been confirmed to pass `prepareRequest` live.
// ---------------------------------------------------------------------------

export interface Web2Request {
  url: string;
  httpMethod: string;
  headers: string; // JSON string
  queryParams: string; // JSON string
  body: string; // JSON string
  postProcessJq: string;
  abiSignature: string; // a single Solidity tuple component, JSON-encoded
}

export interface Recipe {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  category: "Markets" | "Dev" | "World" | "Fun";
  sourceName: string;
  request: Web2Request;
  /** Turn the decoded attested fields into a big human headline for the card. */
  headline: (f: Record<string, string>) => { value: string; label: string };
}

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

function money(v: string | undefined, currency = "$"): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "—");
  return `${currency}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const RECIPES: Recipe[] = [
  {
    id: "btc",
    emoji: "₿",
    title: "Bitcoin price",
    subtitle: "Live BTC/USD spot, attested on-chain",
    category: "Markets",
    sourceName: "Coinbase",
    request: {
      url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
      httpMethod: "GET",
      headers: "{}",
      queryParams: "{}",
      body: "{}",
      postProcessJq: "{price: .data.amount}",
      abiSignature: tuple([{ name: "price", type: "string" }]),
    },
    headline: (f) => ({ value: money(f.price), label: "1 BTC in USD" }),
  },
  {
    id: "eth",
    emoji: "Ξ",
    title: "Ethereum price",
    subtitle: "Live ETH/USD spot, attested on-chain",
    category: "Markets",
    sourceName: "Coinbase",
    request: {
      url: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
      httpMethod: "GET",
      headers: "{}",
      queryParams: "{}",
      body: "{}",
      postProcessJq: "{price: .data.amount}",
      abiSignature: tuple([{ name: "price", type: "string" }]),
    },
    headline: (f) => ({ value: money(f.price), label: "1 ETH in USD" }),
  },
  {
    id: "fx",
    emoji: "💱",
    title: "USD → EUR rate",
    subtitle: "Reference FX rate, attested on-chain",
    category: "Markets",
    sourceName: "Coinbase",
    request: {
      url: "https://api.coinbase.com/v2/exchange-rates",
      httpMethod: "GET",
      headers: "{}",
      queryParams: '{"currency":"USD"}',
      body: "{}",
      postProcessJq: "{eur: .data.rates.EUR}",
      abiSignature: tuple([{ name: "eur", type: "string" }]),
    },
    headline: (f) => {
      const n = Number(f.eur);
      return {
        value: Number.isFinite(n) ? `€${n.toFixed(4)}` : String(f.eur ?? "—"),
        label: "1 USD in EUR",
      };
    },
  },
  {
    id: "weather",
    emoji: "🌡️",
    title: "Berlin temperature",
    subtitle: "Current temp from a live weather API",
    category: "World",
    sourceName: "Open-Meteo",
    request: {
      url: "https://api.open-meteo.com/v1/forecast",
      httpMethod: "GET",
      headers: "{}",
      queryParams:
        '{"latitude":"52.52","longitude":"13.41","current":"temperature_2m"}',
      body: "{}",
      postProcessJq: "{tempC: (.current.temperature_2m | tostring)}",
      abiSignature: tuple([{ name: "tempC", type: "string" }]),
    },
    headline: (f) => ({
      value: `${f.tempC ?? "—"}°C`,
      label: "Berlin, right now",
    }),
  },
  {
    id: "npm",
    emoji: "📦",
    title: "npm weekly installs",
    subtitle: "Downloads of `next` in the last 7 days",
    category: "Dev",
    sourceName: "npm registry",
    request: {
      url: "https://api.npmjs.org/downloads/point/last-week/next",
      httpMethod: "GET",
      headers: "{}",
      queryParams: "{}",
      body: "{}",
      postProcessJq: "{weeklyDownloads: .downloads}",
      abiSignature: tuple([{ name: "weeklyDownloads", type: "uint256" }]),
    },
    headline: (f) => {
      const n = Number(f.weeklyDownloads);
      return {
        value: Number.isFinite(n) ? n.toLocaleString() : String(f.weeklyDownloads ?? "—"),
        label: "downloads of next / week",
      };
    },
  },
  {
    id: "swapi",
    emoji: "🪐",
    title: "Star Wars character",
    subtitle: "The canonical FDC example — a fun fact on-chain",
    category: "Fun",
    sourceName: "SWAPI",
    request: {
      url: "https://swapi.info/api/people/3",
      httpMethod: "GET",
      headers: "{}",
      queryParams: "{}",
      body: "{}",
      postProcessJq:
        '{name: .name, height: .height, mass: .mass, numberOfFilms: .films | length, uid: (.url | split("/") | .[-1] | tonumber)}',
      abiSignature: tuple([
        { name: "name", type: "string" },
        { name: "height", type: "uint256" },
        { name: "mass", type: "uint256" },
        { name: "numberOfFilms", type: "uint256" },
        { name: "uid", type: "uint256" },
      ]),
    },
    headline: (f) => ({
      value: String(f.name || "—"),
      label: `appears in ${Number(f.numberOfFilms) || 0} films`,
    }),
  },
];

export function recipeById(id: string | null | undefined): Recipe | undefined {
  return id ? RECIPES.find((r) => r.id === id) : undefined;
}

/** Format a headline for a known recipe, or a graceful fallback for custom requests. */
export function formatHeadline(
  recipeId: string | null | undefined,
  fields: Record<string, string> | null | undefined
): { value: string; label: string } {
  const recipe = recipeById(recipeId);
  if (recipe && fields) {
    try {
      return recipe.headline(fields);
    } catch {
      /* fall through */
    }
  }
  if (fields) {
    const keys = Object.keys(fields);
    if (keys.length) {
      return { value: String(fields[keys[0]]), label: keys[0] };
    }
  }
  return { value: "Verified", label: "attested value" };
}
