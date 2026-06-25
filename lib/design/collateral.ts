import satori from "satori";
import type {
  CollateralContent,
  CollateralType,
  DesignTokens,
} from "@/lib/schema";
import { loadBrandFonts } from "./fonts";

// ---------------------------------------------------------------------------
// Collateral rendering. The LLM supplies the copy, and social ads may also
// include an AI-generated raster visual. Satori composes the final asset as a
// self-contained SVG with brand typography, overlays, and downloadable output.
// ---------------------------------------------------------------------------

// Minimal hyperscript: Satori accepts the JSX-compiled VDOM shape directly, so
// we build it without pulling React into a server lib.
type SatoriStyle = Record<string, string | number>;
type SatoriNode = {
  type: string;
  props: { style: SatoriStyle; children?: SatoriNode[] | string; src?: string };
};

function el(
  style: SatoriStyle,
  children?: SatoriNode[] | string
): SatoriNode {
  return { type: "div", props: { style, ...(children !== undefined ? { children } : {}) } };
}

function imageEl(src: string, style: SatoriStyle): SatoriNode {
  return { type: "img", props: { src, style } };
}

function uniqueSvgIdPrefix(): string {
  return `asset-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}-`;
}

function prefixSvgIds(svg: string): string {
  const prefix = uniqueSvgIdPrefix();
  const ids = new Map<string, string>();
  const withIds = svg.replace(/\bid="([^"]+)"/g, (match, id: string) => {
    const next = `${prefix}${id}`;
    ids.set(id, next);
    return match.replace(id, next);
  });

  let out = withIds;
  for (const [oldId, nextId] of ids) {
    const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`url\\(#${escaped}\\)`, "g"), `url(#${nextId})`)
      .replace(new RegExp(`href="#${escaped}"`, "g"), `href="#${nextId}"`)
      .replace(
        new RegExp(`xlink:href="#${escaped}"`, "g"),
        `xlink:href="#${nextId}"`
      );
  }
  return out;
}

function cleanDisplayText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncateDisplayText(value: string | undefined, maxChars: number): string {
  const text = cleanDisplayText(value);
  if (text.length <= maxChars) return text;
  const soft = text.slice(0, Math.max(0, maxChars - 1)).trimEnd();
  const lastSpace = soft.lastIndexOf(" ");
  const base =
    lastSpace >= Math.floor(maxChars * 0.55) ? soft.slice(0, lastSpace) : soft;
  return `${base.trimEnd()}...`;
}

function safeBodyLines(lines: string[], maxItems: number, maxChars: number): string[] {
  return lines
    .map((line) => truncateDisplayText(line, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function safeHeadline(
  content: CollateralContent,
  variant: "portrait" | "square"
): string {
  return truncateDisplayText(
    content.headline || content.brandName,
    variant === "portrait" ? 42 : 30
  );
}

function safeSubhead(
  content: CollateralContent,
  variant: "portrait" | "square"
): string {
  return truncateDisplayText(content.subhead, variant === "portrait" ? 72 : 54);
}

function safeCta(content: CollateralContent, variant: "portrait" | "square"): string {
  return truncateDisplayText(content.cta, variant === "portrait" ? 30 : 22);
}

function lineBreakText(
  value: string | undefined,
  maxCharsPerLine: number,
  maxLines: number
): string[] {
  const words = cleanDisplayText(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
      continue;
    }

    if (current) lines.push(current);
    current = word;

    if (lines.length === maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === 0) return [];
  const original = cleanDisplayText(value);
  const rendered = lines.join(" ");
  if (rendered.length < original.length) {
    lines[lines.length - 1] = truncateDisplayText(
      lines[lines.length - 1],
      Math.max(4, maxCharsPerLine)
    );
  }
  return lines;
}

function textStack(
  lines: string[],
  style: SatoriStyle,
  gap: number
): SatoriNode {
  return el(
    { display: "flex", flexDirection: "column", width: "100%" },
    lines.map((line, index) =>
      el(
        {
          ...style,
          display: "flex",
          marginTop: index === 0 ? "0px" : `${gap}px`,
          width: "100%",
        },
        line
      )
    )
  );
}

const DIMENSIONS: Record<CollateralType, { width: number; height: number }> = {
  ad: { width: 1080, height: 1080 }, // square paid social ad / feed creative
  "business-card": { width: 1050, height: 600 }, // 3.5"×2" @ 300dpi
  flyer: { width: 1080, height: 1350 }, // portrait social ad / feed post
  poster: { width: 1080, height: 1080 }, // square social post / ad
};

export const COLLATERAL_LABELS: Record<CollateralType, string> = {
  ad: "Ad campaign creative",
  "business-card": "Business card",
  flyer: "Flyer",
  poster: "Poster",
};

function contactLines(content: CollateralContent): string[] {
  const c = content.contact;
  return [c.email, c.phone, c.website].filter((v) => v && v.trim().length > 0);
}

function businessCard(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string }
): SatoriNode {
  const { palette } = tokens;
  return el(
    {
      display: "flex",
      flexDirection: "row",
      width: "100%",
      height: "100%",
      backgroundColor: palette.neutralLight,
      fontFamily: fonts.body,
    },
    [
      // Accent sidebar
      el({
        display: "flex",
        width: "14px",
        height: "100%",
        backgroundColor: palette.primary,
      }),
      el(
        {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flexGrow: 1,
          padding: "64px",
        },
        [
          el(
            { display: "flex", flexDirection: "column" },
            [
              el(
                {
                  display: "flex",
                  fontFamily: fonts.heading,
                  fontWeight: 700,
                  fontSize: "64px",
                  color: palette.neutralDark,
                },
                content.brandName
              ),
              content.tagline
                ? el(
                    {
                      display: "flex",
                      marginTop: "10px",
                      fontSize: "26px",
                      color: palette.secondary,
                    },
                    content.tagline
                  )
                : el({ display: "flex" }),
            ]
          ),
          el(
            { display: "flex", flexDirection: "column" },
            [
              content.contact.name
                ? el(
                    {
                      display: "flex",
                      fontFamily: fonts.heading,
                      fontWeight: 700,
                      fontSize: "30px",
                      color: palette.neutralDark,
                    },
                    content.contact.name
                  )
                : el({ display: "flex" }),
              content.contact.role
                ? el(
                    { display: "flex", fontSize: "22px", color: palette.accent },
                    content.contact.role
                  )
                : el({ display: "flex" }),
              ...contactLines(content).map((line) =>
                el(
                  {
                    display: "flex",
                    marginTop: "6px",
                    fontSize: "22px",
                    color: palette.neutralDark,
                  },
                  line
                )
              ),
            ]
          ),
        ]
      ),
    ]
  );
}

function benefitChip(
  label: string,
  tokens: DesignTokens,
  scale: number
): SatoriNode {
  const displayLabel = truncateDisplayText(label, 34);
  return el(
    {
      display: "flex",
      alignItems: "center",
      marginRight: `${10 * scale}px`,
      marginBottom: `${10 * scale}px`,
      padding: `${10 * scale}px ${14 * scale}px`,
      borderRadius: `${999 * scale}px`,
      backgroundColor: tokens.palette.neutralLight,
      color: tokens.palette.neutralDark,
      fontSize: `${18 * scale}px`,
      fontWeight: 600,
      maxWidth: "100%",
      overflow: "hidden",
    },
    displayLabel
  );
}

function productMockup(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  scale: number
): SatoriNode {
  const { palette } = tokens;
  const label = content.brandName.slice(0, 14).toUpperCase();
  return el(
    {
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
      width: "100%",
      height: "100%",
      paddingTop: `${28 * scale}px`,
    },
    [
      el(
        {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: `${188 * scale}px`,
          height: `${330 * scale}px`,
          marginRight: `${-28 * scale}px`,
          padding: `${24 * scale}px ${18 * scale}px`,
          borderRadius: `${32 * scale}px`,
          backgroundColor: palette.neutralLight,
          border: `${5 * scale}px solid ${palette.neutralDark}`,
          transform: "rotate(-7deg)",
        },
        [
          el(
            {
              display: "flex",
              fontFamily: fonts.heading,
              fontWeight: 700,
              fontSize: `${22 * scale}px`,
              lineHeight: 1,
              color: palette.neutralDark,
            },
            label
          ),
          el({
            display: "flex",
            width: "100%",
            height: `${72 * scale}px`,
            borderRadius: `${999 * scale}px`,
            backgroundColor: palette.accent,
          }),
        ]
      ),
      el(
        {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: `${232 * scale}px`,
          height: `${420 * scale}px`,
          padding: `${28 * scale}px ${22 * scale}px`,
          borderRadius: `${38 * scale}px`,
          backgroundColor: palette.neutralLight,
          border: `${6 * scale}px solid ${palette.neutralDark}`,
        },
        [
          el(
            {
              display: "flex",
              fontFamily: fonts.heading,
              fontWeight: 700,
              fontSize: `${28 * scale}px`,
              lineHeight: 1,
              color: palette.neutralDark,
            },
            label
          ),
          el(
            {
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              width: "100%",
              height: `${190 * scale}px`,
              borderRadius: `${28 * scale}px`,
              backgroundColor: palette.primary,
              padding: `${18 * scale}px`,
            },
            [
              el({
                display: "flex",
                width: "70%",
                height: `${16 * scale}px`,
                marginBottom: `${14 * scale}px`,
                borderRadius: `${999 * scale}px`,
                backgroundColor: palette.accent,
              }),
              el({
                display: "flex",
                width: "100%",
                height: `${16 * scale}px`,
                marginBottom: `${14 * scale}px`,
                borderRadius: `${999 * scale}px`,
                backgroundColor: palette.neutralLight,
              }),
              el({
                display: "flex",
                width: "55%",
                height: `${16 * scale}px`,
                borderRadius: `${999 * scale}px`,
                backgroundColor: palette.secondary,
              }),
            ]
          ),
        ]
      ),
      el(
        {
          display: "flex",
          width: `${96 * scale}px`,
          height: `${270 * scale}px`,
          marginLeft: `${-18 * scale}px`,
          borderRadius: `${999 * scale}px ${999 * scale}px ${28 * scale}px ${28 * scale}px`,
          backgroundColor: palette.accent,
          border: `${5 * scale}px solid ${palette.neutralDark}`,
          transform: "rotate(8deg)",
        }
      ),
    ]
  );
}

function socialScale(variant: "portrait" | "square"): number {
  return variant === "portrait" ? 1 : 0.86;
}

function socialFrame(
  tokens: DesignTokens,
  fonts: { heading: string; body: string },
  scale: number,
  children: SatoriNode[]
): SatoriNode {
  return el(
    {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      backgroundColor: tokens.palette.neutralLight,
      fontFamily: fonts.body,
      padding: `${48 * scale}px`,
    },
    children
  );
}

function socialHeader(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  scale: number,
  badge: string
): SatoriNode {
  const { palette } = tokens;
  return el(
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    [
      el(
        {
          display: "flex",
          flexDirection: "column",
          maxWidth: `${590 * scale}px`,
        },
        [
          el(
            {
              display: "flex",
              fontFamily: fonts.heading,
              fontWeight: 700,
              fontSize: `${34 * scale}px`,
              letterSpacing: "0px",
              color: palette.neutralDark,
            },
            content.brandName
          ),
          content.tagline
            ? el(
                {
                  display: "flex",
                  marginTop: `${6 * scale}px`,
                  fontSize: `${18 * scale}px`,
                  color: palette.secondary,
                },
                content.tagline
              )
            : el({ display: "flex" }),
        ]
      ),
      el(
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: `${12 * scale}px ${18 * scale}px`,
          borderRadius: `${999 * scale}px`,
          backgroundColor: palette.primary,
          color: palette.neutralLight,
          fontWeight: 700,
          fontSize: `${16 * scale}px`,
        },
        badge
      ),
    ]
  );
}

function ctaBar(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  scale: number,
  inverted = false
): SatoriNode {
  const cta = truncateDisplayText(content.cta, 26);
  if (!cta) return el({ display: "flex", height: "0px" });
  return el(
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginTop: `${28 * scale}px`,
      borderRadius: `${24 * scale}px`,
      backgroundColor: inverted ? tokens.palette.neutralDark : tokens.palette.accent,
      padding: `${24 * scale}px`,
      color: inverted ? tokens.palette.neutralLight : tokens.palette.neutralDark,
      fontFamily: fonts.heading,
      fontWeight: 700,
      fontSize: `${30 * scale}px`,
      overflow: "hidden",
    },
    cta
  );
}

// Product-forward feed ad: headline + prominent pack shot + scannable benefits.
function productHeroAd(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  variant: "portrait" | "square"
): SatoriNode {
  const { palette } = tokens;
  const scale = variant === "portrait" ? 1 : 0.86;
  const visualHeight = variant === "portrait" ? 520 : 390;
  const headlineSize = variant === "portrait" ? 78 : 62;
  const bodyLines = safeBodyLines(content.body, 4, 38);
  const subhead = safeSubhead(content, variant);
  return socialFrame(tokens, fonts, scale, [
    socialHeader(tokens, content, fonts, scale, "NEW"),
    el(
      {
        display: "flex",
        flexDirection: "column",
        marginTop: `${46 * scale}px`,
      },
      [
        el(
          {
            display: "flex",
            fontFamily: fonts.heading,
            fontWeight: 700,
            fontSize: `${headlineSize * scale}px`,
            lineHeight: 1.05,
            color: palette.neutralDark,
            maxWidth: "100%",
            overflow: "hidden",
          },
          safeHeadline(content, variant)
        ),
        subhead
          ? el(
              {
                display: "flex",
                marginTop: `${20 * scale}px`,
                maxWidth: `${790 * scale}px`,
                fontSize: `${29 * scale}px`,
                lineHeight: 1.25,
                color: palette.secondary,
                overflow: "hidden",
              },
              subhead
            )
          : el({ display: "flex" }),
      ]
    ),
    el(
      {
        display: "flex",
        flexDirection: "row",
        flexGrow: 1,
        marginTop: `${34 * scale}px`,
        borderRadius: `${44 * scale}px`,
        overflow: "hidden",
        backgroundColor: palette.primary,
      },
      [
        el(
          {
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "42%",
            padding: `${36 * scale}px`,
            backgroundColor: palette.neutralDark,
          },
          [
            el(
              {
                display: "flex",
                flexWrap: "wrap",
              },
              (bodyLines.length ? bodyLines : [content.subhead || content.headline])
                .slice(0, 4)
                .map((line) => benefitChip(line, tokens, scale))
            ),
            el(
              {
                display: "flex",
                width: `${118 * scale}px`,
                height: `${118 * scale}px`,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: `${999 * scale}px`,
                backgroundColor: palette.accent,
                color: palette.neutralDark,
                fontFamily: fonts.heading,
                fontWeight: 700,
                fontSize: `${28 * scale}px`,
                lineHeight: 1,
              },
              "AD"
            ),
          ]
        ),
        el(
          {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexGrow: 1,
            minHeight: `${visualHeight * scale}px`,
            backgroundColor: palette.primary,
            padding: `${24 * scale}px`,
          },
          [productMockup(tokens, content, fonts, scale)]
        ),
      ]
    ),
    ctaBar(tokens, content, fonts, scale),
  ]);
}

function editorialAd(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  variant: "portrait" | "square"
): SatoriNode {
  const { palette } = tokens;
  const scale = socialScale(variant);
  const headlineSize = variant === "portrait" ? 92 : 74;
  const subhead = safeSubhead(content, variant);
  return socialFrame(tokens, fonts, scale, [
    socialHeader(tokens, content, fonts, scale, "GUIDE"),
    el(
      {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        flexGrow: 1,
        marginTop: `${38 * scale}px`,
        borderTop: `${6 * scale}px solid ${palette.primary}`,
        borderBottom: `${6 * scale}px solid ${palette.primary}`,
        paddingTop: `${52 * scale}px`,
        paddingBottom: `${52 * scale}px`,
      },
      [
        el(
          {
            display: "flex",
            fontFamily: fonts.heading,
            fontWeight: 700,
            fontSize: `${headlineSize * scale}px`,
            lineHeight: 0.98,
            color: palette.neutralDark,
            maxWidth: "100%",
            overflow: "hidden",
          },
          safeHeadline(content, variant)
        ),
        subhead
          ? el(
              {
                display: "flex",
                marginTop: `${26 * scale}px`,
                maxWidth: `${760 * scale}px`,
                fontSize: `${32 * scale}px`,
                lineHeight: 1.22,
                color: palette.secondary,
                overflow: "hidden",
              },
              subhead
            )
          : el({ display: "flex" }),
      ]
    ),
    el(
      {
        display: "flex",
        flexDirection: "row",
        gap: `${18 * scale}px`,
        marginTop: `${30 * scale}px`,
      },
      (content.body.length ? safeBodyLines(content.body, 3, 44) : [truncateDisplayText(content.cta || content.tagline, 44)])
        .slice(0, 3)
        .map((line, index) =>
          el(
            {
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: `${150 * scale}px`,
              borderRadius: `${28 * scale}px`,
              backgroundColor:
                index === 1 ? palette.primary : index === 2 ? palette.accent : palette.neutralDark,
              padding: `${24 * scale}px`,
              color: index === 2 ? palette.neutralDark : palette.neutralLight,
            },
            [
              el(
                {
                  display: "flex",
                  fontFamily: fonts.heading,
                  fontWeight: 700,
                  fontSize: `${34 * scale}px`,
                },
                `0${index + 1}`
              ),
              el(
                {
                  display: "flex",
                  marginTop: `${18 * scale}px`,
                  fontSize: `${20 * scale}px`,
                  lineHeight: 1.2,
                },
                line
              ),
            ]
          )
        )
    ),
    ctaBar(tokens, content, fonts, scale, true),
  ]);
}

function offerBurstAd(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  variant: "portrait" | "square"
): SatoriNode {
  const { palette } = tokens;
  const scale = socialScale(variant);
  const subhead = safeSubhead(content, variant);
  return socialFrame(tokens, fonts, scale, [
    socialHeader(tokens, content, fonts, scale, "OFFER"),
    el(
      {
        display: "flex",
        flexDirection: "row",
        flexGrow: 1,
        alignItems: "center",
        marginTop: `${42 * scale}px`,
      },
      [
        el(
          {
            display: "flex",
            flexDirection: "column",
            width: "56%",
          },
          [
            el(
              {
                display: "flex",
                fontFamily: fonts.heading,
                fontWeight: 700,
                fontSize: `${84 * scale}px`,
                lineHeight: 0.98,
                color: palette.neutralDark,
                maxWidth: "100%",
                overflow: "hidden",
              },
              safeHeadline(content, variant)
            ),
            subhead
              ? el(
                  {
                    display: "flex",
                    marginTop: `${24 * scale}px`,
                    fontSize: `${28 * scale}px`,
                    lineHeight: 1.25,
                    color: palette.secondary,
                    overflow: "hidden",
                  },
                  subhead
                )
              : el({ display: "flex" }),
          ]
        ),
        el(
          {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "44%",
            height: `${420 * scale}px`,
            borderRadius: `${999 * scale}px`,
            backgroundColor: palette.accent,
            border: `${12 * scale}px solid ${palette.neutralDark}`,
            padding: `${30 * scale}px`,
          },
          [
            el(
              {
                display: "flex",
                textAlign: "center",
                fontFamily: fonts.heading,
                fontWeight: 700,
                fontSize: `${42 * scale}px`,
                lineHeight: 1.05,
                color: palette.neutralDark,
                maxWidth: "100%",
                overflow: "hidden",
              },
              safeCta(content, variant) || "Shop now"
            ),
          ]
        ),
      ]
    ),
    el(
      {
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        marginTop: `${24 * scale}px`,
      },
      content.body.slice(0, 5).map((line) => benefitChip(line, tokens, scale))
    ),
  ]);
}

function proofChecklistAd(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  variant: "portrait" | "square"
): SatoriNode {
  const { palette } = tokens;
  const scale = socialScale(variant);
  const lines = content.body.length
    ? safeBodyLines(content.body, 5, 44)
    : [content.subhead || content.headline, content.cta]
        .map((line) => truncateDisplayText(line, 44))
        .filter(Boolean);
  const subhead = safeSubhead(content, variant);
  return socialFrame(tokens, fonts, scale, [
    socialHeader(tokens, content, fonts, scale, "WHY IT WORKS"),
    el(
      {
        display: "flex",
        flexDirection: "row",
        flexGrow: 1,
        marginTop: `${42 * scale}px`,
        borderRadius: `${44 * scale}px`,
        overflow: "hidden",
        backgroundColor: palette.neutralDark,
      },
      [
        el(
          {
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "52%",
            padding: `${42 * scale}px`,
          },
          [
            el(
              {
                display: "flex",
                fontFamily: fonts.heading,
                fontWeight: 700,
                fontSize: `${66 * scale}px`,
                lineHeight: 1,
                color: palette.neutralLight,
                maxWidth: "100%",
                overflow: "hidden",
              },
              safeHeadline(content, variant)
            ),
            subhead
              ? el(
                  {
                    display: "flex",
                    marginTop: `${22 * scale}px`,
                    fontSize: `${24 * scale}px`,
                    lineHeight: 1.25,
                    color: palette.accent,
                    overflow: "hidden",
                  },
                  subhead
                )
              : el({ display: "flex" }),
            ctaBar(tokens, content, fonts, scale, false),
          ]
        ),
        el(
          {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flexGrow: 1,
            padding: `${40 * scale}px`,
            backgroundColor: palette.primary,
          },
          lines.map((line) =>
            el(
              {
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                marginBottom: `${18 * scale}px`,
              },
              [
                el(
                  {
                    display: "flex",
                    width: `${34 * scale}px`,
                    height: `${34 * scale}px`,
                    marginRight: `${14 * scale}px`,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: `${999 * scale}px`,
                    backgroundColor: palette.accent,
                    color: palette.neutralDark,
                    fontWeight: 700,
                    fontSize: `${18 * scale}px`,
                  },
                  "+"
                ),
                el(
                  {
                    display: "flex",
                    flex: 1,
                    fontSize: `${24 * scale}px`,
                    lineHeight: 1.18,
                    color: palette.neutralLight,
                  },
                  line
                ),
              ]
            )
          )
        ),
      ]
    ),
  ]);
}

function socialAd(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  variant: "portrait" | "square",
  visualImageDataUrl?: string,
  useTemplateFrame = true
): SatoriNode {
  if (visualImageDataUrl) {
    if (!useTemplateFrame) {
      return fullBleedImageAd(tokens, content, fonts, variant, visualImageDataUrl);
    }
    return imageLedAd(tokens, content, fonts, variant, visualImageDataUrl);
  }
  const layouts = [productHeroAd, editorialAd, offerBurstAd, proofChecklistAd];
  const index = Math.floor(Math.random() * layouts.length);
  return layouts[index](tokens, content, fonts, variant);
}

function imageLedAd(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  variant: "portrait" | "square",
  visualImageDataUrl: string
): SatoriNode {
  const { palette } = tokens;
  const scale = socialScale(variant);
  const portrait = variant === "portrait";
  const headline = safeHeadline(content, variant);
  const subhead = safeSubhead(content, variant);
  const headlineLines = lineBreakText(headline, portrait ? 22 : 16, 2);
  const subheadLines = lineBreakText(subhead, portrait ? 34 : 28, 2);
  const bodyLines = safeBodyLines(
    content.body,
    portrait ? 3 : 4,
    portrait ? 58 : 46
  );
  const cta = safeCta(content, variant);
  const ctaLines = lineBreakText(cta, portrait ? 22 : 18, 1);
  return socialFrame(tokens, fonts, scale, [
    socialHeader(tokens, content, fonts, scale, "AI VISUAL"),
    el(
      {
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        marginTop: `${34 * scale}px`,
        borderRadius: `${42 * scale}px`,
        overflow: "hidden",
        backgroundColor: palette.neutralDark,
      },
      [
        el(
          {
            display: "flex",
            width: "100%",
            height: `${(portrait ? 650 : 520) * scale}px`,
            backgroundColor: palette.primary,
          },
          [
            imageEl(visualImageDataUrl, {
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }),
          ]
        ),
        el(
          {
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            flexGrow: 1,
            width: "100%",
            padding: `${portrait ? 38 * scale : 30 * scale}px`,
            backgroundColor: palette.neutralDark,
            overflow: "hidden",
          },
          [
            el(
              { display: "flex", flexDirection: "column" },
              [
                textStack(
                  headlineLines,
                  {
                    fontFamily: fonts.heading,
                    fontWeight: 700,
                    fontSize: `${portrait ? 48 * scale : 29 * scale}px`,
                    lineHeight: 1,
                    color: palette.neutralLight,
                  },
                  4 * scale
                ),
                subheadLines.length
                  ? el(
                      {
                        display: "flex",
                        flexDirection: "column",
                        marginTop: `${18 * scale}px`,
                      },
                      [
                        textStack(
                          subheadLines,
                          {
                            fontSize: `${portrait ? 22 * scale : 16 * scale}px`,
                            lineHeight: 1.18,
                            color: palette.accent,
                          },
                          3 * scale
                        ),
                      ]
                    )
                  : el({ display: "flex" }),
              ]
            ),
            el(
              {
                display: "flex",
                flexDirection: "column",
                marginTop: `${26 * scale}px`,
              },
              bodyLines.map((line) =>
                el(
                  {
                    display: "flex",
                    marginTop: `${10 * scale}px`,
                    fontSize: `${portrait ? 19 * scale : 14 * scale}px`,
                    lineHeight: 1.22,
                    color: palette.neutralLight,
                    maxWidth: "100%",
                    overflow: "hidden",
                  },
                  line
                )
              )
            ),
            cta
              ? el(
                  {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: `${26 * scale}px`,
                    borderRadius: `${18 * scale}px`,
                    backgroundColor: palette.accent,
                    padding: `${14 * scale}px ${16 * scale}px`,
                    color: palette.neutralDark,
                    fontFamily: fonts.heading,
                    fontWeight: 700,
                    width: "100%",
                  },
                  [
                    textStack(
                      ctaLines,
                      {
                        textAlign: "center",
                        fontSize: `${portrait ? 22 * scale : 15 * scale}px`,
                        lineHeight: 1,
                        color: palette.neutralDark,
                      },
                      0
                    ),
                  ]
                )
              : el({ display: "flex" }),
          ]
        ),
      ]
    ),
  ]);
}

function fullBleedImageAd(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  variant: "portrait" | "square",
  visualImageDataUrl: string
): SatoriNode {
  const { palette } = tokens;
  const scale = socialScale(variant);
  const portrait = variant === "portrait";
  const headline = safeHeadline(content, variant);
  const subhead = safeSubhead(content, variant);
  const cta = safeCta(content, variant);
  return el(
    {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      backgroundColor: palette.neutralDark,
      fontFamily: fonts.body,
    },
    [
      el(
        {
          display: "flex",
          height: portrait ? "68%" : "62%",
          width: "100%",
          backgroundColor: palette.primary,
        },
        [
          imageEl(visualImageDataUrl, {
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }),
        ]
      ),
      el(
        {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flexGrow: 1,
          padding: `${42 * scale}px ${52 * scale}px`,
          backgroundColor: palette.neutralDark,
        },
        [
          el(
            {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            },
            [
              el(
                {
                  display: "flex",
                  fontFamily: fonts.heading,
                  fontWeight: 700,
                  fontSize: `${30 * scale}px`,
                  color: palette.neutralLight,
                },
                content.brandName
              ),
              content.tagline
                ? el(
                    {
                      display: "flex",
                      fontSize: `${17 * scale}px`,
                      color: palette.accent,
                    },
                    content.tagline
                  )
                : el({ display: "flex" }),
            ]
          ),
          el(
            { display: "flex", flexDirection: "column" },
            [
              el(
                {
                  display: "flex",
                  fontFamily: fonts.heading,
                  fontWeight: 700,
                  fontSize: `${portrait ? 58 * scale : 46 * scale}px`,
                  lineHeight: 1,
                  color: palette.neutralLight,
                  maxWidth: "100%",
                  overflow: "hidden",
                },
                headline
              ),
              subhead
                ? el(
                    {
                      display: "flex",
                      marginTop: `${16 * scale}px`,
                      fontSize: `${22 * scale}px`,
                      lineHeight: 1.22,
                      color: palette.accent,
                      maxWidth: "100%",
                      overflow: "hidden",
                    },
                    subhead
                  )
                : el({ display: "flex" }),
            ]
          ),
          cta
            ? el(
                {
                  display: "flex",
                  alignSelf: "flex-start",
                  borderRadius: `${999 * scale}px`,
                  backgroundColor: palette.accent,
                  padding: `${16 * scale}px ${24 * scale}px`,
                  color: palette.neutralDark,
                  fontFamily: fonts.heading,
                  fontWeight: 700,
                  fontSize: `${22 * scale}px`,
                  maxWidth: "100%",
                  overflow: "hidden",
                },
                cta
              )
            : el({ display: "flex" }),
        ]
      ),
    ]
  );
}


function buildNode(
  type: CollateralType,
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  visualImageDataUrl?: string,
  useTemplateFrame = true
): SatoriNode {
  if (type === "business-card") return businessCard(tokens, content, fonts);
  if (type === "ad" || type === "poster") {
    return socialAd(
      tokens,
      content,
      fonts,
      "square",
      visualImageDataUrl,
      useTemplateFrame
    );
  }
  return socialAd(
    tokens,
    content,
    fonts,
    "portrait",
    visualImageDataUrl,
    useTemplateFrame
  );
}

export type RenderedCollateral = {
  svg: string;
  width: number;
  height: number;
};

/**
 * Render one collateral piece to a self-contained SVG string. Loads the brand's
 * fonts (process-cached), builds the typed layout, and shapes text to vector
 * paths via Satori. Throws on font-load/render failure (the route surfaces it).
 */
export async function renderCollateral(
  type: CollateralType,
  tokens: DesignTokens,
  content: CollateralContent,
  options: { visualImageDataUrl?: string; useTemplateFrame?: boolean } = {}
): Promise<RenderedCollateral> {
  const { width, height } = DIMENSIONS[type];
  const fonts = await loadBrandFonts(
    tokens.typography.headingFamily,
    tokens.typography.bodyFamily
  );
  const node = buildNode(
    type,
    tokens,
    content,
    {
      heading: tokens.typography.headingFamily,
      body: tokens.typography.bodyFamily,
    },
    options.visualImageDataUrl,
    options.useTemplateFrame ?? true
  );
  const svg = prefixSvgIds(await satori(node as never, { width, height, fonts }));
  return { svg, width, height };
}
