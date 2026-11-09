# Client

The rules of the React UI that hold across its folders. `README.md` is the map; the rules of one folder sit in a `CLAUDE.md` beside it (`src/browser`, `src/canvas`, `src/dictation`, `src/shell/panels`, `src/state`, `src/transport`).

## Conventions

- Shortcuts bind on `window`, once: the window's own in `shell/app-shortcuts.ts`, the project's in `canvas/canvas-shortcuts.ts`, a drawing view's tools in `drawing/use-drawing-keys.ts`. Never per cell or node.
- A new command is a row in `src/shell/command-table.ts`; only generated rows stay in `shell/menu/model.ts`.
- A new surface that draws data of its own gets an `ErrorBoundary` (`@adecore/ui`), keyed so it resets only while it holds an error.
- A zustand selector that builds a new array or object per call loops forever under `useShallow`: select the object and derive in render.
- The client and ADE CORE's React packages build with the React Compiler (`react-compiler.ts`), enforced by oxlint.
    - No `useMemo`, `useCallback` or `memo` the compiler covers. Keep one only where an effect depends on the value, for a row of a long list, or in a function the compiler leaves as written.
    - A value read in render from outside React goes through `useSyncExternalStore`.
    - A hook is called by its `use` name, never passed as a value.
    - A language or region change empties every compiled cache (`src/compiler-runtime.ts`).
- The start screen and the workspace are separate chunks: nothing `main.tsx` or the start screen imports statically may reach `shell/WorkspaceShell.tsx` or what only it draws. A panel, view or dialog not every workspace opens loads through `lazyNamed` or `lazyDialog` inside its `ErrorBoundary`. A chunk that fails to load reloads the page once (`src/stale-chunks.ts`), unless only a prefetch asked for it.
- UI uses only semantic tokens (`@adecore/ui/theme.css`, `@adecore/agents-react/theme.css`, `styles.css`), no raw colors.
    - A border is an alpha over what is behind it, and every surface clips its background to the padding box.
    - Tooltips are `Tooltip`, never `title`. Icon buttons are `IconButton`, related ones in a `ButtonGroup`.
    - Icons are Lucide through `Icon`, except `FileIcon`, `ProviderLogo` and `RuimteMark`.
    - No fractional pixels; a `rem` or `em` resolves to whole pixels.
- The interface is in English and Dutch (`src/i18n`, its README has the glossary). English is the source and fallback, and `locales.test.ts` fails when the two drift. Tests read English, so assert a label on the sentence, not the key.
- Every number, date, time and duration a person reads comes from `@adecore/ui/format`, the client's only `Intl` formatter builder (`src/format/source.ts`).
    - Language and region stay apart on purpose: the language writes the words, the region the order, separators and clock.
    - The region follows the language unless set, and `system` comes from the shell (`app.getSystemLocale()` beside `app.getPreferredSystemLanguages()`), since Chromium's locale is the bundle's language.
    - A surface that would sit still through a region change calls `useFormatLocale()`.
