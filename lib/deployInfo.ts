export type DeployInfo = {
  service: string;
  commitSha: string | null;
  commitRef: string | null;
  environment: string | null;
  deploymentId: string | null;
};

export function currentDeployInfo(service: string): DeployInfo {
  return {
    service,
    commitSha:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.RAILWAY_DEPLOYMENT_GIT_COMMIT_SHA ||
      process.env.SOURCE_VERSION ||
      process.env.GIT_COMMIT_SHA ||
      null,
    commitRef:
      process.env.VERCEL_GIT_COMMIT_REF ||
      process.env.RAILWAY_GIT_BRANCH ||
      process.env.RAILWAY_DEPLOYMENT_GIT_BRANCH ||
      null,
    environment:
      process.env.VERCEL_ENV ||
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.NODE_ENV ||
      null,
    deploymentId:
      process.env.VERCEL_DEPLOYMENT_ID ||
      process.env.RAILWAY_DEPLOYMENT_ID ||
      null,
  };
}

export function deployInfoLabel(info: DeployInfo): string {
  return [
    `service=${info.service}`,
    `commit=${info.commitSha?.slice(0, 12) || "unknown"}`,
    `ref=${info.commitRef || "unknown"}`,
    `env=${info.environment || "unknown"}`,
    `deployment=${info.deploymentId || "unknown"}`,
  ].join(" ");
}
