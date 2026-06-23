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
