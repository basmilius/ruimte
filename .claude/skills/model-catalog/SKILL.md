---
name: model-catalog
description: Add, rename, retire or remove a model in the model pickers of Claude, Codex, Grok, Copilot or Antigravity. Use when a lab ships a new model, when a model should move to legacy or leave the picker, when asked to "add model X", "mark X as legacy", "remove X", or to bring the catalogs, the bundled manifests and the model comparison in line. Covers the catalogs in the address book's D1, the manifests in ADE CORE, the benchmark table of the comparison, and deciding by itself which older models become legacy.
---

# Model catalog

Every machine's picker reads models from the address book's D1, without a release or deploy. A change touches each of these places that applies:

| Where | What it is | How it changes |
| --- | --- | --- |
| D1 `ruimte-pulsar`, tables `model_catalogs`, `model_catalog_profiles`, `model_catalog_models` | The source of truth for `/v1` and `/v2/models/catalog` | SQL with wrangler, no deploy |
| `../adecore/packages/agents/src/providers/<kind>-models.json` | What a release starts with, and the Worker's fallback | A commit in ADE CORE, released when Bas asks |
| D1 table `model_catalog_benchmarks` | The model comparison: which Artificial Analysis model stands for each effort | SQL with wrangler, no deploy |

Read "Model catalogs" and "Model benchmarks" in `apps/pulsar-worker/README.md` once before the first edit. Kinds: `claude` and `codex` (v1 and v2), `grok`, `copilot` and `antigravity` (v2 only).

## Steps

1. **Read what is there.** Run every wrangler command from `apps/pulsar-worker` with `CLOUDFLARE_API_TOKEN=$(cat ~/.private/cloudflare-api-token)`:

   ```sh
   bunx wrangler d1 execute ruimte-pulsar --remote --json --command "SELECT slug, position, name, profile, badge, legacy, min_cli_version FROM model_catalog_models WHERE kind = 'claude' ORDER BY position"
   bunx wrangler d1 execute ruimte-pulsar --remote --json --command "SELECT name, options, context_window_tokens FROM model_catalog_profiles WHERE kind = 'claude'"
   ```

   A kind without a row in `model_catalogs` is not in D1 yet. Seed it from its manifest with `bun scripts/seed-model-catalog.ts <kind>` (from the repository root), then edit it in D1.

2. **Find the facts, never guess.** From the lab's announcement or the CLI, get the exact slug the CLI takes, the name, the context window, the efforts, and the oldest CLI version that knows it (`min_cli_version`, only when known). A slug matches `^[a-z0-9][a-z0-9._-]*$`. Reuse a profile whose options and context windows match exactly; add one only for a new combination. Report what you could not confirm instead of filling it in.

3. **Decide what becomes legacy** (see below). Also decide whether `default_model` should move, and say why.

4. **Write D1** in one command per kind. Make room with `position` first, then insert:

   ```sql
   UPDATE model_catalog_models SET position = position + 1 WHERE kind = 'claude' AND position >= 2;
   INSERT INTO model_catalog_models (kind, slug, position, name, profile, badge, legacy) VALUES ('claude', 'claude-opus-6', 2, 'Claude Opus 6', 'opus', 'New', 0);
   UPDATE model_catalog_models SET legacy = 1 WHERE kind = 'claude' AND slug = 'claude-opus-5-5';
   ```

   Removing is `DELETE FROM model_catalog_models WHERE kind = ... AND slug = ...`, and chats on it fall back to the default. Remove only on request or when the CLI no longer accepts the model; legacy is the usual end. Never delete the default model or a profile a model still names. Triggers date the kind.

5. **Check that machines take it.** A catalog that fails its route's frozen schema is silently answered from the bundled manifest. The D1 date and the route's date must match:

   ```sh
   bunx wrangler d1 execute ruimte-pulsar --remote --json --command "SELECT updated_at FROM model_catalogs WHERE kind = 'claude'"
   curl -s "https://pulsar.ruimte.app/v2/models/catalog?fresh=$RANDOM" | jq '.catalogs.claude | {updatedAt, models: [.models[] | [.slug, .legacy]]}'
   ```

   For `claude` and `codex`, check `/v1/models/catalog` the same way, since released daemons read it. Machines ask again after fifteen minutes (six hours on `/v1`).

6. **Mirror into ADE CORE.** Bring `<kind>-models.json` in line with D1, with `updatedAt` set to the D1 `updated_at`. In `../adecore` on main, `git pull --ff-only` first, run `bun --conditions=source test packages/agents/src/providers`, commit as `feat(agents): ...` and push. Do not release ADE CORE unless Bas asks.

7. **Update the model comparison.** Every `claude` and `codex` model in the picker has rows in `model_catalog_benchmarks`, and so does a Grok or Gemini model (kinds `grok` and `antigravity`) Bas wants compared. Copilot is never compared. Add one row per effort option, `position` cheapest first. Name and legacy come from the catalog row, and a deleted model takes its rows along. `source_id` and `source_name` are Artificial Analysis's id and name for that effort. Find them in the last refresh (no key needed):

   ```sh
   bunx wrangler d1 execute ruimte-pulsar --remote --json --command "SELECT source_id, name FROM benchmark_measurements WHERE name LIKE '%Opus 6%' ORDER BY name"
   ```

   Take an id only when the name clearly names that model and effort. An unmeasured model gets rows with both columns null (as GPT-6.1 Terra) and an `UPDATE` once it shows up. Check `GET https://pulsar.ruimte.app/v1/models/benchmarks`: the model is in `models`, with a point per measured effort.

8. **Report** what changed per place, each legacy or default decision with its reason, and what you could not confirm.

## Legacy

Decide it yourself, as someone who follows the labs would. A model becomes legacy when a newer model of the same lab and tier replaces it in the picker.

- Same line, newer version: Claude Opus 5.5 made Claude Opus 5 legacy, Haiku 5.5 made Haiku 4.5 legacy. A new name in a line (GPT-6 Astra beside GPT-6.1 Terra) is a successor only when the lab says it replaces the older one.
- A different tier is no successor. A new Haiku leaves Sonnet and Opus alone, and a fast or mini variant leaves the full model alone.
- The newest model of its tier stays current, however old.
- At most one current model per tier and line.
- For an ACP kind the agent's own list decides what a person can pick. Legacy there only changes how the picker shows it.

Never mark the default legacy. When the default is superseded, move `default_model` to its successor in the same command, unless the successor is a preview or costs a different tier; then keep the default and say so. A legacy model keeps its catalog and benchmark rows.

## Rules

- No secrets in a commit or report. The token stays in `~/.private`.
- A schema change (a new option type or field) never goes through SQL. It needs a new route with its own frozen schema (`apps/pulsar-worker/src/catalog-schemas.ts`), which is code and a plan.
- Commits are English, conventional, without co-author lines.
