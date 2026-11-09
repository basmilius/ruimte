# Site and documentation

`apps/site` is the website at `ruimte.app` (Next.js on Cloudflare through OpenNext, prerendered). `/download/<platform>` redirects to the latest release's build, so a release needs no deploy.

- Its scenes are drawn in React: when a feature changes what it looks like, its scene in `src/components/film` or `src/components/features` changes with it, and `src/components/app` copies the client's measures.
- The documentation lives here at `ruimte.app/docs`, as MDX: `/docs/guide` for people who use Ruimte, `/docs/extensions` for the extension API.
- The guide says what a person sees and does, in the UI's own words, never how Ruimte works inside.
- The extension reference comes from `packages/extension/*.d.ts` (`bun run --cwd apps/site reference`, held by a test), so a change to the API changes its page with it.
- Its figures are scenes drawn with `src/components/app`, and its UI comes from `@adecore/ui`.
- Every text goes through the `unslop` skill, and a code example puts each property of an object on its own line.
- The site has a typography of its own, outside the client's type sizes.
