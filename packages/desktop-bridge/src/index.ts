/*
 * What crosses the IPC boundary between the Electron shell and the page it hosts. Not a wire in the
 * sense of `packages/contracts`, which is about a client and a daemon that are often different
 * releases and may sit on different machines; this never leaves the machine. It is one place because
 * the preload hands every answer to the page as `unknown`, so two copies of a shape drift without
 * the compiler ever saying so.
 */

export * from './service.ts';
export * from './update.ts';
export * from './versions.ts';
export * from './voice.ts';
export * from './speech.ts';
