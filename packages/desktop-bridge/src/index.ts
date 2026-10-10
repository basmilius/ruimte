/*
 * The shapes crossing IPC between the Electron shell and its page. One place because the preload hands
 * every answer over as `unknown`, so two copies would drift without the compiler noticing.
 */

export * from './service.ts';
export * from './update.ts';
export * from './versions.ts';
export * from './voice.ts';
export * from './speech.ts';
export * from './microphone.ts';
export * from './menu.ts';
export * from './power.ts';
export * from './window.ts';
export * from './database.ts';
export * from './browser.ts';
