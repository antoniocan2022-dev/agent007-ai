import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS_DIR = join(process.cwd(), ".github", "workflows");
const CANONICAL_WORKFLOW = "first-authorized-production-deploy.yml";

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
}

function workflowContent(name: string): string {
  return readFileSync(join(WORKFLOWS_DIR, name), "utf8");
}

function isProductionDeployer(content: string): boolean {
  // Detect actual Vercel deployment operations, not ordinary CLI usage such as
  // `vercel env run` or `vercel link` used by DB/admin workflows.
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

  it("canonical release workflow pins a Vercel CLI version and verifies the triggering SHA", () => {
    const content = workflowContent(CANONICAL_WORKFLOW);
    expect(content).toContain("VERCEL_CLI_VERSION: 59.1.3");
    expect(content).toContain("git rev-parse HEAD");
    expect(content).toContain("$GITHUB_SHA");
    expect(content).toContain("bun install --frozen-lockfile");
    expect(content).toContain("tests/owner-bootstrap-security.test.ts");
    expect(content).toContain("tests/db-runtime-policy.test.ts");
    expect(content).toContain("release-health");
  });
});
