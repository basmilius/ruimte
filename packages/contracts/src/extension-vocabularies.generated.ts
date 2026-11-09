// Generated from packages/extension/client.d.ts by packages/contracts/scripts/generate-extension-vocabularies.ts. Do not edit.

/* Why a call of an extension came back without its answer, the `ExtensionErrorCode` of `@ruimte/extension`. */
export const EXTENSION_ERROR_CODES = [
    'permission-denied',
    'no-project',
    'no-canvas',
    'not-found',
    'outside-project',
    'refused',
    'limit',
    'timeout',
    'unavailable',
    'failed'
] as const;

/* Every place an extension may put an action, a menu or a widget: the `SlotName` of `@ruimte/extension/client`. */
export const EXTENSION_SLOT_NAMES = [
    'selectionBar',
    'nodeHeader',
    'nodeMenu',
    'canvasMenu',
    'lineMenu',
    'viewToolbar',
    'viewMenu',
    'panelHeader',
    'commandPalette',
    'projectMenu',
    'sidebarFooter',
    'editorStatusBar',
    'sidebarRow',
    'tabMenu',
    'emptyCanvas',
    'startScreen',
    'projectBanner',
    'threadHeader',
    'emptyThread',
    'toolActions',
    'fileRowBadge',
    'fileBreadcrumb',
    'terminalMenu',
    'browserMenu',
    'textMenu',
    'noteToolbar',
    'routineMenu',
    'composer',
    'messageActions',
    'fileMenu',
    'editorToolbar',
    'editorMenu',
    'diffToolbar',
    'terminalToolbar',
    'browserToolbar'
] as const;
