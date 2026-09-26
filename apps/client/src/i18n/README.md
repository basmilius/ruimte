# Translations

The interface is written in English and in Dutch. English is the source: a string is written there
first, and a language that misses a key falls back to it rather than showing the key itself.

## Layout

One file per namespace, per language: `locales/<language>/<namespace>.json`. A namespace is the
folder a component lives in (`NAMESPACES` in `namespaces.ts`), with `shell` split into `settings`,
`panels` and `usage` because it holds nearly half the interface on its own. Two people never write
in the same file, and a window only downloads the words of the screens it draws.

The chat, its prompt cards, the providers pane and the usage page carry their words in
`@ruimte/agents-react` (`agent-chat`, `agent-prompts`, `agent-providers`, `agent-usage`), and the
components of `@ruimte/ui` in `ui`; both are loaded beside these files. The same rules hold there.

`common` holds what several surfaces say the same way: Cancel, Close, Delete, Try again. Read from
it freely, add to it only when a word is genuinely shared, never to park a string that has a home.

## In a component

```tsx
const { t } = useTranslation('settings');
// ...
<SettingsRow label={t('appearance.region.label')} description={t('appearance.region.description', { example })} />
```

Keys are nested and named after the surface, not after the sentence: `appearance.region.label`, not
`theRegionOfTheApp`. A key survives a rewrite of the copy; a key made out of the copy does not.

Interpolation is `{{name}}`, and both languages carry the same names (a test checks this). Counts go
through i18next's plural suffixes (`_one`, `_other`), never through a hand-written ternary, because
the next language will not count the way these two do.

## Outside a component

A store, a watcher or an action that raises a toast calls `i18next.t('<namespace>:<key>')` directly.
That is safe inside a function, because `initI18n()` runs before the first render; it is not safe at
the top level of a module, where the words are not in yet. A string built at module level is a
constant, so give it a key and translate it where it is used.

## What stays English

Model and provider names, paths, git refs, agent output, the `refused` lines the daemon writes to
agents, and anything else no person reads as a sentence. A daemon is a **machine** in both languages.

The names of things in this app are names, not words: **Ruimte**, **Voice**, **GPT-Live**, **Claude
Code**, **Codex**. Voice is the panel you talk to, so it stays Voice in Dutch the way Finder stays
Finder; `Stem` is a translation of the word, not the name of the thing.

## Dutch

Address the reader as `je`, never `u`. Same voice as the English: active, one idea per sentence, no
words doing the work of a shrug.

The test for a word is simple: **if a Dutch developer says it in English out loud, it stays English.**
Reaching for a Dutch word where the trade has borrowed the English one does not read as Dutch, it
reads as a translation. `Stage & Commit` stays `Stage & Commit`; `Alles klaarzetten en commit` is
what this rule exists to prevent.

Stay English, as a verb as well as a noun: commit, stage, unstage, push, pull, fetch, merge, rebase,
stash, revert, checkout, branch, remote, diff, worktree, repository, canvas, node, chat, terminal,
agent, sub-agent, prompt, token, turn, thread, fork, hook, build, deploy, log, input, output,
sandbox, cache, editor. A verb takes a Dutch ending where the sentence asks for one (gecommit, gemerged,
gepusht), and a label is the bare term (`Commit`, `Stage & Commit`, `Push`).

Translate the everyday words around them: view is weergave, panel is paneel, drawing is tekening,
file is bestand, folder is map, settings are instellingen, usage is verbruik, session is sessie,
save is opslaan, delete is verwijderen, close is sluiten, cancel is annuleren, search is zoeken,
edit is bewerken, reload is opnieuw laden, overwrite is overschrijven, unsaved changes are
niet-opgeslagen wijzigingen.

No em dashes or en dashes, in either language.

## Tests

`locales.test.ts` compares the two languages key for key and placeholder for placeholder. A missing
Dutch string fails the run, which is the whole point: half a translation reads worse than none.

`test-preload.ts` puts the English words in memory before the first test, through the `preload` in
`bunfig.toml`. That is what makes a pure function that reads a word off i18next testable at all: a
test asserts on the sentence a person reads, not on the key. The app never imports it.
