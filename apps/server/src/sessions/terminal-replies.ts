/*
 * What a terminal emulator writes back on its own: answers to device attributes (DA), cursor position
 * (CPR), status and mode reports, window reports, OSC color queries and DCS requests, and focus reports.
 * Every attached client answers them, so they say nothing about which person is at the keyboard.
 * Shift+F3 is written like a cursor position report and is taken for one.
 */
// oxlint-disable-next-line no-control-regex
const REPLIES = /^(?:\x1b\[[?>=]?[\d;]*\$?[cRnyt]|\x1b\[[IO]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\)+$/;

export const isTerminalReply = (data: string): boolean => REPLIES.test(data);
