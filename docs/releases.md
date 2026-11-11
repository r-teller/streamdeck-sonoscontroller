# Releases

Publishing a GitHub release runs `.github/workflows/releases.yml`, which builds, validates and
packages the plugin from the tagged commit and attaches
`com.r-teller.sonoscontroller.streamDeckPlugin` to the release.

## Version numbers

Stream Deck plugin versions have four numbers (`major.minor.patch.build`). The tag decides them:

| Release | Tag | Plugin version | GitHub flag |
|---|---|---|---|
| Pre-release (beta) | four numbers, e.g. `2.1.0.9` | the tag as is: `2.1.0.9` | Pre-release |
| Final release | three numbers, e.g. `2.1.0` | the tag plus the workflow run number: `2.1.0.14` | Latest |

Any other tag (`2.1.0-beta.1`, `v2.1`) fails the release build.

Stream Deck compares all four numbers, so every build must be higher than the one it replaces:

- Number betas with the next workflow run number or higher (see the last `Releases` run in
  GitHub Actions). Each release build raises the run number by one, so the final release, which
  uses its run number, always comes out above every beta before it.
- Never reuse or move a tag. Publish the next beta number instead.
- The plain `x.y.z` tag is kept for the final release.

## Steps

1. Bump `version` in `package.json` / `package-lock.json` (`npm version x.y.z --no-git-tag-version`)
   and `Version` in `public/manifest.json` to `x.y.z.0`; commit as `chore(release): x.y.z`.
2. Beta: publish from the feature branch with the pre-release flag:
   `gh release create x.y.z.n --target <full commit sha> --prerelease --title "x.y.z.n (pre-release): …" --notes-file …`
3. Final: merge the PR into `main`, then publish `x.y.z` from `main` (not a pre-release).
4. Check the `Releases` run passed, the plugin file is attached, and its stamped version (the
   `Version =` line in the run log) is what you expect.
