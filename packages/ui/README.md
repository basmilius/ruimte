# @ruimte/ui

The components Ruimte's client draws with that know nothing of Ruimte: buttons, menus, selects, dialogs, tooltips, keyboard shortcuts and an error boundary. React 19, Base UI, Lucide and Tailwind 4.

## Using it

Import per file, the way Base UI does:

```tsx
import { Button } from '@ruimte/ui/Button';
import { Tooltip } from '@ruimte/ui/Tooltip';
```

An app using it does three things:

- Import the theme right after Tailwind and let Tailwind scan the package:

  ```css
  @import "tailwindcss";
  @import "@ruimte/ui/theme.css";
  @source "<path to>/@ruimte/ui/src";
  ```

  The theme holds the semantic tokens (`bg-surface`, `text-positive-text`, ...), the type scale and the rules for icon buttons, fields, menus, dialogs and tooltips. It resets Tailwind's palette, so an app adds its own colors in an `@theme inline` block after it. Its light and dark tokens follow `data-theme` on `<html>`.
- Add the `ui` namespace to its i18next: `UI_LOCALES[language]()` from `@ruimte/ui/locales`, added under `UI_NAMESPACE`. English and Dutch ship with the package.

## Rules

Nothing in `src` imports from an app. The client's `conventions.test.ts` holds these files to the same design rules as its own: four type sizes, a `Tooltip` instead of `title`, icons on the 12, 14, 16 and 20 steps.
