// Optional one-click publish of a generated static site to Vercel. Gated on a
// VERCEL_TOKEN (and optional VERCEL_TEAM_ID) so the feature lights up only when
// the founder has connected a Vercel account; without it, the UI still offers
// preview + ZIP download. We deploy plain static files with no build step.

export function vercelDeployEnabled(): boolean {
  return Boolean(process.env.VERCEL_TOKEN);
}

// Vercel project names: lowercase, alphanumeric + hyphens, <= 100 chars.
function safeProjectName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "venture-site";
}

export type VercelDeployResult = { url: string };
export type StaticDeployFile = { path: string; content: string };

/**
 * Create a static deployment. Returns the public URL (https://…). Throws with a
 * readable message on misconfig/API failure.
 */
export async function deployStaticSite(
  projectName: string,
  site: string | StaticDeployFile[]
): Promise<VercelDeployResult> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new Error(
      "Vercel deploy is not configured. Set VERCEL_TOKEN to enable one-click publish."
    );
  }
  const teamId = process.env.VERCEL_TEAM_ID;
  const name = safeProjectName(projectName);
  const endpoint = new URL("https://api.vercel.com/v13/deployments");
  if (teamId) endpoint.searchParams.set("teamId", teamId);
  const files = Array.isArray(site)
    ? site.map((file) => ({
        file: file.path.replace(/^\/+/, "") || "index.html",
        data: file.content,
      }))
    : [{ file: "index.html", data: site }];

  const res = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      target: "production",
      // Inline file content — no build step for static documents.
      files,
      projectSettings: { framework: null },
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      data?.error?.message || `Vercel deploy failed (${res.status})`
    );
  }
  if (!data.url) throw new Error("Vercel deploy returned no URL");
  return { url: `https://${data.url}` };
}
