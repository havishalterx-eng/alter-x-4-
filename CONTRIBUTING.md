# Contributing Rules — ALTERX

`main` is protected on GitHub by the active `main-protection` ruleset, so direct pushes are blocked at the server. These rules cover what the ruleset cannot enforce on its own — breaking them breaks the build for everyone.

## The six rules

1. **Never push to `main` directly.** Not once, not for a "tiny fix." Every change goes: branch → PR → review → merge.
2. **Never merge your own PR without review.** CI must be green AND the folder owner (CODEOWNERS) must approve. A red ✗ on checks = do not merge, no exceptions.
3. **Branch per task.** Name: `engine/<phase>-<task>`, `platform/<phase>-<task>`, `ui/<surface>`. One branch per logical change, never one bundling unrelated fixes. Keep them short-lived — a long-running branch is a merge conflict accruing interest.
4. **Never delete a branch.** Not after merge, not ever. Always `--squash` merge, never `--delete-branch`, never `--no-verify`, never force-push. Merged branches remain the record of how a change was built.
5. **`packages/contracts` changes need repo-owner approval** in the PR before merge. Contracts are law; silent changes break every other builder.
6. **Pull `main` every morning** before starting work. Merge conflicts stay small only if integration happens daily.

## Per-phase completion ritual

1. Exit checks pass, with the evidence pasted into the PR
2. PR → CI green, verified directly with `gh pr checks <n>` and never from a relayed claim → owner review → squash-merge
3. Tag on `main`: `engine-<phase>-v1` / `platform-<phase>-v1` / `ui-<phase>-v1`
4. Announce in team channel what the push unlocks (UI work order = the OpenAPI diff)
5. New branch, next phase

## If someone breaks a rule

`main` broken by a direct push → whoever pushed reverts immediately (`git revert`), then does it properly via PR. No blame theater — revert first, talk after.
