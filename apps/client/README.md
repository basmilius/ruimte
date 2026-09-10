# @ruimte/client

The React UI. It never touches a Node or Bun API and reaches the daemon only through the `Transport` interface.

## Icons

Icons are Font Awesome Pro regular, drawn by the `Icon` component in `src/ui/Icon.tsx`. Brand marks come from the free brand set (`src/agents/AgentIcon.tsx`).

Pro packages come from Font Awesome's own registry, which the root `.npmrc` points the `@fortawesome` scope at. That file reads the token from `FONTAWESOME_NPM_AUTH_TOKEN`, so `bun install` needs that variable in the environment or it fails on the `@fortawesome` packages.

CI needs the same variable. `.github/workflows/ci.yml` and `release.yml` both run `bun install --frozen-lockfile`, so `FONTAWESOME_NPM_AUTH_TOKEN` has to reach those jobs as a secret.
