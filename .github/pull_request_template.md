## Summary

<!-- What changed and why. Beads issue IDs: sonos-xxx -->

## Checks

- [ ] CI is green (format, lint, unit, build, validate, Playwright)

### New or changed actions (keys and dials), see `docs/adding-actions.md`

- [ ] Acceptance criteria for each interaction are in the beads issue
- [ ] Unit tests for each registered handler
- [ ] Playwright: appear, turn (+1 / -1 / burst / limits), push, tap, speaker error, PI settings
- [ ] Each new test fails with the feature removed
- [ ] Screenshot baselines reviewed; noise-only screenshot changes restored
- [ ] Tried on a real Stream Deck +
