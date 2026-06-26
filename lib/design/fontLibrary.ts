export type DesignFontOption = {
  family: string;
  label?: string;
  role: "heading" | "body" | "both";
  category: string;
  googleFamily?: string;
  stack: string;
};

export const DESIGN_FONT_OPTIONS: DesignFontOption[] = [
  {
    family: "Butler",
    role: "heading",
    category: "Editorial serif",
    googleFamily: "Libre Baskerville",
    stack: '"Butler", "Libre Baskerville", Georgia, serif',
  },
  {
    family: "Fraunces",
    role: "heading",
    category: "Editorial serif",
    googleFamily: "Fraunces",
    stack: '"Fraunces", Georgia, serif',
  },
  {
    family: "Instrument Serif",
    role: "heading",
    category: "Editorial serif",
    googleFamily: "Instrument Serif",
    stack: '"Instrument Serif", Georgia, serif',
  },
  {
    family: "Playfair Display",
    role: "heading",
    category: "Editorial serif",
    googleFamily: "Playfair Display",
    stack: '"Playfair Display", Georgia, serif',
  },
  {
    family: "Cormorant Garamond",
    role: "heading",
    category: "Editorial serif",
    googleFamily: "Cormorant Garamond",
    stack: '"Cormorant Garamond", Georgia, serif',
  },
  {
    family: "DM Serif Display",
    role: "heading",
    category: "Editorial serif",
    googleFamily: "DM Serif Display",
    stack: '"DM Serif Display", Georgia, serif',
  },
  {
    family: "Libre Baskerville",
    role: "both",
    category: "Readable serif",
    googleFamily: "Libre Baskerville",
    stack: '"Libre Baskerville", Georgia, serif',
  },
  {
    family: "Newsreader",
    role: "both",
    category: "Readable serif",
    googleFamily: "Newsreader",
    stack: '"Newsreader", Georgia, serif',
  },
  {
    family: "Lora",
    role: "both",
    category: "Readable serif",
    googleFamily: "Lora",
    stack: '"Lora", Georgia, serif',
  },
  {
    family: "Prata",
    role: "heading",
    category: "Fashion serif",
    googleFamily: "Prata",
    stack: '"Prata", Georgia, serif',
  },
  {
    family: "Bodoni Moda",
    role: "heading",
    category: "Fashion serif",
    googleFamily: "Bodoni Moda",
    stack: '"Bodoni Moda", "Times New Roman", serif',
  },
  {
    family: "Marcellus",
    role: "heading",
    category: "Elegant serif",
    googleFamily: "Marcellus",
    stack: '"Marcellus", Georgia, serif',
  },
  {
    family: "Cinzel",
    role: "heading",
    category: "Luxury caps",
    googleFamily: "Cinzel",
    stack: '"Cinzel", Georgia, serif',
  },
  {
    family: "Syne",
    role: "heading",
    category: "Expressive sans",
    googleFamily: "Syne",
    stack: '"Syne", Inter, Arial, sans-serif',
  },
  {
    family: "Space Grotesk",
    role: "both",
    category: "Modern sans",
    googleFamily: "Space Grotesk",
    stack: '"Space Grotesk", Inter, Arial, sans-serif',
  },
  {
    family: "Bricolage Grotesque",
    role: "heading",
    category: "Modern sans",
    googleFamily: "Bricolage Grotesque",
    stack: '"Bricolage Grotesque", Inter, Arial, sans-serif',
  },
  {
    family: "Sora",
    role: "both",
    category: "Modern sans",
    googleFamily: "Sora",
    stack: '"Sora", Inter, Arial, sans-serif',
  },
  {
    family: "Outfit",
    role: "both",
    category: "Modern sans",
    googleFamily: "Outfit",
    stack: '"Outfit", Inter, Arial, sans-serif',
  },
  {
    family: "Manrope",
    role: "both",
    category: "Modern sans",
    googleFamily: "Manrope",
    stack: '"Manrope", Inter, Arial, sans-serif',
  },
  {
    family: "Inter",
    role: "both",
    category: "Neutral sans",
    googleFamily: "Inter",
    stack: '"Inter", Arial, sans-serif',
  },
  {
    family: "DM Sans",
    role: "body",
    category: "Neutral sans",
    googleFamily: "DM Sans",
    stack: '"DM Sans", Inter, Arial, sans-serif',
  },
  {
    family: "Work Sans",
    role: "body",
    category: "Neutral sans",
    googleFamily: "Work Sans",
    stack: '"Work Sans", Inter, Arial, sans-serif',
  },
  {
    family: "Source Sans 3",
    role: "body",
    category: "Neutral sans",
    googleFamily: "Source Sans 3",
    stack: '"Source Sans 3", Inter, Arial, sans-serif',
  },
  {
    family: "IBM Plex Sans",
    role: "body",
    category: "Neutral sans",
    googleFamily: "IBM Plex Sans",
    stack: '"IBM Plex Sans", Inter, Arial, sans-serif',
  },
  {
    family: "Libre Franklin",
    role: "body",
    category: "Neutral sans",
    googleFamily: "Libre Franklin",
    stack: '"Libre Franklin", Inter, Arial, sans-serif',
  },
  {
    family: "Poppins",
    role: "both",
    category: "Geometric sans",
    googleFamily: "Poppins",
    stack: '"Poppins", Inter, Arial, sans-serif',
  },
  {
    family: "Montserrat",
    role: "both",
    category: "Geometric sans",
    googleFamily: "Montserrat",
    stack: '"Montserrat", Inter, Arial, sans-serif',
  },
  {
    family: "Raleway",
    role: "both",
    category: "Geometric sans",
    googleFamily: "Raleway",
    stack: '"Raleway", Inter, Arial, sans-serif',
  },
  {
    family: "Nunito Sans",
    role: "body",
    category: "Friendly sans",
    googleFamily: "Nunito Sans",
    stack: '"Nunito Sans", Inter, Arial, sans-serif',
  },
  {
    family: "Lato",
    role: "body",
    category: "Friendly sans",
    googleFamily: "Lato",
    stack: '"Lato", Inter, Arial, sans-serif',
  },
  {
    family: "Open Sans",
    role: "body",
    category: "Friendly sans",
    googleFamily: "Open Sans",
    stack: '"Open Sans", Inter, Arial, sans-serif',
  },
  {
    family: "Roboto",
    role: "body",
    category: "Utility sans",
    googleFamily: "Roboto",
    stack: '"Roboto", Inter, Arial, sans-serif',
  },
  {
    family: "Archivo Black",
    role: "heading",
    category: "Display sans",
    googleFamily: "Archivo Black",
    stack: '"Archivo Black", Impact, Arial Black, sans-serif',
  },
  {
    family: "Unbounded",
    role: "heading",
    category: "Display sans",
    googleFamily: "Unbounded",
    stack: '"Unbounded", Inter, Arial, sans-serif',
  },
];

function normalizeFamily(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
}

export function fontOptionForFamily(family: string): DesignFontOption | null {
  const normalized = normalizeFamily(family);
  return (
    DESIGN_FONT_OPTIONS.find(
      (option) => normalizeFamily(option.family) === normalized
    ) ?? null
  );
}

export function fontCssStack(
  family: string | null | undefined,
  role: "heading" | "body" = "body"
): string {
  const clean = family?.trim();
  if (!clean) {
    return role === "heading" ? 'Georgia, serif' : 'Inter, Arial, sans-serif';
  }
  const option = fontOptionForFamily(clean);
  if (option) return option.stack;
  const fallback =
    role === "heading" ? 'Georgia, serif' : 'Inter, Arial, sans-serif';
  return `"${clean.replace(/"/g, "")}", ${fallback}`;
}

export function googleFontUrlForFamilies(families: string[]): string | null {
  const googleFamilies = Array.from(
    new Set(
      families
        .map((family) => fontOptionForFamily(family)?.googleFamily ?? family)
        .map((family) => family.trim())
        .filter(Boolean)
    )
  );
  if (!googleFamilies.length) return null;
  const query = googleFamilies
    .map(
      (family) =>
        `family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;500;600;700;800`
    )
    .join("&");
  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

export function googleFontUrlForFamily(family: string): string | null {
  return googleFontUrlForFamilies([family]);
}
