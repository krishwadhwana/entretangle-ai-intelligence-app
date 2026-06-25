// Distilled from data/ohneis resource/Ohneis AI Visual System:
// Instagram growth, hook/script workflows, product photography, visual prompt
// architecture, AI video workflows, tool notes, and the bundled PDF prompt packs.

export const OHNEIS_RESOURCE_SOURCES = [
  "03-Instagram Growth GPT - The Ohneis Method.docx",
  "01-Footage That Doesnt Look Like Stock.docx",
  "08-Consistent AI Product Photos Brands.docx",
  "04-NanobananaChatGPT Prompt GPT - Creates Prompts for you.docx",
  "07-Cinematic Ad Spots.docx",
  "07-AI Fashion Workflow From Sketch to Visual Drop.docx",
  "05-Structured JSON Prompting.docx",
  "06-Mastering Custom GPTs.docx",
  "NanoBanana, Midjourney, and Higgsfield tool guides",
  "PromptBundle.zip PDF packs for product, fashion, food, UI, motion, 3D, and editorial prompts",
] as const;

export const OHNEIS_BRAND_SOCIAL_METHOD = [
  "Use the Ohneis social method as an operating system, adapted to the venture:",
  "- Treat the profile and every post as conversion architecture: discovery -> interest -> intent -> purchase, not decoration.",
  "- Build around a precise avatar: psychographics, pain language, failed attempts, secret desires, and the exact phrases customers use in comments/DMs.",
  "- Pick 3-5 content pillars from the overlap of brand expertise, audience desperation, and revenue relevance.",
  "- Match format to job: carousels for education/saves, reels for reach and quick proof, single posts for simple stories/questions/announcements.",
  "- Require hook systems: mistake, curiosity, controversy, list, story, contradiction, secret, and question hooks. Hooks should be short, specific, and scroll-stopping.",
  "- For short-form video, structure the idea as hook, problem/agitation, solution tease, proof/example, then one clear CTA.",
  "- Use CTA hierarchy: low-friction engagement, save/share, conversation starter, keyword lead magnet, then direct sales only after trust/proof.",
  "- Keyword lead magnets must solve one urgent problem with a tangible resource and a one- or two-word comment trigger.",
  "- Add systems work to the checklist: hook library, reusable templates, content bank, batching rhythm, DM/lead follow-up, and weekly analytics review.",
  "- Measure saves, shares, comments, profile visits, follow rate, DM starts, and lead magnet downloads. Test one variable at a time.",
].join("\n");

export const OHNEIS_COLLATERAL_COPY_METHOD = [
  "Apply the Ohneis post-generation method to flyer/poster copy:",
  "- Lead with one sharp hook, not a broad brand slogan. Prefer a specific mistake, desire, contradiction, result, or customer objection.",
  "- Make the subhead carry the product promise and audience context in plain language.",
  "- Body lines should be scannable proof points: tactile benefits, objection answers, use cases, outcomes, or offer details.",
  "- Choose one CTA that matches intent: save/share for education, comment/DM keyword for lead capture, or shop/apply only for purchase-ready ads.",
  "- Keep the copy modular enough to become a carousel cover, reel opening frame, or static feed ad.",
  "- Avoid generic premium language unless the copy names the material, mechanism, customer problem, proof, or outcome.",
].join("\n");

export const OHNEIS_WEBSITE_METHOD = [
  "Apply the Ohneis conversion/content method to the generated website:",
  "- Treat the page as a conversion path: instant category clarity, specific product promise, proof/context, then one obvious CTA.",
  "- Use a sharp hero hook that names the customer desire, objection, or transformation; keep supporting copy concrete and evidence-led.",
  "- Build sections from reusable post logic: hook, problem/agitation, mechanism, proof/example, offer, CTA.",
  "- Use visual rhythm that could translate into social content: hero frame, product detail tiles, benefit cards, proof band, and capture CTA.",
  "- Avoid generic premium language unless the page names product facts, material/ingredient/mechanism cues, price/offer evidence, or customer use cases.",
  "- If website evidence is provided, make the site feel like a polished evolution of the source brand rather than a generic landing-page template.",
].join("\n");

export const OHNEIS_AD_VISUAL_METHOD = [
  "Use the Ohneis visual production method for the generated ad image:",
  "- Think scene-first: establish lighting, camera, mood, composition, and negative space before product styling.",
  "- Use technical visual language over vague adjectives: subject/action, aspect ratio, composition, lens, camera height, lighting direction, color temperature, setting, finish, texture, and tone.",
  "- Preserve material fidelity. Glass needs reflection/refraction, metal needs specular highlights, fabric needs weave/fold behavior, and matte/gloss surfaces must read correctly.",
  "- Choose lens logic intentionally: 35mm for contextual lifestyle, 50mm for natural product/lifestyle balance, 85mm+ for premium accuracy and compressed geometry.",
  "- Lock campaign consistency across camera/lens, lighting setup, palette, grade, and finish; vary pose, props, framing, and scene details.",
  "- Add believable micro-imperfections where natural, such as grain, dust, fabric creases, or subtle surface marks, while keeping product form and brand-critical areas clean.",
  "- Leave clean copy space for overlaid text. The visual should feel like one frame from a coherent branded shoot.",
].join("\n");

export const OHNEIS_MIDJOURNEY_PROMPT_METHOD = [
  "Ohneis Midjourney scene method:",
  "- Treat Midjourney as the art-direction generator, not the product-fidelity renderer.",
  "- Build each prompt as a photographic brief: subject/action, exact composition, camera/lens, camera height, lighting direction, environment, tactile materials, finish, mood, and negative space.",
  "- Use Raw mode and restrained stylization for commercial realism; avoid generic premium adjectives unless anchored to a visible photographic choice.",
  "- Generate multiple campaign posts as separate concepts. Keep camera/lens/grade coherent, but change the scene job, pose, frame distance, prop logic, and visual rhythm per post.",
  "- Do not ask Midjourney to copy a real label or logo. Use a plausible unbranded placeholder product only; exact product, logo, label, and packaging fidelity are handled in the product-swap step.",
  "- Do not design the ad in Midjourney. No posters, cards, UI, split panels, sliders, headlines, captions, CTA bars, or readable text inside the scene.",
].join("\n");

export const OHNEIS_PRODUCT_SWAP_METHOD = [
  "Ohneis NanoBanana/Gemini product-swap method:",
  "- Preserve the scene first: keep the Midjourney image's pose, hands, lighting direction, shadows, background, camera angle, and negative space.",
  "- Replace only the placeholder product or packaging with the real product references. Do not redesign the whole image.",
  "- Prioritize actual uploaded product photos over scraped overview images; use overview images only for secondary context.",
  "- Match geometry, scale, perspective, occlusion, shadows, reflections, material finish, cap/closure, color, and surface wear.",
  "- Preserve brand-critical marks, symbols, logos, label shapes, color blocking, and packaging proportions when they are visible in the reference.",
  "- Do not invent copy, extra labels, fake logos, watermarks, UI, poster layouts, or graphic text overlays.",
].join("\n");

export const OHNEIS_OPENAI_IMAGE_FALLBACK_METHOD = [
  "Ohneis OpenAI image fallback method:",
  "- Treat Image 1 as the scene plate and Images 2+ as product references.",
  "- Be explicit about which image supplies composition and which images supply product identity.",
  "- Use high-fidelity editing behavior when available; keep the edit surgical instead of regenerating the whole composition.",
  "- If the edit must simplify, preserve the actual product shape, color, logo/mark placement, and scale before preserving optional props.",
].join("\n");
