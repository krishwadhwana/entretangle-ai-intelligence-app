// Sanitize an LLM-authored landing page before it is previewed in an iframe,
// downloaded, or deployed. The HTML comes from our own model call (not user
// input), but we still strip all active content so a generated page is a pure
// static document: no scripts, no event handlers, no embedded frames, no
// javascript:/data: navigations. Inline <style> and a Google-Fonts <link> are
// preserved (that's how the page is themed from the design tokens).
export function sanitizeSiteHtml(raw: string): string {
  let html = raw.trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "");

  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<iframe\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    // Neutralize javascript: navigations in any href/src/action.
    .replace(
      /\s(href|src|action)\s*=\s*"(?:javascript:)[^"]*"/gi,
      ' $1="#"'
    )
    .replace(
      /\s(href|src|action)\s*=\s*'(?:javascript:)[^']*'/gi,
      " $1='#'"
    );

  return html;
}

/** True if the string looks like a full HTML document we can safely serve. */
export function looksLikeHtmlDoc(html: string): boolean {
  return /<html[\s>]/i.test(html) && /<\/html>/i.test(html);
}

type ProductImagePlaceholder = {
  placeholder: string;
  name: string;
  visualSummary?: string | null;
  availableForInlineEmbed?: boolean;
};

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanVisibleCopy(value: string): string {
  return compactWhitespace(value)
    .replace(/\bPage inspected:\s*/gi, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s*;\s*/g, ". ");
}

function heroDisplayTitle(value: string): string {
  const cleaned = cleanVisibleCopy(value)
    .replace(/\b(collections?|shop|premium|made in india)\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ml|g|oz|kg|pack|pcs?)\b/gi, "")
    .replace(/\b(sulphate|sulfate)-free\b/gi, "")
    .replace(/\b(conditioner|shampoo|cleanser|cream|serum|combo|bundle)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.slice(0, 4).join(" ") || "New Ritual";
}

function polishCss(): string {
  return `
<style data-et-site-polish>
html,body{max-width:100%;overflow-x:hidden}
body *{box-sizing:border-box}
header,.site-header,.navbar,.et-product-hero__nav{max-width:100%;min-width:0;min-height:72px}
header,header nav,.site-header,.navbar,.et-product-hero__nav{display:flex;align-items:center;justify-content:space-between;gap:clamp(14px,2.5vw,32px);flex-wrap:nowrap}
header>*,header nav>*,.site-header>*,.navbar>*,.et-product-hero__nav>*{min-width:0}
header a,nav a,.site-header a,.navbar a,.et-product-hero__nav a{white-space:nowrap}
header :where([class*="brand"],[class*="logo"],.wordmark),.site-header :where([class*="brand"],[class*="logo"],.wordmark),.navbar :where([class*="brand"],[class*="logo"],.wordmark){display:flex;align-items:center;max-width:min(24ch,34vw);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(24px,2.4vw,42px)!important;line-height:1!important;letter-spacing:0!important}
header :where([class*="brand"],[class*="logo"],.wordmark):has(> :nth-child(2)) > :where(span,small,p):first-child,.site-header :where([class*="brand"],[class*="logo"],.wordmark):has(> :nth-child(2)) > :where(span,small,p):first-child,.navbar :where([class*="brand"],[class*="logo"],.wordmark):has(> :nth-child(2)) > :where(span,small,p):first-child{display:none!important}
header :where(h1,h2),.site-header :where(h1,h2),.navbar :where(h1,h2){margin:0!important;font-size:clamp(24px,2.4vw,42px)!important;line-height:1!important;max-width:min(24ch,34vw)!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header nav,.site-header nav,.navbar nav{margin-left:auto;justify-content:flex-end}
main>section:first-of-type,[class*="hero"],.et-product-hero{overflow:hidden}
main>section:first-of-type h1,[class*="hero"] h1,.et-product-hero h1{font-size:clamp(42px,7vw,96px)!important;line-height:.95!important;letter-spacing:0!important;max-width:min(12ch,92vw)!important;text-wrap:balance;overflow-wrap:break-word;hyphens:auto}
main>section:first-of-type p,[class*="hero"] p,.et-product-hero p{max-width:min(640px,92vw)}
.et-product-hero__copy{width:min(680px,100%)!important;padding-top:clamp(112px,14vw,170px)!important}
.et-product-hero__nav span{display:block;max-width:min(34ch,62vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:760px){header,.site-header,.navbar,.et-product-hero__nav{min-height:64px;gap:12px;flex-wrap:wrap}header :where([class*="brand"],[class*="logo"],.wordmark,h1,h2),.site-header :where([class*="brand"],[class*="logo"],.wordmark,h1,h2),.navbar :where([class*="brand"],[class*="logo"],.wordmark,h1,h2){max-width:58vw!important;font-size:clamp(22px,8vw,34px)!important}main>section:first-of-type h1,[class*="hero"] h1,.et-product-hero h1{font-size:clamp(38px,14vw,68px)!important;max-width:9ch!important}.et-product-hero__copy{padding-top:108px!important}.et-product-hero__nav{align-items:flex-start}}
</style>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function siteImageCss(): string {
  return `
.et-product-hero{position:relative;min-height:min(88vh,860px);display:flex;align-items:flex-end;overflow:hidden;background:var(--neutral-dark,#101010);color:var(--neutral-light,#fff)}
.et-product-hero__image{position:absolute;inset:0;margin:0}
.et-product-hero__image img{width:100%;height:100%;object-fit:cover;display:block;filter:saturate(1.04) contrast(1.03)}
.et-product-hero__image:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.74) 0%,rgba(0,0,0,.42) 42%,rgba(0,0,0,.08) 100%),linear-gradient(0deg,rgba(0,0,0,.52) 0%,rgba(0,0,0,0) 48%)}
.et-product-hero__nav{position:absolute;top:0;left:0;right:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:clamp(18px,3vw,34px) clamp(20px,6vw,84px);font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.et-product-hero__nav a{color:inherit;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.55);padding-bottom:4px}
.et-product-hero__copy{position:relative;z-index:1;width:min(680px,100%);padding:clamp(112px,14vw,170px) clamp(20px,6vw,84px) clamp(52px,8vw,92px)}
.et-product-hero__eyebrow{margin:0 0 18px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.78}
.et-product-hero h1{margin:0;font-family:var(--heading-font,inherit);font-size:clamp(42px,7vw,96px);line-height:.95;letter-spacing:0;max-width:12ch;text-wrap:balance;overflow-wrap:break-word}
.et-product-hero p{max-width:610px;margin:24px 0 0;font-size:clamp(17px,2vw,23px);line-height:1.45;color:rgba(255,255,255,.9)}
.et-product-hero__actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}
.et-product-hero__actions a{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border-radius:2px;text-decoration:none;font-weight:850;letter-spacing:.02em}
.et-product-hero__actions a:first-child{background:var(--neutral-light,#fff);color:var(--neutral-dark,#111)}
.et-product-hero__actions a:last-child{border:1px solid rgba(255,255,255,.62);color:var(--neutral-light,#fff)}
.et-product-proof{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(24px,5vw,72px);align-items:start;padding:clamp(52px,8vw,96px) clamp(20px,6vw,84px);background:var(--neutral-light,#faf8f2);color:var(--neutral-dark,#101010)}
.et-product-proof__intro{position:sticky;top:24px}
.et-product-proof h2{margin:0;font-family:var(--heading-font,inherit);font-size:clamp(34px,5vw,76px);line-height:.98;letter-spacing:0;max-width:10ch}
.et-product-proof__intro p{max-width:520px;margin:18px 0 0;font-size:16px;line-height:1.6;color:color-mix(in srgb,var(--neutral-dark,#111) 72%,transparent)}
.et-product-proof__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.et-product-proof__item{position:relative;overflow:hidden;background:color-mix(in srgb,var(--secondary,#d9cec0) 32%,white);min-height:260px}
.et-product-proof__item img{width:100%;height:100%;aspect-ratio:4/5;object-fit:cover;display:block}
.et-product-proof__item span{position:absolute;left:12px;right:12px;bottom:12px;padding:9px 10px;background:rgba(255,255,255,.84);color:#111;font-size:11px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:860px){.et-product-hero{min-height:86vh}.et-product-hero__nav{padding:18px 20px}.et-product-hero__copy{padding:120px 20px 42px}.et-product-proof{grid-template-columns:1fr}.et-product-proof__intro{position:static}.et-product-proof__grid{grid-template-columns:1fr 1fr}.et-product-proof__item{min-height:190px}}`;
}

function insertStyle(html: string): string {
  if (html.includes(".et-product-hero")) return html;
  if (/<\/style>/i.test(html)) {
    return html.replace(/<\/style>/i, `${siteImageCss()}\n</style>`);
  }
  return html.replace(
    /<\/head>/i,
    `<style>${siteImageCss()}</style>\n</head>`
  );
}

export function polishGeneratedSiteHtml(rawHtml: string): string {
  if (rawHtml.includes("data-et-site-polish")) return rawHtml;
  if (/<\/head>/i.test(rawHtml)) {
    return rawHtml.replace(/<\/head>/i, `${polishCss()}\n</head>`);
  }
  return rawHtml;
}

function insertAfterOpeningTag(
  html: string,
  tagName: "main" | "body",
  markup: string
): string {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "i");
  const match = html.match(re);
  if (!match || match.index === undefined) return html;
  const index = match.index + match[0].length;
  return `${html.slice(0, index)}\n${markup}\n${html.slice(index)}`;
}

/**
 * The model is instructed to use product image placeholders, but a defensive
 * pass keeps the website output image-led when references are available. This
 * runs before placeholder replacement, so PRODUCT_IMAGE_N still becomes a
 * self-contained data URL later in the pipeline.
 */
export function ensureProductImageryHtml(
  rawHtml: string,
  productImages: ProductImagePlaceholder[],
  options: { brandName: string; tagline?: string | null } = { brandName: "Brand" }
): string {
  const usable = productImages
    .filter((image) => image.availableForInlineEmbed !== false)
    .slice(0, 6);
  if (!usable.length) return rawHtml;
  if (rawHtml.includes("et-product-hero")) return rawHtml;

  const heroImage = usable[0];
  const showcaseImages = usable.slice(1, 5);
  const brandName = escapeHtml(options.brandName || "Brand");
  const heroTitle = escapeHtml(heroDisplayTitle(options.tagline || options.brandName));
  const tagline = escapeHtml(
    cleanVisibleCopy(options.tagline || "Product-led essentials, styled for launch.")
  );
  const showcase = showcaseImages.length
    ? `<section class="et-product-proof" aria-label="Product details"><div class="et-product-proof__intro"><h2>Built around the product, not filler.</h2><p>${tagline}</p></div><div class="et-product-proof__grid">${showcaseImages
        .map(
          (image) => `<figure class="et-product-proof__item"><img src="${image.placeholder}" alt="${escapeHtml(
            image.name
          )}"><span>${escapeHtml(image.name)}</span></figure>`
        )
        .join("")}</div></section>`
    : "";
  const injected = `<section class="et-product-hero" aria-label="${brandName} product campaign">
  <figure class="et-product-hero__image"><img src="${heroImage.placeholder}" alt="${escapeHtml(heroImage.name)}"></figure>
  <div class="et-product-hero__nav"><span>${brandName}</span><a href="#shop">Shop</a></div>
  <div class="et-product-hero__copy">
    <p class="et-product-hero__eyebrow">New campaign</p>
    <h1>${heroTitle}</h1>
    <p>${tagline}</p>
    <div class="et-product-hero__actions"><a href="#shop">Shop now</a><a href="#details">See the product</a></div>
  </div>
</section>${showcase}`;

  const withStyle = insertStyle(rawHtml);
  const withMain = insertAfterOpeningTag(withStyle, "main", injected);
  return withMain === withStyle
    ? insertAfterOpeningTag(withStyle, "body", injected)
    : withMain;
}
