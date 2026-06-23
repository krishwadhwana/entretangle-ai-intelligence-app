import satori from "satori";
import type {
  CollateralContent,
  CollateralType,
  DesignTokens,
} from "@/lib/schema";
import { loadBrandFonts } from "./fonts";

// ---------------------------------------------------------------------------
// Deterministic collateral rendering. The LLM supplies only the COPY; layout +
// brand styling come straight from the design tokens, so a business card, a
// flyer, and a poster all read as one brand. Satori turns these node trees into
// self-contained SVGs (glyphs shaped to vector paths), which are editable,
// downloadable, and import cleanly into Figma.
// ---------------------------------------------------------------------------

// Minimal hyperscript: Satori accepts the JSX-compiled VDOM shape directly, so
// we build it without pulling React into a server lib.
type SatoriStyle = Record<string, string | number>;
type SatoriNode = {
  type: string;
  props: { style: SatoriStyle; children?: SatoriNode[] | string };
};

function el(
  style: SatoriStyle,
  children?: SatoriNode[] | string
): SatoriNode {
  return { type: "div", props: { style, ...(children !== undefined ? { children } : {}) } };
}

const DIMENSIONS: Record<CollateralType, { width: number; height: number }> = {
  "business-card": { width: 1050, height: 600 }, // 3.5"×2" @ 300dpi
  flyer: { width: 1000, height: 1414 }, // A-series ratio
  poster: { width: 1200, height: 1697 },
};

export const COLLATERAL_LABELS: Record<CollateralType, string> = {
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

// Shared poster/flyer layout — same structure, different scale, so both read as
// the same brand. A bold color header band, headline, supporting lines, CTA.
function posterLike(
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string },
  scale: number
): SatoriNode {
  const { palette } = tokens;
  return el(
    {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      backgroundColor: palette.neutralLight,
      fontFamily: fonts.body,
    },
    [
      // Header band
      el(
        {
          display: "flex",
          flexDirection: "column",
          backgroundColor: palette.primary,
          padding: `${56 * scale}px ${64 * scale}px`,
        },
        [
          el(
            {
              display: "flex",
              fontFamily: fonts.heading,
              fontWeight: 700,
              fontSize: `${40 * scale}px`,
              color: palette.neutralLight,
            },
            content.brandName
          ),
          content.tagline
            ? el(
                {
                  display: "flex",
                  marginTop: `${8 * scale}px`,
                  fontSize: `${22 * scale}px`,
                  color: palette.neutralLight,
                },
                content.tagline
              )
            : el({ display: "flex" }),
        ]
      ),
      // Body
      el(
        {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "center",
          padding: `${64 * scale}px`,
        },
        [
          el(
            {
              display: "flex",
              fontFamily: fonts.heading,
              fontWeight: 700,
              fontSize: `${72 * scale}px`,
              lineHeight: 1.05,
              color: palette.neutralDark,
            },
            content.headline || content.brandName
          ),
          content.subhead
            ? el(
                {
                  display: "flex",
                  marginTop: `${20 * scale}px`,
                  fontSize: `${30 * scale}px`,
                  color: palette.secondary,
                },
                content.subhead
              )
            : el({ display: "flex" }),
          el(
            {
              display: "flex",
              flexDirection: "column",
              marginTop: `${40 * scale}px`,
            },
            content.body.slice(0, 5).map((line) =>
              el(
                {
                  display: "flex",
                  marginBottom: `${14 * scale}px`,
                  fontSize: `${28 * scale}px`,
                  color: palette.neutralDark,
                },
                `•  ${line}`
              )
            )
          ),
        ]
      ),
      // CTA footer
      content.cta
        ? el(
            {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.accent,
              padding: `${32 * scale}px`,
            },
            [
              el(
                {
                  display: "flex",
                  fontFamily: fonts.heading,
                  fontWeight: 700,
                  fontSize: `${34 * scale}px`,
                  color: palette.neutralDark,
                },
                content.cta
              ),
            ]
          )
        : el({ display: "flex", height: "0px" }),
    ]
  );
}

function buildNode(
  type: CollateralType,
  tokens: DesignTokens,
  content: CollateralContent,
  fonts: { heading: string; body: string }
): SatoriNode {
  if (type === "business-card") return businessCard(tokens, content, fonts);
  if (type === "poster") return posterLike(tokens, content, fonts, 1.4);
  return posterLike(tokens, content, fonts, 1);
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
  content: CollateralContent
): Promise<RenderedCollateral> {
  const { width, height } = DIMENSIONS[type];
  const fonts = await loadBrandFonts(
    tokens.typography.headingFamily,
    tokens.typography.bodyFamily
  );
  const node = buildNode(type, tokens, content, {
    heading: tokens.typography.headingFamily,
    body: tokens.typography.bodyFamily,
  });
  const svg = await satori(node as never, { width, height, fonts });
  return { svg, width, height };
}
