// ---------------------------------------------------------------------------
// Recipes — curated one-click "prove a real-world fact" presets.
//
// Each recipe is a ready-to-run FDC Web2Json request against a public JSON API
// (no API key needed by the source), plus display metadata so the UI can show
// a human headline instead of a raw struct. Selecting a recipe fills the
// request editor; you can still tweak any field ("Advanced") before proving.
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

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const RECIPES: Recipe[] = [
  {
    id: "btc",
    emoji: "₿",
    title: "Bitcoin price",
    subtitle: "Live BTC/USD spot, attested on-chain",
    category: "Markets",
    sourceName: "CoinGecko",
    request: {
      url: "https://api.coingecko.com/api/v3/simple/price",
      httpMethod: "GET",
      headers: "{}",
      queryParams: '{"ids":"bitcoin","vs_currencies":"usd"}',
      body: "{}",
      postProcessJq: "{priceUsdCents: (.bitcoin.usd * 100 | floor)}",
      abiSignature: tuple([{ name: "priceUsdCents", type: "uint256" }]),
    },
    headline: (f) => ({
      value: `$${(num(f.priceUsdCents) / 100).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })}`,
      label: "1 BTC in USD",
    }),
  },
  {
    id: "eth",
    emoji: "Ξ",
    title: "Ethereum price",
    subtitle: "Live ETH/USD spot, attested on-chain",
    category: "Markets",
    sourceName: "CoinGecko",
    request: {
      url: "https://api.coingecko.com/api/v3/simple/price",
      httpMethod: "GET",
      headers: "{}",
      queryParams: '{"ids":"ethereum","vs_currencies":"usd"}',
      body: "{}",
      postProcessJq: "{priceUsdCents: (.ethereum.usd * 100 | floor)}",
      abiSignature: tuple([{ name: "priceUsdCents", type: "uint256" }]),
    },
    headline: (f) => ({
      value: `$${(num(f.priceUsdCents) / 100).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })}`,
      label: "1 ETH in USD",
    }),
  },
  {
    id: "fx",
    emoji: "💱",
    title: "USD → EUR rate",
    subtitle: "Reference FX rate, attested on-chain",
    category: "Markets",
    sourceName: "Frankfurter (ECB)",
    request: {
      url: "https://api.frankfurter.app/latest",
      httpMethod: "GET",
      headers: "{}",
      queryParams: '{"from":"USD","to":"EUR"}',
      body: "{}",
      postProcessJq: "{eurPerUsd1e6: (.rates.EUR * 1000000 | floor)}",
      abiSignature: tuple([{ name: "eurPerUsd1e6", type: "uint256" }]),
    },
    headline: (f) => ({
      value: `€${(num(f.eurPerUsd1e6) / 1e6).toFixed(4)}`,
      label: "1 USD in EUR",
    }),
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
      postProcessJq: "{tempCentiC: (.current.temperature_2m * 100 | floor)}",
      abiSignature: tuple([{ name: "tempCentiC", type: "int256" }]),
    },
    headline: (f) => ({
      value: `${(num(f.tempCentiC) / 100).toFixed(1)}°C`,
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
    headline: (f) => ({
      value: num(f.weeklyDownloads).toLocaleString(),
      label: "downloads of next / week",
    }),
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
      label: `appears in ${num(f.numberOfFilms)} films`,
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
