import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS_DIR = join(process.cwd(), ".github", "workflows");
const CANONICAL_WORKFLOW = "production-release-watchdog.yml";

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
}

function workflowContent(name: string): string {
  return readFileSync(join(WORKFLOWS_DIR, name), "utf8");
}

function isProductionDeployer(content: string): boolean {
  // Detect an actual production deployment operation. Ordinary Vercel CLI
  // usage (env/link/logs) must not count as a deployment owner.
  const deployCommand = /\bvercel(?:@[^\s]+)?\s+(?:deploy|promote)\b/i.test(content);
  const apiDeployment = /POST[\s\S]{0,500}\/v\d+\/deployments(?:\?|\s|["'])/i.test(content);
  const productionTarget = /--prod\b|target\s*[:=]\s*["']?production\b/i.test(content);

  return (deployCommand || apiDeployment) && productionTarget;
}

describe("release architecture invariants", () => {
  it("has exactly one production deployment owner", () => {
    const deployers = workflowFiles().filter((name) => isProductionDeployer(workflowContent(name)));
    expect(deployers).toEqual([CANONICAL_WORKFLOW]);
  });

  it("keeps Vercel Git auto-deployment disabled", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.git?.deploymentEnabled).toBe(false);
  });

  it("does not define production cron schedules in Vercel config", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.crons ?? []).toEqual([]);
  });

  it("canonical release workflow is push/manual driven and verifies the exact production SHA", () => {
    const content = workflowContent(CANONICAL_WORKFLOW);

    expect(content).toContain("VERCEL_CLI_VERSION: 59.3.0");
    expect(content).toContain("actions/checkout@v5");
    expect(content).toContain("actions/setup-node@v7");
    expect(content).toContain("node-version: '24'");
    expect(content).toContain("npx --yes vercel@$VERCEL_CLI_VERSION deploy");
    expect(content).toContain("--prod --yes --token");
    expect(content).toContain("git rev-parse HEAD");
    expect(content).toContain("githubCommitSha=\"$RELEASE_SHA\"");
    expect(content).toContain("/v13/deployments/");
    expect(content).toContain("teamId=$VERCEL_ORG_ID");
    expect(content).toContain("release-health");
    expect(content).toContain("releaseCommit");
    expect(content).toContain("environment production");
    expect(content).toContain("--level error");

    // A push must deploy the exact commit that triggered the run. Manual
    // releases intentionally resolve the current main branch instead.
    expect(content).toContain("ref: ${{ github.event_name == 'workflow_dispatch' && 'main' || github.sha }}");

    // The release controller must not silently fall back to a scheduled
    // deployment path. Continuous monitoring belongs to a separate read-only
    // workflow, while this workflow owns actual production releases.
    expect(content).not.toContain("cron:");
    expect(content).toContain("on:\n  push:\n    branches: [main]");
    expect(content).toContain("workflow_dispatch:");
  });

  it("heartbeat remains a non-deploying health/contract monitor", () => {
    const heartbeat = workflowContent("venture-os-24x7-heartbeat.yml");
    expect(heartbeat).toContain("schedule:");
    expect(heartbeat).toContain("bun test tests/release-architecture.test.ts");
    expect(heartbeat).not.toMatch(/\bvercel(?:@[^\s]+)?\s+(?:deploy|promote)\b/i);
    expect(heartbeat).not.toContain("/v13/deployments/");
  });
});
