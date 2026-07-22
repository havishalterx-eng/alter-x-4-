# Contributing Rules — ALTERX

Branch protection is not enforced by GitHub on this repo (free plan, private). These rules are therefore **team law** — breaking them breaks the build for everyone.

## The five rules

1. **Never push to `main` directly.** Not once, not for a "tiny fix." Every change goes: branch → PR → review → merge.
2. **Never merge your own PR without review.** CI must be green AND the folder owner (CODEOWNERS) must approve. A red ✗ on checks = do not merge, no exceptions.
3. **Branch per task, short-lived.** Name: `engine/<phase>-<task>`, `platform/<phase>-<task>`, `ui/<surface>`. Delete after merge. A branch older than 2 days is a problem — split the task.
4. **`packages/contracts` changes need repo-owner approval** in the PR before merge. Contracts are law; silent changes break every other builder.
5. **Pull `main` every morning** before starting work. Merge conflicts stay small only if integration happens daily.

## Per-phase completion ritual

1. Exit checks pass (run by the Codex Audit session, evidence pasted in PR)
2. PR → CI green → audit verdict APPROVE → owner review → squash-merge
3. Tag on `main`: `engine-<phase>-v1` / `platform-<phase>-v1` / `ui-<phase>-v1`
4. Announce in team channel what the push unlocks (UI work order = the OpenAPI diff)
5. New branch, next phase

## If someone breaks a rule

`main` broken by a direct push → whoever pushed reverts immediately (`git revert`), then does it properly via PR. No blame theater — revert first, talk after.
