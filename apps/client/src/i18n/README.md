# Translations

The interface is written in English and Dutch. English is the source: a string goes there first, and a missing key falls back to English rather than showing the key.

## Layout

One file per namespace per language: `locales/<language>/<namespace>.json`. A namespace is the folder a component lives in (`NAMESPACES` in `namespaces.ts`), with `shell` split into `settings`, `panels` and `usage`. A window loads every namespace of its language and English before the first render. The production build bundles each language lazily.

The chat, prompt cards, providers pane and usage page take their words from `@adecore/agents-react` (`agent-chat`, `agent-prompts`, `agent-providers`, `agent-usage`), and `@adecore/ui` components from `ui`. The same rules apply there, but those words change in their own repository.

`common` holds words several surfaces share (Cancel, Close, Delete, Try again). Add to it only when a word is really shared.

## In a component

```tsx
const { t } = useTranslation('settings');
// ...
<SettingsRow label={t('appearance.region.label')} description={t('appearance.region.description', { example })} />;
```

Keys are nested and named after the surface, not the sentence: `appearance.region.label`, not `theRegionOfTheApp`. Interpolation is `{{name}}`, with the same names in both languages. Counts use i18next's plural suffixes (`_one`, `_other`), never a hand-written ternary.

## Outside a component

A store, watcher or action calls `i18next.t('<namespace>:<key>')` inside a function. `initI18n()` runs before the first render, so that is safe. At the top level of a module the words are not loaded yet, so translate where the string is used.

## What stays English

Model and provider names, paths, git refs, agent output, the `refused` lines the daemon writes to agents, and anything else no person reads as a sentence. A daemon is a **machine** in both languages. Names stay names: **Ruimte**, **Voice**, **GPT-Live**, **Claude Code**, **Codex**. Voice is never `Stem`.

## Dutch

Address the reader as `je`, never `u`. Same voice as the English. No em dashes or en dashes in either language.

If a Dutch developer says a word in English out loud, it stays English. `Stage & Commit` stays `Stage & Commit`, never `Alles klaarzetten en commit`.

These stay English as verb and noun: commit, stage, unstage, push, pull, fetch, merge, rebase, stash, revert, checkout, branch, remote, diff, worktree, repository, canvas, node, chat, terminal, agent, sub-agent, prompt, token, turn, thread, fork, hook, build, deploy, log, input, output, sandbox, cache, editor. A verb takes a Dutch ending where the sentence needs one (gecommit, gemerged, gepusht). A label is the bare term (`Commit`, `Push`).

The everyday words around them are Dutch: view is weergave, panel is paneel, drawing is tekening, file is bestand, folder is map, settings are instellingen, usage is verbruik, session is sessie, save is opslaan, delete is verwijderen, close is sluiten, cancel is annuleren, search is zoeken, edit is bewerken, reload is opnieuw laden, overwrite is overschrijven, unsaved changes are niet-opgeslagen wijzigingen.

## Tests

`locales.test.ts` compares both languages key for key and placeholder for placeholder, so a missing Dutch string fails the run. `apps/client/test-preload.ts` (the `preload` in `bunfig.toml`) loads the English words before the first test, so a test asserts on the sentence, not the key. The app never imports it.
