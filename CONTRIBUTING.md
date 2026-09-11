# Contributing to Azure Argus

## Development

```bash
bun run lint
bun run typecheck
bun run test:unit
bun run test:e2e
bun run build
```

## Releases

Release Please maintains stable versions and `CHANGELOG.md` through a release pull request. Merge a
release pull request only after its checks pass. Merging it does not create a tag or GitHub Release;
the separate publication workflow validates the exact merged candidate before publishing release
artifacts.

Release preparation runs for changes to application source, dependencies, build configuration,
and files bundled into the container. Infrastructure, CI, documentation, and test-only changes do
not start release preparation. Release Please also excludes commits confined to `infrastructure/`,
`.github/`, `docs/`, or `tests/` when processing commit history. Merging a release PR still starts
publication through its release manifest change.

Published containers use `ghcr.io/visorian/azureargus:X.Y.Z` and `latest`. Release evidence records
the immutable image digest; deployments use the stable version tag selected by their committed
parameter file and never use `latest` as release identity.
