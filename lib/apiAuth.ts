import { NextResponse } from "next/server";
import {
  ensureProjectAccess,
  ensureRunAccess,
  ensureWorkspaceNodeAccess,
  getCurrentUser,
  type CurrentUser,
} from "./auth";

type ApiAuthOk = { user: CurrentUser; response?: never };
type ApiAuthFail = { user?: never; response: NextResponse };

export type ApiAuthResult = ApiAuthOk | ApiAuthFail;

export async function requireApiUser(): Promise<ApiAuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: NextResponse.json(
        { error: "authentication required" },
        { status: 401 },
      ),
    };
  }
  return { user };
}

export async function requireProjectForApi(
  projectId: string,
): Promise<ApiAuthResult> {
  const auth = await requireApiUser();
  if (auth.response) return auth;
  const project = await ensureProjectAccess(projectId, auth.user.id);
  if (!project) {
    return {
      response: NextResponse.json({ error: "not found" }, { status: 404 }),
    };
  }
  return auth;
}

export async function requireRunForApi(runId: string): Promise<ApiAuthResult> {
  const auth = await requireApiUser();
  if (auth.response) return auth;
  const run = await ensureRunAccess(runId, auth.user.id);
  if (!run) {
    return {
      response: NextResponse.json({ error: "not found" }, { status: 404 }),
    };
  }
  return auth;
}

export async function requireWorkspaceNodeForApi(
  nodeId: string,
): Promise<ApiAuthResult> {
  const auth = await requireApiUser();
  if (auth.response) return auth;
  const node = await ensureWorkspaceNodeAccess(nodeId, auth.user.id);
  if (!node) {
    return {
      response: NextResponse.json({ error: "not found" }, { status: 404 }),
    };
  }
  return auth;
}
