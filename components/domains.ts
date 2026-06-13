// Shared business-domain metadata (label + icon) used by the panel strip and
// the Playbook view, so the two never drift. Colours live in segments.ts.
import {
  BarChart3,
  Swords,
  Shirt,
  Factory,
  Package,
  Store,
  Scale,
  Tag,
  Wallet,
  Share2,
  Users,
  Sparkles,
} from "lucide-react";
import type { Domain } from "@/lib/schema";

export const DOMAIN_META: Record<
  Domain,
  { label: string; icon: typeof BarChart3 }
> = {
  market: { label: "Market", icon: BarChart3 },
  competitor: { label: "Competitors", icon: Swords },
  product: { label: "Product", icon: Shirt },
  supply: { label: "Manufacturing", icon: Factory },
  operations: { label: "Operations", icon: Package },
  channel: { label: "Channels", icon: Store },
  regulation: { label: "Trade & Law", icon: Scale },
  pricing: { label: "Pricing", icon: Tag },
  finance: { label: "Unit Economics", icon: Wallet },
  social: { label: "Social", icon: Share2 },
  audience: { label: "Audience", icon: Users },
  synthesis: { label: "Action Plans", icon: Sparkles },
};

// Order for the top panel strip (research desks first, syntheses last).
export const DOMAIN_ORDER: Domain[] = [
  "market",
  "competitor",
  "product",
  "supply",
  "operations",
  "channel",
  "regulation",
  "pricing",
  "finance",
  "social",
  "audience",
  "synthesis",
];

// Order for the Playbook (action plans first — they answer "what do I do?"),
// then the operating modules, audience last.
export const PLAYBOOK_ORDER: Domain[] = [
  "synthesis",
  "market",
  "product",
  "competitor",
  "supply",
  "operations",
  "channel",
  "pricing",
  "finance",
  "regulation",
  "social",
  "audience",
];
