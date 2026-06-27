import { createHash } from "crypto";
import {
  WebsiteCollectedInfoSchema,
  type WebsiteCollectedArticle,
  type WebsiteCollectedFact,
  type WebsiteCollectedImage,
  type WebsiteCollectedInfo,
  type WebsiteCollectedLink,
  type WebsiteCollectedListing,
  type WebsiteCollectedPriceRange,
  type WebsiteCollectedProduct,
} from "./schema";

const MAX_PAGES = 14;
const MAX_HTML_CHARS = 1_500_000;
const PAGE_TIMEOUT_MS = 7_500;
const USER_AGENT =
  "Mozilla/5.0 (compatible; EntretangleResearchBot/1.0; +https://entretangle.ai)";

const RELEVANT_PATH =
  /(product|products|collection|collections|shop|store|catalog|category|stockist|where-to-buy|press|media|news|blog|journal|about|story|lookbook)/i;

const SOCIAL_HOSTS = [
  "instagram.com",
  "facebook.com",
  "tiktok.com",
  "pinterest.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "x.com",
  "twitter.com",
];

const MARKETPLACE_HOSTS = [
  "amazon.",
  "flipkart.",
  "myntra.",
  "nykaa.",
  "ajio.",
  "tatacliq.",
  "etsy.",
  "walmart.",
  "target.",
  "meesho.",
  "shopify.",
];

const PRESS_HOSTS = [
  "timesofindia.indiatimes.com",
  "economictimes.indiatimes.com",
  "nytimes.com",
  "business-standard.com",
  "hindustantimes.com",
  "indianexpress.com",
  "livemint.com",
  "yourstory.com",
  "inc42.com",
  "entrackr.com",
  "techcrunch.com",
  "forbes.com",
  "vogue.",
  "elle.",
  "gqindia.com",
  "businessoffashion.com",
  "retail4growth.com",
  "afaqs.com",
  "exchange4media.com",
];

type RawPage = {
  url: string;
  html: string;
};

type ParsedPage = WebsiteCollectedInfo & {
  candidateLinks: string[];
};

function emptyInfo(): WebsiteCollectedInfo {
  return WebsiteCollectedInfoSchema.parse({});
}

function stableId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function normalizeInputUrl(raw: string): string {
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return new URL(withProtocol).toString();
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  return url.toString();
}

function decodeHtml(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(input: string): string {
  return decodeHtml(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function hostForUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function safeUrl(raw: string | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  const clean = decodeHtml(raw.trim());
  if (
    !clean ||
    /^(data|blob|mailto|tel|sms|javascript):/i.test(clean) ||
    clean.startsWith("#")
  ) {
    return null;
  }
  try {
    const url = new URL(clean, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function attrMap(rawAttrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rawAttrs))) {
    out[match[1].toLowerCase()] = decodeHtml(
      match[2] ?? match[3] ?? match[4] ?? ""
    ).trim();
  }
  return out;
}

function metaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])[^>]*>`,
    "i"
  );
  const tag = html.match(re)?.[0];
  if (!tag) return undefined;
  return attrMap(tag).content || undefined;
}

function titleFromHtml(html: string): string | undefined {
  const og = metaContent(html, "og:title");
  if (og) return stripTags(og);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? stripTags(title) : undefined;
}

function canonicalUrl(html: string, fallback: string): string {
  const link = html.match(
    /<link\b(?=[^>]*rel=["'][^"']*canonical[^"']*["'])[^>]*>/i
  )?.[0];
  return safeUrl(link ? attrMap(link).href : undefined, fallback) ?? fallback;
}

function firstSrcFromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  const candidates = srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
  return candidates.at(-1);
}

function isBadImageUrl(url: string): boolean {
  return (
    /\.(svg|ico)(?:[?#]|$)/i.test(url) ||
    /(sprite|placeholder|blank|loading|tracking|pixel)/i.test(url)
  );
}

function imageKind(
  url: string,
  alt: string | undefined,
  sourceUrl: string
): WebsiteCollectedImage["kind"] {
  const haystack = `${url} ${alt ?? ""} ${sourceUrl}`.toLowerCase();
  if (/(logo|brandmark|wordmark)/.test(haystack)) return "logo";
  if (/(founder|team|owner)/.test(haystack)) return "founder";
  if (/(storefront|store-front|boutique|shopfront)/.test(haystack)) {
    return "storefront";
  }
  if (/(lookbook|campaign|lifestyle|editorial)/.test(haystack)) {
    return "lifestyle";
  }
  if (
    /(product|products|collection|shop|sku|shirt|dress|tee|hoodie|jacket|saree|kurta|shoe|bag|bottle|pack|cream|serum|soap|candle)/.test(
      haystack
    )
  ) {
    return "product";
  }
  return "other";
}

function numberFromString(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function currencyFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (/₹|rs\.?|inr/i.test(text)) return "INR";
  if (/\$|usd/i.test(text)) return "USD";
  if (/£|gbp/i.test(text)) return "GBP";
  if (/€|eur/i.test(text)) return "EUR";
  return undefined;
}

function priceTextFromOffer(args: {
  price?: number;
  minPrice?: number;
  maxPrice?: number;
  currency?: string;
  raw?: unknown;
}): string | undefined {
  if (
    typeof args.raw === "string" &&
    /₹|rs\.?|inr|\$|usd|£|gbp|€|eur/i.test(args.raw)
  ) {
    return args.raw.trim();
  }
  const prefix =
    args.currency === "INR"
      ? "₹"
      : args.currency === "USD"
        ? "$"
        : args.currency === "GBP"
          ? "£"
          : args.currency === "EUR"
            ? "€"
            : args.currency
              ? `${args.currency} `
              : "";
  if (args.price != null) return `${prefix}${args.price.toLocaleString()}`;
  if (args.minPrice != null && args.maxPrice != null) {
    return `${prefix}${args.minPrice.toLocaleString()}-${prefix}${args.maxPrice.toLocaleString()}`;
  }
  return undefined;
}

function labelFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/[-_]+/g, " ");
    return path ? path.slice(0, 80) : hostForUrl(url);
  } catch {
    return "Source";
  }
}

function isSocialUrl(url: string): boolean {
  const host = hostForUrl(url);
  return SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function isMarketplaceUrl(url: string): boolean {
  const host = hostForUrl(url);
  return MARKETPLACE_HOSTS.some((h) => host.includes(h));
}

function isPressUrl(url: string): boolean {
  const host = hostForUrl(url);
  return PRESS_HOSTS.some((h) => host.includes(h));
}

function isLikelyProductPage(url: string, title?: string): boolean {
  const haystack = `${url} ${title ?? ""}`.toLowerCase();
  return /(product|products|shop|store|collections|sku|buy|p\/)/.test(haystack);
}

function pushUnique<T>(
  target: T[],
  item: T | null | undefined,
  keyFn: (item: T) => string | undefined,
  max = 80
) {
  if (!item || target.length >= max) return;
  const key = keyFn(item)?.trim().toLowerCase();
  if (!key) return;
  if (target.some((existing) => keyFn(existing)?.trim().toLowerCase() === key)) {
    return;
  }
  target.push(item);
}

function parseJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const raw = decodeHtml(match[1])
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some sites emit malformed JSON-LD. Ignore and keep the HTML signals.
    }
  }
  return out.flatMap(flattenJsonLd);
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  const graph = obj["@graph"];
  return [obj, ...flattenJsonLd(graph)];
}

function typeNames(node: Record<string, unknown>): string[] {
  const raw = node["@type"];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return stripTags(value);
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return stringValue(obj.name) ?? stringValue(obj.url) ?? stringValue(obj["@id"]);
  }
  return undefined;
}

function imageUrlsFrom(value: unknown, baseUrl: string): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    const url = safeUrl(value, baseUrl);
    return url ? [url] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => imageUrlsFrom(entry, baseUrl));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return imageUrlsFrom(obj.url ?? obj.contentUrl ?? obj["@id"], baseUrl);
  }
  return [];
}

function offerInfo(value: unknown): Pick<
  WebsiteCollectedListing,
  "currency" | "price" | "minPrice" | "maxPrice" | "priceText" | "availability"
> {
  const offers = Array.isArray(value) ? value : value ? [value] : [];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const obj = offer as Record<string, unknown>;
    const currency = stringValue(obj.priceCurrency) ?? currencyFromText(String(obj.price ?? ""));
    const price = numberFromString(obj.price);
    const minPrice = numberFromString(obj.lowPrice ?? obj.minPrice);
    const maxPrice = numberFromString(obj.highPrice ?? obj.maxPrice);
    const rawPrice = stringValue(obj.price);
    const availability = stringValue(obj.availability)
      ?.replace(/^https?:\/\/schema\.org\//i, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
    return {
      currency,
      price,
      minPrice,
      maxPrice,
      priceText: priceTextFromOffer({
        price,
        minPrice,
        maxPrice,
        currency,
        raw: rawPrice,
      }),
      availability,
    };
  }
  return {};
}

function parsePricesFromText(
  text: string,
  pageUrl: string,
  title?: string
): WebsiteCollectedPriceRange | null {
  const prices: number[] = [];
  const snippets: string[] = [];
  const re =
    /(?:₹|rs\.?|inr|\$|usd|£|gbp|€|eur)\s*([0-9][0-9,]*(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(?:₹|rs\.?|inr|\$|usd|£|gbp|€|eur)?\s*([0-9][0-9,]*(?:\.\d+)?))?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) && prices.length < 20) {
    const first = numberFromString(match[1]);
    const second = numberFromString(match[2]);
    if (first && first > 0 && first < 10_000_000) prices.push(first);
    if (second && second > 0 && second < 10_000_000) prices.push(second);
    snippets.push(match[0].replace(/\s+/g, " "));
  }
  if (!prices.length) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return {
    label: title?.slice(0, 80) || "Observed prices",
    currency: currencyFromText(snippets[0]),
    min,
    max,
    text:
      min === max
        ? snippets[0]
        : `${snippets[0]}${snippets.length > 1 ? `; ${snippets[1]}` : ""}`,
    sourceUrl: pageUrl,
    notes: "Detected on brand-site page text.",
  };
}

function parseAnchors(html: string, pageUrl: string) {
  const anchors: { url: string; label: string }[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const attrs = attrMap(match[1]);
    const url = safeUrl(attrs.href, pageUrl);
    if (!url) continue;
    anchors.push({ url, label: stripTags(match[2]) || labelFromUrl(url) });
  }
  return anchors;
}

function parseImages(
  html: string,
  pageUrl: string,
  title?: string
): WebsiteCollectedImage[] {
  const images: WebsiteCollectedImage[] = [];
  const ogImage = safeUrl(metaContent(html, "og:image"), pageUrl);
  if (ogImage && !isBadImageUrl(ogImage)) {
    images.push({
      url: ogImage,
      alt: title,
      caption: title ? `Open Graph image for ${title}` : "Open Graph image",
      sourceUrl: pageUrl,
      kind: imageKind(ogImage, title, pageUrl),
    });
  }
  const re = /<img\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && images.length < 36) {
    const attrs = attrMap(match[1]);
    const raw =
      attrs.src ||
      attrs["data-src"] ||
      attrs["data-original"] ||
      attrs["data-image"] ||
      firstSrcFromSrcset(attrs.srcset || attrs["data-srcset"]);
    const url = safeUrl(raw, pageUrl);
    if (!url || isBadImageUrl(url)) continue;
    const alt = attrs.alt || attrs.title || title;
    pushUnique(
      images,
      {
        url,
        alt,
        caption: title ? `Image found on ${title}` : "Image found on brand site",
        sourceUrl: pageUrl,
        kind: imageKind(url, alt, pageUrl),
      },
      (image) => image.url,
      36
    );
  }
  return images;
}

// Pull the brand's actual logo/wordmark so the generated site header can use
// the real mark instead of a cropped product package. Looks at header/nav logo
// <img>s (by class/id/alt, SVG allowed), the favicon <link>s, and og:logo.
// Returned with kind:"logo" and ordered best-first (header marks, then icons).
function parseBrandLogos(html: string, pageUrl: string): WebsiteCollectedImage[] {
  const out: WebsiteCollectedImage[] = [];
  const seen = new Set<string>();
  const add = (url: string | null, alt: string, caption: string) => {
    if (!url || seen.has(url)) return;
    if (/(sprite|placeholder|blank|loading|tracking|pixel)/i.test(url)) return;
    seen.add(url);
    out.push({ url, alt, caption, sourceUrl: pageUrl, kind: "logo" });
  };

  // 1. Header/nav logo images (allow SVG; match on class/id/alt, not just URL).
  const imgRe = /<img\b([^>]*)>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRe.exec(html)) && out.length < 4) {
    const attrs = attrMap(imgMatch[1]);
    const signal = `${attrs.class ?? ""} ${attrs.id ?? ""} ${attrs.alt ?? ""} ${
      attrs.title ?? ""
    }`.toLowerCase();
    if (
      !/\b(logo|brandmark|wordmark|site[-_]?logo|header[-_]?logo|nav(?:bar)?[-_]?brand|brand[-_]?logo)\b/.test(
        signal
      )
    ) {
      continue;
    }
    const raw =
      attrs.src ||
      attrs["data-src"] ||
      attrs["data-original"] ||
      firstSrcFromSrcset(attrs.srcset || attrs["data-srcset"]);
    add(safeUrl(raw, pageUrl), attrs.alt || "Brand logo", "Header logo image");
  }

  // 2. Favicon / app icons (prefer SVG mask-icon and PNG apple-touch-icon).
  const linkRe = /<link\b([^>]*)>/gi;
  let linkMatch: RegExpExecArray | null;
  const icons: { url: string; rel: string }[] = [];
  while ((linkMatch = linkRe.exec(html))) {
    const attrs = attrMap(linkMatch[1]);
    const rel = (attrs.rel ?? "").toLowerCase();
    if (!/\b(apple-touch-icon|mask-icon|shortcut|icon)\b/.test(rel)) continue;
    const url = safeUrl(attrs.href, pageUrl);
    if (url) icons.push({ url, rel });
  }
  icons
    .sort((a, b) => iconRelPriority(a.rel) - iconRelPriority(b.rel))
    .forEach((icon) => add(icon.url, "Brand favicon", `Site icon (${icon.rel})`));

  // 3. Open Graph logo, if declared.
  add(safeUrl(metaContent(html, "og:logo"), pageUrl), "Brand logo", "og:logo");

  return out;
}

function iconRelPriority(rel: string): number {
  if (/apple-touch-icon/.test(rel)) return 0;
  if (/mask-icon/.test(rel)) return 1;
  if (/shortcut/.test(rel)) return 2;
  return 3;
}

function parseJsonLdSignals(
  nodes: unknown[],
  pageUrl: string,
  title?: string
): Partial<WebsiteCollectedInfo> {
  const out = emptyInfo();
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const obj = node as Record<string, unknown>;
    const types = typeNames(obj);
    if (types.some((type) => ["organization", "brand", "localbusiness"].includes(type))) {
      const name = stringValue(obj.name);
      if (name && !out.brandName) out.brandName = name;
      const logo = imageUrlsFrom(obj.logo, pageUrl)[0];
      if (logo) {
        pushUnique(
          out.productImages,
          {
            url: logo,
            alt: `${name ?? "Brand"} logo`,
            caption: "Logo from structured data.",
            sourceUrl: pageUrl,
            kind: "logo",
          },
          (image) => image.url
        );
      }
    }

    if (types.some((type) => ["product", "productgroup"].includes(type))) {
      const name = stringValue(obj.name) ?? title ?? "Product";
      const productUrl = safeUrl(stringValue(obj.url), pageUrl) ?? pageUrl;
      const images = imageUrlsFrom(obj.image, pageUrl);
      const offer = offerInfo(obj.offers ?? obj.offersFor);
      const product: WebsiteCollectedProduct = {
        name,
        description: stringValue(obj.description),
        category: stringValue(obj.category),
        url: productUrl,
        priceText: offer.priceText,
        imageUrl: images[0],
      };
      pushUnique(out.products, product, (item) => item.url || item.name);
      for (const imageUrl of images.slice(0, 6)) {
        pushUnique(
          out.productImages,
          {
            url: imageUrl,
            alt: name,
            caption: `Product image for ${name}`,
            sourceUrl: productUrl,
            kind: "product",
          },
          (image) => image.url
        );
      }
      pushUnique(
        out.listingEvidence,
        {
          productName: name,
          brand: out.brandName,
          source: "Brand site",
          sourceType: "brand_site",
          url: productUrl,
          imageUrl: images[0],
          ...offer,
          isBrandProduct: true,
          confidence: 0.92,
          observedAt: new Date().toISOString().slice(0, 10),
          notes: "Product structured data collected from the brand site.",
        },
        (listing) => `${listing.url}|${listing.productName}`
      );
      if (offer.priceText || offer.price || offer.minPrice || offer.maxPrice) {
        pushUnique(
          out.priceRanges,
          {
            label: name,
            currency: offer.currency,
            min: offer.minPrice ?? offer.price ?? null,
            max: offer.maxPrice ?? offer.price ?? null,
            text: offer.priceText,
            sourceUrl: productUrl,
            notes: "Structured product offer on brand site.",
          },
          (range) => `${range.sourceUrl}|${range.label}`
        );
      }
    }

    if (types.some((type) => ["article", "newsarticle", "blogposting"].includes(type))) {
      const articleUrl = safeUrl(stringValue(obj.url ?? obj.mainEntityOfPage), pageUrl) ?? pageUrl;
      pushUnique(
        out.newsArticles,
        {
          title: stringValue(obj.headline ?? obj.name) ?? title ?? "Article",
          url: articleUrl,
          source:
            stringValue((obj.publisher as Record<string, unknown> | undefined)?.name) ??
            hostForUrl(articleUrl),
          publishedAt: stringValue(obj.datePublished),
          summary: stringValue(obj.description),
        },
        (article) => article.url
      );
    }
  }
  return out;
}

function parsePage(page: RawPage, root: URL): ParsedPage {
  const canonical = canonicalUrl(page.html, page.url);
  const title = titleFromHtml(page.html);
  const out = emptyInfo();
  out.brandName =
    metaContent(page.html, "og:site_name") ??
    metaContent(page.html, "application-name") ??
    title?.split(/[|–-]/)[0]?.trim();

  mergeInto(out, parseJsonLdSignals(parseJsonLd(page.html), canonical, title));

  // Logos first so the kind:"logo" entry wins the URL-dedupe over a generic
  // product/other classification from parseImages for the same header image.
  for (const logo of parseBrandLogos(page.html, canonical)) {
    pushUnique(out.productImages, logo, (item) => item.url, 48);
  }

  for (const image of parseImages(page.html, canonical, title)) {
    pushUnique(out.productImages, image, (item) => item.url, 48);
  }

  const anchors = parseAnchors(page.html, canonical);
  const candidateLinks: string[] = [];
  for (const anchor of anchors) {
    const url = anchor.url;
    if (new URL(url).origin === root.origin) {
      if (RELEVANT_PATH.test(new URL(url).pathname)) candidateLinks.push(url);
      continue;
    }
    if (isSocialUrl(url)) {
      pushUnique<WebsiteCollectedLink>(
        out.socialProfiles,
        { label: anchor.label || hostForUrl(url), url, detail: anchor.label },
        (link) => link.url
      );
    } else if (isMarketplaceUrl(url)) {
      pushUnique<WebsiteCollectedLink>(
        out.marketplaceLinks,
        { label: anchor.label || hostForUrl(url), url, detail: "Linked from brand site" },
        (link) => link.url
      );
    } else if (isPressUrl(url)) {
      pushUnique<WebsiteCollectedArticle>(
        out.newsArticles,
        {
          title: anchor.label || labelFromUrl(url),
          url,
          source: hostForUrl(url),
          summary: "Press/news link found on the brand site.",
        },
        (article) => article.url
      );
    }
  }

  const pageText = stripTags(page.html);
  const priceRange = parsePricesFromText(pageText, canonical, title);
  if (priceRange && (isLikelyProductPage(canonical, title) || RELEVANT_PATH.test(canonical))) {
    pushUnique(out.priceRanges, priceRange, (item) => `${item.sourceUrl}|${item.text}`);
    if (!out.listingEvidence.length && isLikelyProductPage(canonical, title)) {
      const ogImage = out.productImages.find((image) => image.kind !== "logo")?.url;
      pushUnique(
        out.listingEvidence,
        {
          productName: title || labelFromUrl(canonical),
          brand: out.brandName,
          source: "Brand site",
          sourceType: "brand_site",
          url: canonical,
          imageUrl: ogImage,
          currency: priceRange.currency,
          minPrice: priceRange.min ?? null,
          maxPrice: priceRange.max ?? null,
          priceText: priceRange.text,
          isBrandProduct: true,
          confidence: 0.75,
          observedAt: new Date().toISOString().slice(0, 10),
          notes: "Price detected from visible brand-site page text.",
        },
        (listing) => `${listing.url}|${listing.priceText ?? ""}`
      );
    }
  }

  pushUnique<WebsiteCollectedFact>(
    out.facts,
    {
      label: "Page inspected",
      value: title || labelFromUrl(canonical),
      sourceUrl: canonical,
    },
    (fact) => `${fact.label}|${fact.sourceUrl}`
  );

  return { ...out, candidateLinks };
}

function mergeInto(target: WebsiteCollectedInfo, source: Partial<WebsiteCollectedInfo>) {
  if (!target.brandName && source.brandName) target.brandName = source.brandName;
  for (const image of source.productImages ?? []) {
    pushUnique(target.productImages, image, (item) => item.url, 60);
  }
  for (const product of source.products ?? []) {
    pushUnique(target.products, product, (item) => item.url || item.name, 60);
  }
  for (const listing of source.listingEvidence ?? []) {
    pushUnique(target.listingEvidence, listing, (item) => `${item.url}|${item.productName}`, 60);
  }
  for (const range of source.priceRanges ?? []) {
    pushUnique(target.priceRanges, range, (item) => `${item.sourceUrl}|${item.label}|${item.text}`, 40);
  }
  for (const article of source.newsArticles ?? []) {
    pushUnique(target.newsArticles, article, (item) => item.url, 60);
  }
  for (const link of source.socialProfiles ?? []) {
    pushUnique(target.socialProfiles, link, (item) => item.url, 40);
  }
  for (const link of source.marketplaceLinks ?? []) {
    pushUnique(target.marketplaceLinks, link, (item) => item.url, 40);
  }
  for (const fact of source.facts ?? []) {
    pushUnique(target.facts, fact, (item) => `${item.label}|${item.value}|${item.sourceUrl ?? ""}`, 80);
  }
  for (const question of source.openQuestions ?? []) {
    pushUnique(target.openQuestions, question, (item) => item, 40);
  }
}

function mergeCollectedInfo(
  first: WebsiteCollectedInfo,
  second: WebsiteCollectedInfo
): WebsiteCollectedInfo {
  const out = emptyInfo();
  mergeInto(out, first);
  mergeInto(out, second);
  out.brandName = first.brandName || second.brandName;
  return WebsiteCollectedInfoSchema.parse(out);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return null;
    }
    return (await response.text()).slice(0, MAX_HTML_CHARS);
  } catch {
    return null;
  }
}

function commonBrandPaths(root: URL): string[] {
  return [
    "/products",
    "/collections/all",
    "/collections",
    "/shop",
    "/store",
    "/pages/about-us",
    "/pages/about",
    "/pages/our-story",
    "/pages/press",
    "/pages/stockists",
    "/blogs/news",
  ].map((path) => new URL(path, root).toString());
}

function sortCandidateLinks(links: string[]): string[] {
  const score = (url: string) => {
    const path = new URL(url).pathname.toLowerCase();
    if (/product/.test(path)) return 0;
    if (/collection|shop|store|catalog/.test(path)) return 1;
    if (/press|media|news|blog|journal/.test(path)) return 2;
    if (/about|story|stockist/.test(path)) return 3;
    return 4;
  };
  return [...new Set(links.map(normalizeUrl))].sort((a, b) => score(a) - score(b));
}

export async function collectWebsiteEvidence(rawUrl: string): Promise<WebsiteCollectedInfo> {
  const start = normalizeInputUrl(rawUrl);
  const root = new URL(start);
  const info = emptyInfo();
  const seen = new Set<string>();
  const queue = sortCandidateLinks([start, ...commonBrandPaths(root)]);

  while (queue.length && seen.size < MAX_PAGES) {
    const next = queue.shift();
    if (!next) break;
    let pageUrl: string;
    try {
      pageUrl = normalizeUrl(next);
      if (new URL(pageUrl).origin !== root.origin) continue;
    } catch {
      continue;
    }
    if (seen.has(pageUrl)) continue;
    seen.add(pageUrl);
    const html = await fetchHtml(pageUrl);
    if (!html) continue;
    const parsed = parsePage({ url: pageUrl, html }, root);
    mergeInto(info, parsed);
    const candidates = sortCandidateLinks(parsed.candidateLinks)
      .filter((url) => !seen.has(url))
      .slice(0, 24);
    queue.unshift(...candidates);
  }

  if (seen.size === 0) {
    info.openQuestions.push("Could not fetch the submitted website for direct image/product scraping.");
  }

  return WebsiteCollectedInfoSchema.parse({
    ...info,
    productImages: info.productImages.slice(0, 36),
    products: info.products.slice(0, 24),
    listingEvidence: info.listingEvidence.slice(0, 24),
    priceRanges: info.priceRanges.slice(0, 16),
    newsArticles: info.newsArticles.slice(0, 24),
    facts: info.facts.slice(0, 30),
  });
}

export function mergeWebsiteCollectedInfo(args: {
  scraped: WebsiteCollectedInfo;
  model: WebsiteCollectedInfo;
}): WebsiteCollectedInfo {
  return mergeCollectedInfo(args.scraped, args.model);
}

export function compactWebsiteEvidenceForPrompt(info: WebsiteCollectedInfo) {
  return {
    brandName: info.brandName,
    productImages: info.productImages.slice(0, 16).map((image) => ({
      url: image.url,
      alt: image.alt,
      caption: image.caption,
      sourceUrl: image.sourceUrl,
      kind: image.kind,
    })),
    products: info.products.slice(0, 16),
    listingEvidence: info.listingEvidence.slice(0, 16),
    priceRanges: info.priceRanges.slice(0, 10),
    newsArticles: info.newsArticles.slice(0, 16),
    socialProfiles: info.socialProfiles.slice(0, 12),
    marketplaceLinks: info.marketplaceLinks.slice(0, 12),
    facts: info.facts.slice(0, 16),
    openQuestions: info.openQuestions.slice(0, 10),
    evidenceId: stableId(JSON.stringify(info).slice(0, 20_000)),
  };
}
