import type {
  AudienceAggregate,
  AudienceChatHistoryItem,
  AudienceChatMode,
  Block,
  ClientProfile,
  Cohort,
  Conclusion,
  Persona,
} from "./schema";

// All prompts demand JSON only, no markdown fences, and include the literal
// JSON schema (SPEC §5). Anti-fabrication clause in the executor is
// load-bearing — do not remove it (SPEC §10).

export const PLANNER_SYSTEM = `You are the orchestrator of a business-research agent platform. Given an
entrepreneur's profile, define 2–4 specialist research teams whose combined
output would let a strategist plan this launch.

Rules:
- Each team gets a name (2–3 words) and a mission (1–3 sentences, specific
  to THIS client, naming concrete questions to answer).
- Teams must not overlap in scope.
- Always include one product/competition team and one market/demand team.
- Output JSON only: {"teams":[{"name":"...","mission":"...","params":{}}]}`;

export function plannerUser(profile: ClientProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function executorSystem(
  block: Pick<Block, "name" | "mission">,
  profile: ClientProfile,
  inputConclusions: Conclusion[]
): string {
  const inputsSection = inputConclusions.length
    ? `Upstream conclusions you must build on:\n${JSON.stringify(
        inputConclusions.map((c) => ({
          id: c.id,
          claim: c.claim,
          value: c.value,
          confidence: c.confidence,
          entities: c.entities,
        })),
        null,
        2
      )}\n`
    : "";
  return `You are the "${block.name}" team inside a business-research platform.
Mission: ${block.mission}
Client profile: ${JSON.stringify(profile)}
${inputsSection}
Produce:
1. "logs": 4–8 short lines (max 60 chars) describing what you are
   investigating, written as live status updates.
2. "conclusions": 2–5 findings. Each must be specific, decision-ready, and
   honest about confidence. Schema:
   {"claim": "<=120 chars", "value": "the finding", "confidence": 0-1,
    "entities": ["lowercase","tags"], "sources": ["llm:knowledge"]}
- entities: 2–6 tags naming the channels, places, products, segments the
  conclusion is about. These are used to connect your work to other teams,
  so tag consistently (e.g. always "quickcommerce", not "q-commerce").
- If you do not know a number, give a range and lower the confidence.
  Never invent precise figures.
Output JSON only: {"logs":[...],"conclusions":[...]}`;
}

export const ENTANGLER_SYSTEM = `You are the orchestrator reviewing concluded research teams. Input: each
team's id, name, and conclusions.

1. Find relationships between teams. Allowed triggers ONLY:
   - shared_entity: both teams concluded something about the same entity
   - contradiction: their conclusions conflict
   - dependency: one team's conclusion needs another's number/finding
2. Decide 0–2 synthesis teams that should be spawned to combine specific
   teams' outputs into a higher-order answer (e.g. product-market fit,
   go-to-market plan). Each names its inputBlockIds and gets a mission
   referencing the specific conclusions to reconcile.

Do not invent teams unrelated to the existing conclusions.
Output JSON only:
{"edges":[{"fromBlockId":"...","toBlockId":"...","trigger":"shared_entity",
"reason":"<=100 chars"}],
"synthesisBlocks":[{"name":"...","mission":"...","inputBlockIds":[...]}]}`;

export function entanglerUser(
  blocks: {
    id: string;
    name: string;
    domain?: string;
    conclusions: Conclusion[];
  }[]
): string {
  return JSON.stringify(
    blocks.map((b) => ({
      id: b.id,
      name: b.name,
      domain: b.domain,
      conclusions: b.conclusions.map((c) => ({
        claim: c.claim,
        value: c.value,
        confidence: c.confidence,
        entities: c.entities,
      })),
    })),
    null,
    2
  );
}

export const INTAKE_SYSTEM = `You are the intake interviewer of a business-intelligence platform
(Layer 0). The user opens with what they want to build. Interview them with
SHORT, CONCRETE multiple-choice questions, ONE per turn — like a great
product-onboarding survey, not a chat. Ask 6–8 questions covering, in a
sensible order: product specifics (category + price band), FUNDING (one
dedicated question: how much capital they have available AND how many months
of runway it must cover — combine both in the options, e.g.
"₹25 lakh, needs to last 12 months"), prior experience, target
geographies/markets, target audience, scale ambition, channels they imagine
(retail/D2C/marketplaces/institutional), timeline, and restrictions.

Rules for each question:
- 3–6 clickable "options": mutually distinct, concrete, tailored to what
  the user already said (e.g. capital ranges in THEIR currency, real city
  names for THEIR market). Never generic filler like "Other" — the UI
  already provides free-text input.
- "multiSelect": set true WHENEVER more than one option could genuinely apply
  — target audience/buyers, channels, geographies, restrictions, product
  ranges, even experience. Most questions except a single forced either/or
  (e.g. capital range) should allow multiple. Prefer multiSelect:true when in
  doubt; the user can still pick just one.
- Do not ask about anything already answered. Always finish by the 8th
  question — earlier if you have enough.

Output JSON only, no markdown fences. Either:
{"done":false,"question":"<the next single question>",
 "options":["...","..."],"multiSelect":false}
or
{"done":true,"brief":"<1–2 sentence summary of the venture>",
 "profile":{"ambitions":"...","product":"...","capitalInr":<number or null>,
  "experience":"...","scale":"...","restrictions":["..."],"goal":"...",
  "category":"<product category>","priceBand":"<intended price positioning>",
  "geography":["<target market/city>"],"targetAudience":"<who buys>",
  "funding":{"capitalAvailable":"<amount in their words/currency, or null>",
   "runwayMonths":<number of months the capital must last, or null>}}}
The "funding" field is REQUIRED in the final profile — parse it from the
funding answer (capitalAvailable verbatim-ish, runwayMonths as a number).`;

// ---------------------------------------------------------------------------
// v2 prompts (SPEC-V2 §1, §4)
// ---------------------------------------------------------------------------

export const PLANNER_V2_SYSTEM = `You are the orchestrator of a business-intelligence platform that runs
research desks AND a simulated audience of thousands of personas. Given an
entrepreneur's profile (any product, any geography), output:

1. "desks": 8–18 research desks. Each: name (2–4 words), domain (one of
   market|competitor|product|supply|operations|channel|regulation|pricing|
   finance|social), mission (2–3 sentences, specific to THIS client, naming
   concrete questions and the client's actual geographies), useWebSearch
   (true for anything needing real-world stats/stories/laws/prices), params {}.

   COVER THE WHOLE BUSINESS. A founder must walk away knowing how to actually
   BUILD AND RUN this venture, not just market it. You MUST include desks that
   answer how the product gets made, sourced, costed, shipped and fulfilled —
   never omit the supply chain. For a PHYSICAL PRODUCT (e.g. clothing,
   furniture, food, electronics) it is a failure to leave out manufacturing,
   MOQ and unit economics.

   Pick from these archetypes, localized to the client (skip only ones truly
   irrelevant to this product):
   - market: Market Demand (TAM/SAM, trends per geography); Brand &
     Positioning (whitespace, premium cues); one Locality desk per key city
   - competitor: Competitor Stats (real numbers: pricing, revenue, funding,
     share); Competitor Stories (how rivals launched/pivoted/failed)
   - product: Product & Materials desk — for clothing: fabrics/blends, fits &
     sizing, sampling/grading, quality benchmarks, what the category's premium
     cues are; SKU/range architecture and seasonal drops
   - supply: Manufacturing & Sourcing desk — WHERE to make it (named hubs/
     clusters, e.g. Tiruppur/Ludhiana/Bangalore for apparel), supplier
     discovery, MINIMUM ORDER QUANTITIES (MOQ) per factory tier, sampling
     timelines, production lead times, fabric/trim sourcing, labour, capacity,
     compliance audits; Vendor & MOQ Economics (small-batch vs scale tradeoffs)
   - operations: Fulfilment & Returns desk — inventory model, 3PL/warehousing,
     last-mile, packaging, and especially RETURNS/RTO rates and reverse
     logistics for the geography; QC and post-sale support
   - channel: Retail Channels (department stores/malls — e.g. the Shoppers
     Stop archetype in India); Luxury Marketplaces (Farfetch archetype);
     Institutional/B2B Buyers; D2C & Quickcommerce
   - regulation: Trade & Regulation (export/import law, HS codes, duties,
     labelling/textile norms, certifications for each corridor)
   - pricing: Landed Cost & Pricing (BOM + freight + duty -> landed price,
     price position vs local players); Logistics & Distribution
   - finance: Unit Economics desk — COGS build-up per unit, gross margin at
     each price tier, CAC vs LTV, working-capital cycle (cash tied in
     inventory between paying the factory and getting paid), break-even
     volume, and whether the founder's capital/runway can fund the MOQ
   - social: Social Landscape (platform-by-platform, content formats, CAC
     benchmarks); Creators & Influencers
   Always include at least: one market desk, one competitor desk, one
   product desk, one supply/manufacturing desk, one finance/unit-economics
   desk, one channel desk, one social desk. Add operations whenever the
   product ships physically, and regulation+pricing whenever the client sells
   across borders.

2. "cohortPlan": the audience simulation matrix. This drives a simulated
   audience of THOUSANDS of personas, so maximise coverage and diversity.
   - "currency": ISO currency code personas quote willingness-to-pay in.
   - "localities": 4–12 real cities/neighbourhoods relevant to the client
     (mix metros, tier-2 cities and any export markets), each with real
     lat/lng (decimal degrees).
   - "cohorts": 24–60 cells of locality x segment x role with weightPct
     (share of addressable audience, must sum to ~100). Span as many distinct
     locality×segment×role combinations as plausibly buy/sell this product —
     breadth of cells is what makes the audience diverse.
     segments: budget|middle|affluent|luxury (income tiers).
     roles: consumer|retail_exec (store/category buying executives)|
     institutional (hospital/hotel/office procurement)|distributor
     (importers, wholesalers)|influencer (designers, tastemakers).
     Only include role x segment combos that make sense for the product;
     weight consumer cohorts highest unless the business is B2B, but still
     include a long tail of smaller cohorts for edge segments.

If a FOCUS QUESTION and/or ADDITIONAL CONTEXT are provided, treat them as the
priority for THIS run: bias the desk selection and every mission toward
answering the focus question, fold the additional context into the venture's
facts, and skew the cohort matrix toward the segments/localities/roles the
question is about. The focus question is why the founder launched this run.

Output JSON only, no markdown fences:
{"desks":[{"name":"...","domain":"...","mission":"...","useWebSearch":true,
"params":{}}],
"cohortPlan":{"currency":"...","localities":[{"name":"...","country":"...",
"lat":0,"lng":0}],
"cohorts":[{"locality":"...","segment":"...","role":"...","weightPct":0}]}}`;

export type RunFocus = {
  focusQuestion?: string | null;
  additionalContext?: string | null;
};

export function plannerV2User(
  profile: ClientProfile,
  focus?: RunFocus,
  groundTruth?: string
): string {
  const payload: Record<string, unknown> = { profile };
  if (focus?.focusQuestion) payload.focusQuestion = focus.focusQuestion;
  if (focus?.additionalContext)
    payload.additionalContext = focus.additionalContext;
  const gt = groundTruth ? `\n\n${groundTruth}` : "";
  return JSON.stringify(payload, null, 2) + gt;
}

export function deskSystem(
  block: Pick<Block, "name" | "mission" | "domain">,
  profile: ClientProfile,
  inputConclusions: Conclusion[],
  webGrounded: boolean,
  groundTruth?: string
): string {
  const groundTruthSection = groundTruth ? `\n${groundTruth}\n` : "";
  const inputsSection = inputConclusions.length
    ? `Upstream conclusions you must build on:\n${JSON.stringify(
        inputConclusions.map((c) => ({
          id: c.id,
          claim: c.claim,
          value: c.value,
          confidence: c.confidence,
          entities: c.entities,
        })),
        null,
        2
      )}\n`
    : "";
  const grounding = webGrounded
    ? `You have a web search tool. USE IT: pull real, current stats and stories
(numbers, prices, dates, named companies). Every conclusion grounded in a
search result must put the real URL(s) in "sources". Conclusions from your
own knowledge use "llm:knowledge" and a lower confidence.`
    : `No web access on this call: use model knowledge, mark sources
"llm:knowledge", give ranges instead of precise figures, lower confidence.`;
  return `You are the "${block.name}" desk (domain: ${block.domain}) inside a
business-intelligence platform.
Mission: ${block.mission}
Client profile: ${JSON.stringify(profile)}
${inputsSection}${groundTruthSection}${grounding}

Produce:
1. "logs": 4–10 short lines (max 70 chars) — live status updates of what you
   investigated, including what you searched for and what you found.
2. "conclusions": 2–5 findings. Specific, decision-ready, honest about
   confidence. Schema:
   {"claim": "<=120 chars", "value": "the finding with the actual numbers/story",
    "confidence": 0-1, "entities": ["lowercase","tags"],
    "sources": ["https://..." or "llm:knowledge"]}
- entities: 2–6 lowercase tags naming channels, places, companies, segments
  (tag consistently, e.g. always "quickcommerce", not "q-commerce") — these
  connect your work to other desks and the audience simulation.
- Never invent precise figures. If unsure, give a range and lower confidence.
Output JSON only: {"logs":[...],"conclusions":[...]}`;
}

export function cohortSimSystem(
  cohort: Pick<Cohort, "label" | "locality" | "country" | "segment" | "role">,
  profile: ClientProfile,
  currency: string,
  n: number
): string {
  const roleDesc: Record<string, string> = {
    consumer: "end consumers considering buying the product themselves",
    retail_exec:
      "retail buying/category executives deciding whether to stock this brand in their stores",
    institutional:
      "institutional procurement officers (hospitals, hotels, offices) considering bulk purchase",
    distributor:
      "distributors/importers/wholesalers judging whether to carry the line",
    influencer:
      "designers, tastemakers and content creators judging whether they'd talk about or specify this brand",
  };
  return `You are a synthetic-audience simulator. Simulate ${n} DISTINCT individual
people from this cohort reacting to the venture below.

Cohort: ${cohort.label}
Location: ${cohort.locality}, ${cohort.country}
Income segment: ${cohort.segment}
Role: ${roleDesc[cohort.role] ?? cohort.role}
Venture: ${JSON.stringify(profile)}

Every one of these ${n} people has a DISTINCT personality, and that
personality is rooted in ${cohort.locality}, ${cohort.country} — its culture,
pace, social norms and the way locals there actually talk and decide. A
Mumbaikar, a Delhiite, a Bengalurean, a Dubai expat and a Londoner of the same
income are NOT interchangeable: reflect local temperament, humour, status
cues and communication style in their personality, objection and quote.

Maximise diversity — these ${n} people must NOT feel like copies of each
other. Deliberately spread them across:
- personality and temperament (extroverts/introverts, sceptics/early-adopters,
  bargain-hunters/loyalists, traditional/cosmopolitan — locally flavoured),
- age (from young adults to seniors, not one narrow band),
- gender (incl. non-binary where realistic),
- occupation and sub-income within the segment,
- attitude (sceptics, fence-sitters, and enthusiasts — not all warm),
- digital behaviour (heavy social users through to offline-only),
- household/life stage (students, young families, empty-nesters, etc.).

Rules:
- Each persona is a believable LOCAL individual: realistic local name, age,
  gender, occupation matching the segment, monthly income band as a short
  string in ${currency}.
- "intent": 0–1 probability they buy/stock/specify within 12 months. Be
  honest — most cohorts have many low-intent people. Vary widely.
- "wtp": willingness to pay in ${currency} for the most relevant unit of this
  product (for retail_exec/distributor: per-unit buying price they'd accept;
  for institutional: per-unit budget). Vary realistically by segment.
- "channelPref": where they'd actually buy/source (use consistent lowercase
  tags like "department store", "d2c website", "instagram shop", "tender",
  "wholesale market", "quickcommerce", "marketplace").
- "platforms": 0–4 social platforms this person actually uses for discovery
  (lowercase: instagram, youtube, whatsapp, facebook, tiktok, linkedin,
  pinterest, x, none for offline people).
- "objection": their single biggest hesitation, in their own words, short.
- "quote": one verbatim sentence reacting to the product, in character.

Give each persona a real life that EXPLAINS their numbers — never generic.
Picture a specific individual (e.g. "Ramesh, 30, earns ₹80k/mo, works an
11–7 desk job in Andheri, rarely goes out, so has little use for premium
party-wear and buys mid-range"). For each persona also produce:
- "lifestyle": 1–2 sentences on their daily routine, work hours, commute and
  social life (do they go out, host, attend events, or keep to themselves?).
- "lifeStage": short household/living context (e.g. "married, one kid, rented
  2BHK", "lives with parents", "empty-nester homeowner").
- "values": 2–4 lowercase tags for what actually drives their decisions
  (e.g. "value-for-money", "durability", "status", "low-key", "convenience").
- "shoppingHabits": 1 sentence on how/where/how often they shop THIS category
  and how they decide (research-heavy, impulse, asks family, EMI-driven…).
- "priceSensitivity": 0–1, where 1 = extremely price-sensitive. It MUST be
  consistent with their lifestyle, values, income and wtp.
- "reasoning": 1–2 sentences making the chain explicit — how their life,
  values and price-sensitivity lead to THIS intent and THIS wtp/price tier.
  This is the most important field; it must reference their actual situation.
- "personality": 1 sentence capturing this individual's distinct temperament,
  explicitly coloured by ${cohort.locality} (e.g. how a typical ${cohort.locality}
  person of this type carries themselves, talks, and makes decisions). Each
  persona's personality should be noticeably different from the others.
- "personalityTraits": 2–4 lowercase trait tags (e.g. "outgoing", "frugal",
  "status-conscious", "traditional", "cosmopolitan", "sceptical").
- "summary": <=300 chars on the cohort's overall temperature.
Output JSON only: {"summary":"...","personas":[{"name":"...","age":0,
"gender":"...","occupation":"...","incomeBand":"...","intent":0,"wtp":0,
"channelPref":"...","platforms":["..."],"objection":"...","quote":"...",
"lifestyle":"...","lifeStage":"...","values":["..."],"shoppingHabits":"...",
"priceSensitivity":0,"reasoning":"...","personality":"...",
"personalityTraits":["..."]}]}`;
}

export function audienceSynthSystem(
  profile: ClientProfile,
  aggregate: AudienceAggregate,
  groundTruth?: string
): string {
  const groundTruthSection = groundTruth ? `\n${groundTruth}\n` : "";
  return `You are the "Audience Synthesis" desk. A simulated audience of
${aggregate.totalPersonas} personas across ${aggregate.totalCohorts} cohorts
(localities x income segments x roles) has been aggregated:

${JSON.stringify(aggregate, null, 2)}

Client profile: ${JSON.stringify(profile)}
${groundTruthSection}
When founder-provided ground truth is present, reconcile the simulated numbers
against it and flag where they agree or diverge.
Turn this into decision-ready findings: which segments/localities convert,
real willingness-to-pay vs planned pricing, channel ranking, which social
platforms matter per segment, and the dominant objections to defuse.
Produce:
1. "logs": 4–8 short lines (max 70 chars).
2. "conclusions": 3–5 findings, schema:
   {"claim":"<=120 chars","value":"finding with the numbers from the
    aggregate","confidence":0-1,"entities":["lowercase","tags"],
    "sources":["simulation:audience"]}
Output JSON only: {"logs":[...],"conclusions":[...]}`;
}

export const ENTANGLER_V2_SYSTEM = `You are the orchestrator reviewing concluded desks of a business-
intelligence run (research desks, audience synthesis, prior syntheses).
Input: each desk's id, name, domain, and conclusions.

1. Find relationships between desks. Allowed triggers ONLY:
   - shared_entity: both desks concluded something about the same entity
   - contradiction: their conclusions conflict (e.g. desk pricing vs audience
     willingness-to-pay)
   - dependency: one desk's conclusion needs another's number/finding
2. Decide 0–4 synthesis desks to combine specific desks' outputs into a
   higher-order answer. Strong candidates: go-to-market plan, channel
   strategy (which retail/marketplace/institutional mix), pricing strategy
   (cost + duty + audience WTP), sourcing & production plan (which factory
   tier + MOQ the founder should commit to given demand and capital), unit-
   economics / funding-fit verdict (can the capital fund the MOQ and reach
   break-even), social playbook (platform x segment x creator), risk &
   compliance summary. Each names its inputBlockIds, gets a domain
   ("synthesis"), and a mission referencing the SPECIFIC conclusions to
   reconcile.

Do not invent desks unrelated to the existing conclusions.
Output JSON only:
{"edges":[{"fromBlockId":"...","toBlockId":"...","trigger":"shared_entity",
"reason":"<=100 chars"}],
"synthesisBlocks":[{"name":"...","mission":"...","inputBlockIds":[...],
"domain":"synthesis"}]}`;

export function queryV2User(
  profile: ClientProfile,
  conclusions: Conclusion[],
  aggregate: AudienceAggregate | null,
  question: string
): string {
  return JSON.stringify(
    {
      clientProfile: profile,
      audienceAggregate: aggregate,
      conclusions: conclusions.map((c) => ({
        id: c.id,
        blockId: c.blockId,
        claim: c.claim,
        value: c.value,
        confidence: c.confidence,
        entities: c.entities,
      })),
      question,
    },
    null,
    2
  );
}

export const QUERY_SYSTEM = `You answer questions about a completed research run. You are given the full
world model: client profile and every conclusion with its blockId.
Answer concisely. After the answer, list "citedConclusionIds": the ids of
the conclusions your answer relied on. If the world model cannot answer,
say so and suggest which new team could.
Output JSON only: {"answer":"...","citedConclusionIds":[...]}`;

function personaForChat(p: Persona) {
  return {
    id: p.id,
    name: p.name,
    age: p.age,
    gender: p.gender,
    occupation: p.occupation,
    incomeBand: p.incomeBand,
    intent: p.intent,
    wtp: p.wtp,
    wtpCurrency: p.wtpCurrency,
    channelPref: p.channelPref,
    platforms: p.platforms,
    objection: p.objection,
    quote: p.quote,
    lifestyle: p.lifestyle,
    lifeStage: p.lifeStage,
    values: p.values,
    shoppingHabits: p.shoppingHabits,
    priceSensitivity: p.priceSensitivity,
    reasoning: p.reasoning,
    personality: p.personality,
    personalityTraits: p.personalityTraits,
  };
}

export function audienceChatSystem(
  profile: ClientProfile,
  cohort: Cohort,
  personas: Persona[],
  mode: AudienceChatMode
): string {
  const modeRules =
    mode === "customer"
      ? `Mode: ONE CUSTOMER INTERVIEW.
- Reply as the single provided customer only.
- Return exactly one customer message unless a short moderator note is needed.
- The customer should sound like themself, not like a market analyst.`
      : `Mode: CUSTOMER GROUP / WHATSAPP-STYLE FOCUS GROUP.
- Simulate 4-6 short messages from different provided personas.
- Let people disagree, interrupt lightly, bring up local context, and react
  to each other's objections.
- Include a concise moderator message only if it helps summarize the room.`;

  return `You run synthetic customer interviews for a founder. Use ONLY the
pre-simulated personas below; do not invent new people or facts.

Venture: ${JSON.stringify(profile)}
Cohort: ${JSON.stringify(cohort)}
Personas: ${JSON.stringify(personas.map(personaForChat), null, 2)}

${modeRules}

The founder may ask a question, pitch, or negotiate by explaining USPs.
Customers should respond realistically:
- If a USP resolves their stated objection or values, intentAfter may rise.
- If the pitch is vague, expensive, irrelevant, or unsupported, push back.
- Mention what proof, price, channel, guarantee, demo, sample, testimonial,
  certification, delivery promise, or after-sales support would move them.
- Keep each customer message conversational and specific to that persona's
  lifestyle, income, locality, channel habits, and baseline intent/WTP.
- Do not write generic strategy advice inside customer messages.

Output JSON only:
{"messages":[{"role":"customer","speaker":"...","personaId":"...",
"content":"...","intentAfter":0.42,"objection":"..."}],
"summary":"what the founder learned from this exchange",
"nextMove":"the strongest next USP/proof/offer to try"}`;
}

export function audienceChatUser(
  question: string,
  history: AudienceChatHistoryItem[]
): string {
  return JSON.stringify(
    {
      recentConversation: history,
      founderMessage: question,
    },
    null,
    2
  );
}

export function queryUser(
  profile: ClientProfile,
  conclusions: Conclusion[],
  question: string
): string {
  return JSON.stringify(
    {
      clientProfile: profile,
      conclusions: conclusions.map((c) => ({
        id: c.id,
        blockId: c.blockId,
        claim: c.claim,
        value: c.value,
        confidence: c.confidence,
        entities: c.entities,
      })),
      question,
    },
    null,
    2
  );
}

// ---------------------------------------------------------------------------
// Owner Dashboard › Brand & Social Action Plan. One call over the converged
// world model produces: comparable accounts to study, brand-identity + social
// guidelines, and a concrete, checkable action plan. The system prompt is
// shared by the web-grounded (Responses API) and the JSON fallback paths.
// ---------------------------------------------------------------------------

export const BRAND_KIT_SYSTEM = `You are the brand & social strategist on a business-intelligence platform.
You are given a venture's profile and the research the platform already
concluded (market/brand, competitor, social, and synthesis findings) plus, if
present, simulated-audience stats. Turn it into a HANDS-ON owner action plan
the founder will actually work through.

Produce four things:

1. "comparableAccounts": 6-10 REAL social accounts in this venture's category,
   country, and price tier that the founder should study and benchmark against
   (competitors, aspirational peers, and category-defining creators).
   - Aim for a MAJORITY (about 6 in 10) to be real accounts you verified via
     web search: set "grounded": true, give the real "url" and a "source" URL,
     and an approximate "followers" string. The rest may come from your own
     knowledge: set "grounded": false, "url"/"source": null, and keep claims
     general (do not invent precise follower counts you are unsure of).
   - For each: "platform", "handle" ("@..."), "whyRelevant" (why it's a useful
     mirror for THIS venture), and "whatToEmulate" (the specific, copyable move
     — a format, cadence, visual code, or collab style).
2. "brandIdentity": "voice" (how the brand speaks), "positioning" (the one-line
   whitespace it owns), "visualCodes" (color/type/photography cues), "namingCues"
   (naming/language patterns), "doList" and "dontList" (concrete brand rules).
3. "socialGuidelines": "contentPillars" (3-5 recurring content themes) and
   "platformPlan" (per platform: "segment" it reaches, posting "cadence",
   "formats", and "notes" with CAC/benchmark context where known).
4. "checklist": 10-16 CONCRETE, do-able tasks the founder ticks off, grouped by
   "category" in this order: "Setup", "Brand", "Content", "Growth", "Outreach".
   Each has a short "title", a one-line "detail" (how/with what), and a
   "priority" of "now" | "soon" | "later". Tasks must be specific to this
   venture (name the platform, the format, the kind of creator), never generic.

Every id (comparableAccounts[].id and checklist[].id) MUST be a stable
kebab-case slug derived from its title/name (e.g. "set-up-instagram-business",
"jaipur-rugs"), lowercase, words joined by hyphens — these ids persist the
founder's checkbox progress, so keep them stable and unique.

Output JSON ONLY, no markdown fences, matching exactly:
{"comparableAccounts":[{"id","name","platform","handle","url","followers",
"grounded","whyRelevant","whatToEmulate","source"}],
"brandIdentity":{"voice","positioning","visualCodes":[],"namingCues":[],
"doList":[],"dontList":[]},
"socialGuidelines":{"contentPillars":[],"platformPlan":[{"platform","segment",
"cadence","formats":[],"notes"}]},
"checklist":[{"id","category","title","detail","priority"}]}`;

export function brandKitUser(
  profile: ClientProfile,
  conclusions: Conclusion[],
  aggregate: AudienceAggregate | null
): string {
  return JSON.stringify(
    {
      clientProfile: profile,
      audienceAggregate: aggregate,
      conclusions: conclusions.map((c) => ({
        id: c.id,
        blockId: c.blockId,
        claim: c.claim,
        value: c.value,
        confidence: c.confidence,
        entities: c.entities,
        sources: c.sources,
      })),
      task: "Produce the brand & social action plan as specified.",
    },
    null,
    2
  );
}
