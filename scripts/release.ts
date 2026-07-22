import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_RELEASE_VERSION_LENGTH = 70;

type StableVersion = readonly [bigint, bigint, bigint];

export function parseStableVersion(value: string): StableVersion {
  if (value.length > MAX_RELEASE_VERSION_LENGTH) {
    throw new Error(`Version must be stable semver (X.Y.Z): ${value}`);
  }

  const match = STABLE_VERSION_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Version must be stable semver (X.Y.Z): ${value}`);
  }

  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

export function isGreaterStableVersion(candidate: string, current: string): boolean {
  const candidateParts = parseStableVersion(candidate);
  const currentParts = parseStableVersion(current);

  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] > currentParts[index]) {
      return true;
    }
    if (candidateParts[index] < currentParts[index]) {
      return false;
    }
  }

  return false;
}

export function parseReleaseArguments(args: readonly string[]): string {
  if (args.length !== 2 || args[1] !== "--push") {
    throw new Error("Usage: bun run release -- X.Y.Z --push");
  }

  parseStableVersion(args[0]);
  return args[0];
}

function command(commandName: string, args: readonly string[]): void {
  const result = spawnSync(commandName, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${commandName} ${args.join(" ")} failed`);
  }
}

function capture(commandName: string, args: readonly string[]): string {
  const result = spawnSync(commandName, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${commandName} ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function readPackageVersion(): string {
  const metadata: unknown = JSON.parse(readFileSync("package.json", "utf8"));
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("version" in metadata) ||
    typeof metadata.version !== "string"
  ) {
    throw new Error("package.json must contain a string version");
  }
  return metadata.version;
}

function ensureTagDoesNotExist(tag: string): void {
  const local = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`]);
  if (local.status === 0) {
    throw new Error(`Local tag already exists: ${tag}`);
  }
  if (local.status !== 1) {
    throw new Error(`Unable to inspect local tag: ${tag}`);
  }

  const remote = spawnSync("git", [
    "ls-remote",
    "--exit-code",
    "--tags",
    "upstream",
    `refs/tags/${tag}`,
  ]);
  if (remote.status === 0) {
    throw new Error(`Remote tag already exists: ${tag}`);
  }
  if (remote.status !== 2) {
    throw new Error(`Unable to inspect remote tag: ${tag}`);
  }
}

function changedPaths(): string[] {
  const tracked = capture("git", ["diff", "--name-only"]);
  const untracked = capture("git", ["ls-files", "--others", "--exclude-standard"]);
  return [
    ...new Set([...tracked.split("\n"), ...untracked.split("\n")].filter(Boolean)),
  ].toSorted();
}

function ensureExpectedReleaseChanges(): void {
  const actual = changedPaths();
  const expected = ["CHANGELOG.md", "package.json"];
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    throw new Error(`Unexpected release changes: ${actual.join(", ") || "none"}`);
  }
}

function release(version: string): void {
  if (capture("git", ["status", "--porcelain"]) !== "") {
    throw new Error("Working tree must be clean");
  }
  if (capture("git", ["branch", "--show-current"]) !== "main") {
    throw new Error("Release must run from main");
  }

  command("git", ["fetch", "upstream", "main"]);
  if (
    capture("git", ["rev-parse", "HEAD"]) !==
    capture("git", ["rev-parse", "refs/remotes/upstream/main"])
  ) {
    throw new Error("Local main must exactly match upstream/main");
  }

  const currentVersion = readPackageVersion();
  if (!isGreaterStableVersion(version, currentVersion)) {
    throw new Error(`Version must be greater than ${currentVersion}: ${version}`);
  }

  const tag = `v${version}`;
  ensureTagDoesNotExist(tag);

  command("bunx", [
    "--no-install",
    "changelogen",
    "--release",
    "-r",
    version,
    "--no-commit",
    "--no-tag",
    "--no-github",
    "--noAuthors",
  ]);

  if (readPackageVersion() !== version) {
    throw new Error(`changelogen did not set package version to ${version}`);
  }
  ensureExpectedReleaseChanges();

  command("git", ["add", "CHANGELOG.md", "package.json"]);
  command("git", ["commit", "-S", "-m", `chore(release): ${tag}`]);
  command("git", ["tag", "-a", tag, "-m", tag]);
  command("git", ["push", "--atomic", "upstream", "HEAD:refs/heads/main", `refs/tags/${tag}`]);
}

function main(): void {
  try {
    release(parseReleaseArguments(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Release failed: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main();
}
