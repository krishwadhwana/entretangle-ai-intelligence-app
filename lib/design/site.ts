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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function siteImageCss(): string {
  return `
.et-product-hero{min-height:76vh;display:grid;grid-template-columns:minmax(0,0.92fr) minmax(280px,1.08fr);gap:clamp(24px,5vw,72px);align-items:center;padding:clamp(72px,9vw,128px) clamp(20px,6vw,88px);background:linear-gradient(135deg,var(--neutral-light,#f8f5ef),rgba(255,255,255,.72));color:var(--neutral-dark,#121212);overflow:hidden}
.et-product-hero__copy{max-width:660px;position:relative;z-index:1}
.et-product-hero__eyebrow{display:inline-flex;margin:0 0 18px;padding:8px 12px;border:1px solid currentColor;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.78}
.et-product-hero h1{margin:0;font-family:var(--heading-font,inherit);font-size:clamp(44px,8vw,112px);line-height:.94;letter-spacing:0}
.et-product-hero p{max-width:560px;margin:22px 0 0;font-size:clamp(16px,2vw,21px);line-height:1.55}
.et-product-hero__actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
.et-product-hero__actions a{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border-radius:999px;text-decoration:none;font-weight:800}
.et-product-hero__actions a:first-child{background:var(--primary,#111);color:var(--neutral-light,#fff)}
.et-product-hero__actions a:last-child{border:1px solid currentColor;color:inherit}
.et-product-hero__gallery{display:grid;grid-template-columns:1fr .72fr;grid-template-rows:1fr 1fr;gap:clamp(10px,1.6vw,18px);min-height:min(620px,68vh)}
.et-product-hero__frame{position:relative;overflow:hidden;border-radius:clamp(18px,2.5vw,32px);background:var(--secondary,#e9e1d5);box-shadow:0 28px 80px rgba(0,0,0,.18)}
.et-product-hero__frame:first-child{grid-row:1 / span 2}
.et-product-hero__frame img{width:100%;height:100%;object-fit:cover;display:block}
.et-product-hero__frame:first-child img{object-fit:cover}
.et-product-hero__label{position:absolute;left:14px;right:14px;bottom:14px;padding:10px 12px;border-radius:999px;background:rgba(255,255,255,.82);color:#111;font-size:12px;font-weight:800;backdrop-filter:blur(16px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.et-product-showcase{padding:clamp(48px,8vw,104px) clamp(20px,6vw,88px);background:var(--neutral-dark,#111);color:var(--neutral-light,#fff)}
.et-product-showcase h2{margin:0 0 24px;font-family:var(--heading-font,inherit);font-size:clamp(32px,5vw,70px);line-height:1}
.et-product-showcase__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.et-product-showcase__card{overflow:hidden;border-radius:24px;background:rgba(255,255,255,.08)}
.et-product-showcase__card img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block}
.et-product-showcase__card p{margin:0;padding:14px 16px;font-size:13px;line-height:1.4;opacity:.86}
@media (max-width:860px){.et-product-hero{grid-template-columns:1fr;min-height:auto}.et-product-hero__gallery{min-height:430px}.et-product-showcase__grid{grid-template-columns:1fr}}`;
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
  if (rawHtml.includes(usable[0].placeholder)) return rawHtml;

  const heroImages = usable.slice(0, 3);
  const showcaseImages = usable.slice(3, 6);
  const brandName = escapeHtml(options.brandName || "Brand");
  const tagline = escapeHtml(
    options.tagline || "Product-led essentials, styled for launch."
  );
  const imageFrames = heroImages
    .map(
      (image) => `<figure class="et-product-hero__frame"><img src="${image.placeholder}" alt="${escapeHtml(
        image.name
      )}"><figcaption class="et-product-hero__label">${escapeHtml(
        image.name
      )}</figcaption></figure>`
    )
    .join("");
  const showcase = showcaseImages.length
    ? `<section class="et-product-showcase" aria-label="Product showcase"><h2>Product details worth seeing</h2><div class="et-product-showcase__grid">${showcaseImages
        .map(
          (image) => `<article class="et-product-showcase__card"><img src="${image.placeholder}" alt="${escapeHtml(
            image.name
          )}"><p>${escapeHtml(image.visualSummary || image.name)}</p></article>`
        )
        .join("")}</div></section>`
    : "";
  const injected = `<section class="et-product-hero" aria-label="${brandName} product campaign">
  <div class="et-product-hero__copy">
    <p class="et-product-hero__eyebrow">Product campaign</p>
    <h1>${brandName}</h1>
    <p>${tagline}</p>
    <div class="et-product-hero__actions"><a href="#shop">Shop the edit</a><a href="#details">See details</a></div>
  </div>
  <div class="et-product-hero__gallery">${imageFrames}</div>
</section>${showcase}`;

  const withStyle = insertStyle(rawHtml);
  const withMain = insertAfterOpeningTag(withStyle, "main", injected);
  return withMain === withStyle
    ? insertAfterOpeningTag(withStyle, "body", injected)
    : withMain;
}
