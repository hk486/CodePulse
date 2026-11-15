import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { InfraAnalyzer } from "../src/analyzers/infra";
import { detectLanguages } from "../src/services/languageDetector";
import { validateEvidence } from "../src/services/findingPipeline";
import type { Finding } from "@codepulse/shared";

async function analyzeCompose(
  content: string,
  inspect?: (findings: Finding[], projectPath: string) => void
) {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "codepulse-compose-"));
  const composePath = path.join(projectPath, "docker-compose.yml");
  await writeFile(composePath, content, "utf-8");

  try {
    const findings = await new InfraAnalyzer().analyze(
      {
        projectPath,
        projectName: "compose-test",
        detectedLanguages: ["docker-compose"],
        files: [
          {
            path: "docker-compose.yml",
            absolutePath: composePath,
            extension: "yml",
            size: Buffer.byteLength(content),
          },
        ],
      },
      {}
    );
    inspect?.(findings, projectPath);
    return findings;
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
}

describe("Docker Compose analysis", () => {
  it("reports Compose files as a distinct covered language", () => {
    const detection = detectLanguages("/project", [
      {
        path: "deploy/compose.production.yaml",
        absolutePath: "/project/deploy/compose.production.yaml",
        extension: "yaml",
        size: 20,
      },
    ]);

    expect(detection.languages).toContain("docker-compose");
  });

  it("reports unpinned images and high-risk service settings with source lines", async () => {
    const findings = await analyzeCompose(
      [
        "services:",
        "  api:",
        "    image: registry.example.com:5000/api:latest",
        "    privileged: true",
        "    network_mode: host",
        "    user: 0",
        "    volumes:",
        "      - /var/run/docker.sock:/var/run/docker.sock",
        "  database:",
        "    image: postgres",
      ].join("\n")
    );

    const byRule = new Map(findings.map(finding => [finding.ruleId, finding]));
    expect([...byRule.keys()].sort()).toEqual([
      "INFRA-050",
      "INFRA-051",
      "INFRA-052",
      "INFRA-053",
      "INFRA-055",
    ]);
    expect(byRule.get("INFRA-050")?.location?.startLine).toBe(10);
    expect(byRule.get("INFRA-051")?.location?.startLine).toBe(4);
    expect(byRule.get("INFRA-052")?.location?.startLine).toBe(5);
    expect(byRule.get("INFRA-053")?.location?.startLine).toBe(6);
    expect(byRule.get("INFRA-055")?.location?.startLine).toBe(7);
  });

  it("does not mistake registry ports and version tags for floating images", async () => {
    const findings = await analyzeCompose(
      [
        "services:",
        "  api:",
        "    image: registry.example.com:5000/api:v2",
        "  worker:",
        "    image: example/worker@sha256:abcdef",
      ].join("\n")
    );

    expect(findings.filter(finding => finding.ruleId === "INFRA-050")).toHaveLength(0);
  });

  it("reports malformed Compose YAML instead of silently skipping it", async () => {
    const content = [
      "services:",
      "  api:",
      "    environment: [TOKEN=short-secret",
    ].join("\n");
    const findings = await analyzeCompose(content);

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "INFRA-054",
          location: expect.objectContaining({ startLine: 3 }),
          snippet: expect.not.stringContaining("short-secret"),
        }),
      ])
    );
    await analyzeCompose(content, (parsedFindings, projectPath) => {
      const evidence = validateEvidence(parsedFindings, projectPath);
      expect(evidence.verified).toBe(1);
      expect(evidence.findings[0].snippet).not.toContain("short-secret");
    });
  });
});
