import type { PrCheckIdentity, PullRequestCheck } from "./schemas.js";

export type CheckScope = "all" | "required";
export type CheckRead =
  | {
      readonly kind: "checks";
      readonly scope: CheckScope;
      readonly checks: readonly PullRequestCheck[];
    }
  | { readonly kind: "none-reported"; readonly scope: CheckScope };

export type RequiredCheckRead =
  | CheckRead
  | { readonly kind: "unavailable"; readonly message: string };

export interface ClassifiedCheck {
  readonly check: PullRequestCheck;
  readonly requirement: "required" | "advisory" | "unknown";
}

export interface CheckSnapshot {
  readonly repository: string;
  readonly number: number;
  readonly url: string;
  readonly headSha: string;
  readonly observedHeadSha: string;
  readonly checks: readonly ClassifiedCheck[];
  readonly requiredKnowledge: "reported" | "none-reported" | "unavailable";
  readonly limitations: readonly string[];
}

const checkIdentityKey = (check: PullRequestCheck): string =>
  JSON.stringify([check.name, check.workflow, check.event, check.link]);

const countCheckIdentities = (values: readonly PullRequestCheck[]) => {
  const result = new Map<string, number>();
  for (const value of values) {
    const id = checkIdentityKey(value);
    result.set(id, (result.get(id) ?? 0) + 1);
  }
  return result;
};

export interface CheckEvidence {
  readonly repository: string;
  readonly identity: PrCheckIdentity;
  readonly observed: PrCheckIdentity;
  readonly all: CheckRead;
  readonly required: RequiredCheckRead;
}

/** Classify non-atomic rollups conservatively, without performing any reads. */
export const classifyCheckSnapshot = ({
  repository,
  identity,
  observed,
  all,
  required,
}: CheckEvidence): CheckSnapshot => {
  const limitations = [
    "Only reported head-rollup checks are visible; unreported required jobs may be missing. Skipped checks are not passes. This is not branch-protection, ruleset, mergeability, or verified merge-gate evidence.",
  ];
  const requiredRead = required.kind === "unavailable" ? undefined : required;
  let requiredKnowledge: CheckSnapshot["requiredKnowledge"] = "unavailable";
  if (requiredRead) {
    requiredKnowledge =
      requiredRead.kind === "checks" ? "reported" : "none-reported";
  }
  if (required.kind === "unavailable") {
    limitations.push(
      `Required-check classification unavailable: ${required.message}`
    );
  } else if (requiredRead?.kind === "none-reported") {
    limitations.push(
      "No required subset reported: this does not prove an empty requirement set or a passing gate."
    );
  }
  if (all.kind === "none-reported") {
    limitations.push("No checks reported; this is not successful checks.");
  }
  const stable =
    identity.headRefOid === observed.headRefOid &&
    identity.number === observed.number &&
    identity.url === observed.url;
  if (!stable) {
    limitations.push(
      "Unstable snapshot: PR head or identity changed during collection; classification is unknown. Rerun /pr-checks rather than waiting for convergence."
    );
  }
  const checks = all.kind === "checks" ? all.checks : [];
  const requiredChecks =
    requiredRead?.kind === "checks" ? requiredRead.checks : [];
  const allCounts = countCheckIdentities(checks);
  const requiredCounts = countCheckIdentities(requiredChecks);
  // Duplicate keys cannot be joined reliably; retain their per-key ambiguity.
  // A required identity absent entirely from the earlier read proves that the
  // two rollups are inconsistent, even when the PR head has not changed.
  const missingRequiredKeys = [...requiredCounts.keys()].filter(
    (id) => !allCounts.has(id)
  );
  const consistent = missingRequiredKeys.length === 0;
  if (!consistent) {
    requiredKnowledge = "unavailable";
    limitations.push(
      `Unstable snapshot: non-atomic all/required reads disagree; requirement classification is unknown even if the head is unchanged. Reported required check identities absent from the all-check read (name, workflow, event, link; untrusted evidence): ${missingRequiredKeys.join(", ")}. Rerun /pr-checks rather than waiting for convergence.`
    );
  }
  const classificationAvailable =
    stable && consistent && required.kind === "checks";
  const hasAmbiguousIdentity = (check: PullRequestCheck): boolean => {
    const id = checkIdentityKey(check);
    return allCounts.get(id) !== 1 || (requiredCounts.get(id) ?? 0) > 1;
  };
  const classified = checks.map((check): ClassifiedCheck => {
    const id = checkIdentityKey(check);
    if (!classificationAvailable || hasAmbiguousIdentity(check)) {
      return { check, requirement: "unknown" };
    }
    return {
      check,
      requirement: requiredCounts.has(id) ? "required" : "advisory",
    };
  });
  if (checks.some(hasAmbiguousIdentity)) {
    limitations.push(
      "Ambiguous duplicate check keys are classified as unknown."
    );
  }
  return {
    checks: classified,
    headSha: identity.headRefOid,
    limitations,
    number: identity.number,
    observedHeadSha: observed.headRefOid,
    repository,
    requiredKnowledge,
    url: identity.url,
  };
};
