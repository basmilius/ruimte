# @ruimte/ui

The components Ruimte's client draws with that know nothing of Ruimte: buttons, menus, selects, dialogs, tooltips, keyboard shortcuts and an error boundary. React 19, Base UI, Lucide and Tailwind 4.

## Using it

Import per file, the way Base UI does:

```tsx
import { Button } from '@ruimte/ui/Button';
import { Tooltip } from '@ruimte/ui/Tooltip';
```

An app using it does three things:

- Let Tailwind scan the package: `@source "<path to>/@ruimte/ui/src";` in its stylesheet.
- Define the semantic tokens the classes name (`bg-surface`, `text-positive-text`, ...). They still live in Ruimte's `apps/client/src/styles.css`.
- Add the `ui` namespace to its i18next: `UI_LOCALES[language]()` from `@ruimte/ui/locales`, added under `UI_NAMESPACE`. English and Dutch ship with the package.

## Rules

Nothing in `src` imports from an app. The client's `conventions.test.ts` holds these files to the same design rules as its own: four type sizes, a `Tooltip` instead of `title`, icons on the 12, 14, 16 and 20 steps.
