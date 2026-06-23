// Satori shapes text into vector <path>s using real font data, so every
// collateral SVG it emits is self-contained (no installed fonts needed to view
// or rasterize it). That means we must hand Satori actual font bytes for the
// brand's chosen Google Font families at render time.
//
// Google Fonts serves WOFF2 to modern user-agents, but Satori's font parser
// only reads TTF/OTF/WOFF — so we request the css2 stylesheet with a legacy
// user-agent, which makes Google return TTF URLs. Fetched bytes are cached for
// the lifetime of the (warm) process so repeated renders don't re-download.

export type SatoriFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
};

// A user-agent old enough that Google Fonts serves TTF rather than WOFF2.
const LEGACY_UA =
  "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko)";

const fontCache = new Map<string, ArrayBuffer>();

async function fetchGoogleFontTtf(
  family: string,
  weight: number
): Promise<ArrayBuffer> {
  const cacheKey = `${family}:${weight}`;
  const cached = fontCache.get(cacheKey);
  if (cached) return cached;

  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family
  )}:wght@${weight}`;
  const cssRes = await fetch(cssUrl, { headers: { "User-Agent": LEGACY_UA } });
  if (!cssRes.ok) {
    throw new Error(`Google Fonts CSS fetch failed for ${family} (${cssRes.status})`);
  }
  const css = await cssRes.text();
  const match = css.match(/src:\s*url\(([^)]+\.ttf)\)/);
  if (!match) {
    throw new Error(`No TTF url found for ${family}:${weight}`);
  }
  const fontRes = await fetch(match[1]);
  if (!fontRes.ok) {
    throw new Error(`Font file fetch failed for ${family} (${fontRes.status})`);
  }
  const data = await fontRes.arrayBuffer();
  fontCache.set(cacheKey, data);
  return data;
}

// Inter is our guaranteed fallback family — if a brand's chosen font can't be
// fetched, we still render with a sane, legible face rather than failing.
const FALLBACK_FAMILY = "Inter";

async function loadFamilyWeight(
  family: string,
  weight: 400 | 500 | 600 | 700
): Promise<SatoriFont> {
  try {
    const data = await fetchGoogleFontTtf(family, weight);
    return { name: family, data, weight, style: "normal" };
  } catch {
    const data = await fetchGoogleFontTtf(FALLBACK_FAMILY, weight);
    // Keep the requested family NAME so Satori still matches it in styles; the
    // fallback bytes just provide the glyph shapes.
    return { name: family, data, weight, style: "normal" };
  }
}

/**
 * Load the Satori font set for a heading + body family. We pull a regular (400)
 * and bold (700) weight for each so templates can vary emphasis. Runs the four
 * fetches concurrently; results are process-cached.
 */
export async function loadBrandFonts(
  headingFamily: string,
  bodyFamily: string
): Promise<SatoriFont[]> {
  const [headingRegular, headingBold, bodyRegular, bodyBold] = await Promise.all([
    loadFamilyWeight(headingFamily, 400),
    loadFamilyWeight(headingFamily, 700),
    loadFamilyWeight(bodyFamily, 400),
    loadFamilyWeight(bodyFamily, 700),
  ]);
  // De-dupe when heading and body are the same family.
  const seen = new Set<string>();
  return [headingRegular, headingBold, bodyRegular, bodyBold].filter((f) => {
    const key = `${f.name}:${f.weight}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
