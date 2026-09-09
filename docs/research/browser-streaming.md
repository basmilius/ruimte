<!-- Research note, written 2026-09-09 by a research agent on request. Not a decision; see docs/HANDOFF.md for what is planned. -->

# Live browserpagina in een browser-node zonder `<webview>`

## Samenvatting

Aanbeveling: laat de daemon een headless Chromium beheren en stream de pagina als JPEG-frames via CDP `Page.startScreencast` over de bestaande WebSocket, met input terug via `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText`. Dit is wat Browserbase, Hyperbrowser en Vercel's agent-browser doen. Het past in de bestaande architectuur (één socket, zod-frames, sessies gekeyed op node-id), vraagt geen native dependencies en werkt op Bun 1.4 zonder Puppeteer of Playwright. WebRTC is pas de moeite als 30+ fps video op afstand een eis wordt. Proxy-iframes en DOM-mirroring vallen af voor een interactieve pane.

Een bijkomend argument dat losstaat van web-mode: de browser draait dan op de machine waar de terminals draaien. Een `localhost:3000` van een remote daemon is in de Electron-webview vandaag onbereikbaar, in de stream-variant wel.

## Vergelijking

| Aanpak | Latency (lokaal / remote) | Fidelity | Interactiviteit | Bandbreedte | Effort | Remote-veiligheid |
|---|---|---|---|---|---|---|
| A. CDP JPEG-screencast over WS | ~50-100 ms / +RTT | Goed, JPEG-artefacten bij tekst op q<80 | Volledig (muis, toetsen, wheel, paste, IME) | 0 bij stilstand; 1x DPR 720p ca. 50-100 KB/frame, 2x DPR ca. 4x | 5-8 dagen | Goed, alles via de daemon-socket |
| B. WebRTC video (VP8/VP9/H264) | ~30-60 ms / minder gevoelig voor jitter | Wisselend, tekst wordt zacht bij lage bitrate | Volledig (input via WS of datachannel) | Constante bitrate 1-4 Mbit/s, ook bij stilstand keyframes | 15+ dagen | UDP/ICE/TURN erbij, extra aanvalsvlak |
| C. Reverse proxy in `<iframe>` | 0 (native rendering) | Perfect waar het werkt | Native | Alleen HTML/assets | 3-5 dagen, daarna eindeloos | Slecht, proxy strippt security-headers |
| D. Xvfb + VNC (noVNC) of neko | ~80-150 ms / +RTT | Goed | Volledig, ook OS-dialogen | Vergelijkbaar met A (VNC-encoders) | 5-10 dagen, Linux-only container | Goed, maar hele desktop exposed |
| E. DOM-mirroring (rrweb) | Laag | Breekt op canvas, cross-origin iframes, fonts, video | Geen, alleen replay | Laag | 10+ dagen, nooit compleet | Matig (scripts uit de doelpagina in de client) |
| F. Accessibility-tree / tekst | Laag | Geen visuele fidelity | Beperkt tot semantische acties | Zeer laag | 3-5 dagen | Goed |

Latencies zijn schattingen op basis van de architectuur, niet gemeten; het PoC-plan hieronder meet ze.

## 1. Headless Chromium plus JPEG-screencast (aanbevolen)

### Hoe het protocol werkt

`Page.startScreencast` (experimenteel, maar sinds jaren stabiel in gebruik door DevTools zelf) neemt `format` (`jpeg`|`png`), `quality` (0-100), `maxWidth`, `maxHeight`, `everyNthFrame`, `maxFramesInFlight` (default 3) en `sendLastFrame`. Elk frame komt als `Page.screencastFrame` met base64-`data`, `sessionId` en `metadata` (`deviceWidth`, `deviceHeight`, `scrollOffsetX/Y`, `pageScaleFactor`, `timestamp`). De ontvanger stuurt `Page.screencastFrameAck` terug; zonder ack stopt Chrome na `maxFramesInFlight` frames. Met `sendLastFrame` bewaart Chrome het laatst gerenderde frame en stuurt dat direct na de ack, wat latency boven doorvoer stelt. ([CDP Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/))

Chrome produceert alleen een frame als de compositor iets nieuws heeft gerenderd. Een stilstaande pagina kost dus nul bandbreedte ([headless-dev thread](https://groups.google.com/a/chromium.org/g/headless-dev/c/6XKLTi5bsZA)). Er is geen fps-parameter; de effectieve rate is compositor-frames gedeeld door `everyNthFrame`, en in de praktijk maximaal rond 30 fps door de encode- en transportkosten ([devtools-protocol #63](https://github.com/ChromeDevTools/devtools-protocol/issues/63)).

Input: `Input.dispatchMouseEvent` (`mousePressed`/`mouseReleased`/`mouseMoved`/`mouseWheel` met `deltaX/deltaY`, `buttons` bitveld, `clickCount`, `modifiers`), `Input.dispatchKeyEvent` (`keyDown`/`keyUp`/`rawKeyDown`/`char`, met `key`, `code`, `text`, `windowsVirtualKeyCode`) en `Input.insertText` voor paste en IME. Coördinaten zijn CSS-pixels ten opzichte van de viewport, dus de client deelt de canvas-positie door de schaal die uit `metadata.deviceWidth` volgt. ([CDP Input domain](https://chromedevtools.github.io/devtools-protocol/tot/Input/))

### Bandbreedte en DPR

Vuistregel uit de praktijk: 1280x720 JPEG op q80 is 50-100 KB per frame. Bij 15 fps tijdens scrollen is dat 0,75-1,5 MB/s (6-12 Mbit/s). Op 2x DPR (`Emulation.setDeviceMetricsOverride` met `deviceScaleFactor: 2`) verviervoudigt het pixelaantal en ongeveer het bytes-per-frame, dus 3-6 MB/s bij scrollen. Base64 in JSON kost 33% extra, maar Chrome levert de data al als base64: de daemon kopieert de string zonder te decoderen. Knoppen die dit beheersbaar houden: DPR 2 alleen als de daemon op localhost draait, `maxWidth/maxHeight` gelijk aan de node-grootte, `quality` 60 tijdens scroll en 85 in rust, `everyNthFrame: 2` op trage verbindingen.

### Chromium draaien vanuit Bun

Drie opties, geverifieerd op stand september 2026:

- `Bun.WebView` (nieuw in Bun 1.4, 20 augustus 2026): ingebouwde headless browser, op macOS standaard WKWebView, op Linux/Windows een geïnstalleerde Chrome/Chromium/Edge/Brave via CDP. Met `backend: "chrome"` forceer je Chromium ook op macOS. Het exposeert `cdp(method, params)` (alleen Chrome-backend) en CDP-events als DOM-events op de `EventTarget`. Beperkingen: `headless: true` is de enige implementatie, de API is expliciet experimenteel, en overlappende `cdp()`-calls gooien `ERR_INVALID_STATE`, dus acks en input moeten door één serial queue. ([Bun 1.4 blog](https://bun.com/blog/bun-v1.4), [WebView docs](https://bun.com/docs/runtime/webview))
- Eigen CDP-client: `Bun.spawn` Chrome met `--headless --remote-debugging-port=0 --user-data-dir=$RUIMTE_HOME/browser`, lees `DevToolsActivePort` uit de profielmap, verbind met de globale `WebSocket`. Ongeveer 150 regels, geen dependency. `--remote-debugging-pipe` gaat niet omdat `Bun.spawn` `stdio` op drie entries beperkt ([Bun child process docs](https://bun.com/docs/runtime/child-process)). Sinds Chrome 136 weigert Chrome remote debugging op de standaard profielmap, een eigen `--user-data-dir` is verplicht ([Chrome blog](https://developer.chrome.com/blog/remote-debugging-port)). Sinds Chrome 111 checkt Chrome de `Origin`-header op de WebSocket; Bun's client stuurt er geen, dus `--remote-allow-origins` is niet nodig ([crbug 40096993](https://issues.chromium.org/issues/40096993)).
- Puppeteer/Playwright: Bun 1.4 claimt dat Playwright nu draait, inclusief `connectOverCDP()`; het oude launch-hang (#15679) is gesloten via een PR, en de `ws` `unexpected-response`-bug die Puppeteer brak (#31792, juni 2026) is gefixt via PR #36272. Playwright weigert Bun officieel te documenteren (#38095, "not planned"). Ik zou de zware libraries mijden: het protocoloppervlak dat wij nodig hebben is klein. ([bun #15679](https://github.com/oven-sh/bun/issues/15679), [bun #31792](https://github.com/oven-sh/bun/issues/31792), [playwright #38095](https://github.com/microsoft/playwright/issues/38095))

Sinds Chrome 132 is `--headless` de nieuwe headless-modus (zelfde binary als gewone Chrome); de oude modus leeft alleen nog als `chrome-headless-shell` ([Chrome blog](https://developer.chrome.com/blog/removing-headless-old-from-chrome)). Voor een remote Linux-daemon zonder Chrome: `@puppeteer/browsers` installeert Chrome for Testing in een cache-map (licentie Apache-2.0, niet opnieuw geverifieerd omdat npm een 403 gaf), of de distro-Chromium.

Geheugen, vuistregel: 100-200 MB voor het browserproces plus 50-150 MB per tab ([webscraping.ai](https://webscraping.ai/faq/headless-chromium/how-can-i-make-headless-chromium-use-less-cpu-and-memory)). Eén Chrome-proces per daemon met één target per node (`Target.createTarget`) is goedkoper dan een proces per node.

### Electron

Op desktop blijft `<webview>` de beste keuze bij een lokale daemon: native rendering, nul latency, DevTools. Achter een `BrowserBackend`-interface (`webview` | `stream`) kiest de client per node. Verbindt de desktop-app met een remote daemon, dan is `stream` de juiste backend, om dezelfde reden als in web-mode. Electron's `webContents.debugger` is een CDP-transport en kan `Page.startScreencast` sturen, maar dat is alleen relevant als je ooit de webview zelf wilt streamen naar een andere client ([Electron debugger](https://www.electronjs.org/docs/latest/api/debugger)).

## 2. WebRTC

Twee routes. Een helper-pagina in de headless Chromium met `getDisplayMedia` kan zichzelf niet capturen in headless (geen scherm) en vereist een eigen PeerConnection in de daemon. Route twee: CDP-frames encoderen naar VP8/H264 in de daemon en als video-track versturen. Beide vragen een WebRTC-stack in Bun. Stand 2026: `werift` (pure TypeScript, MIT, 0.24.4 van augustus 2026), `node-datachannel` (libdatachannel-bindings, MPL-2.0, 0.33.2 van 29 augustus 2026, N-API dus waarschijnlijk bruikbaar in Bun maar niet geverifieerd), `@roamhq/wrtc` (BSD, 0.10.0, WebRTC M106, verouderde libwebrtc). Geen van drie heeft hardware-encoding in Bun; software-VP8 op 1440p kost een volle core. WebRTC's echte winst is adaptieve bitrate en UDP over slechte netwerken, en hardware-decode in de client. De prijs is ICE/STUN/TURN, een signaling-laag, een tweede transport naast de socket en zachte tekst bij lage bitrate, een bekend probleem bij screenshare-encoders ([multi.app](https://multi.app/blog/making-illegible-slow-webrtc-screenshare-legible-and-fast), [gethopp](https://www.gethopp.app/blog/screensharing-encoders-compared)). Niet waard voor een canvas-pane waar de pagina meestal stilstaat. Houd het als optie als een gebruiker video in een browser-node wil kijken.

## 3. Reverse proxy in een iframe

De daemon haalt de site op en serveert hem onder eigen origin. Wat breekt: `X-Frame-Options` en `CSP frame-ancestors` moet je strippen, cookies met `SameSite=Lax/Strict` gaan niet mee in een iframe, service workers registreren zich op de proxy-origin en kapen daarna requests, OAuth-redirects naar een derde origin verlaten de proxy, absolute URL's in JS, WebSockets en `fetch` met credentials moeten herschreven, en elke site die `location.origin` checkt breekt. Het is de reden dat Browserbase, Hyperbrowser en Anchor allemaal een screencast in een iframe van hún eigen origin leveren, niet de doelpagina zelf ([Browserbase live view](https://docs.browserbase.com/platform/browser/observability/session-live-view), [Browserbase over CDP-screencast](https://www.browserbase.com/blog/session-recordings), [Hyperbrowser](https://docs.hyperbrowser.ai/sessions/live-view), [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)). Een proxy is ook een open relay met de netwerkpositie van de daemon.

## 4. Bestaande bouwstenen

- agent-browser (Vercel Labs, Apache-2.0, Rust): doet precies aanpak A, JPEG-frames over WebSocket met metadata, push- of ack-pacing en "nieuwste frame wint". Goed referentie-ontwerp, niet importeerbaar. ([repo](https://github.com/vercel-labs/agent-browser))
- neko (Apache-2.0): Docker met X-server, Chromium en WebRTC via Go/Pion. Volledige desktop, multi-user, Linux-only. Te zwaar als component in Ruimte, wel de maatstaf voor aanpak D. ([repo](https://github.com/m1k1o/neko))
- Anthropic computer-use demo: Xvfb + x11vnc + noVNC in Docker, screenshots naar het model. noVNC is MPL-2.0 en TypeScript-vrij (ES modules). Aanpak D. ([demo](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo), [noVNC](https://github.com/novnc/noVNC))
- chrome-remote-interface (MIT): Node CDP-client op `ws`; werkt vermoedelijk op Bun sinds de `ws`-fix, maar overbodig naast de globale WebSocket. ([repo](https://github.com/cyrus-and/chrome-remote-interface))
- chrome-launcher (Apache-2.0, 1.2.1, laatste publish ruim 10 maanden terug): vindt de Chrome-binary en start met een tijdelijk profiel. Handig voor pad-detectie, verder vervangbaar door 30 regels. ([npm](https://www.npmjs.com/package/chrome-launcher))
- Playwright `recordVideo` en `puppeteer-screen-recorder`: schrijven WebM naar schijf, video is pas beschikbaar na `context.close()`. Niet live. ([Playwright videos](https://playwright.dev/docs/videos), [puppeteer-screen-recorder](https://github.com/prasanaworld/puppeteer-screen-recorder))
- `Page.captureScreenshot` polling: werkt overal (ook via `Bun.WebView.screenshot()`), maar elke poll rendert opnieuw, ook bij stilstand, en de latency is poll-interval plus encode. Alleen als fallback voor de WebKit-backend.

## 5. DOM- of tekstniveau

rrweb (MIT) serialiseert DOM-mutaties en muisbewegingen en heeft een `liveMode` in de Replayer, maar cross-origin iframes vereisen injectie in elk frame, canvas is opt-in en onveilig in replay, en er is geen kanaal terug naar de pagina. Het is een recorder, geen remote browser ([rrweb guide](https://github.com/rrweb-io/rrweb/blob/master/guide.md)). Een accessibility-tree (CDP `Accessibility.getFullAXTree`) is nuttig als extra laag voor agents (klik op "Submit" zonder pixels), niet als weergave voor een mens. Beide passen dus niet als primair beeld, wel later als agent-hulp naast de stream.

## Architectuur voor Ruimte

Daemon, `apps/server/src/browser/`:

- `chromium.ts`: vindt de binary, spawnt één Chrome per daemon met `--headless --remote-debugging-port=0 --user-data-dir=$RUIMTE_HOME/browser`, wacht op `DevToolsActivePort`, houdt de browser-level CDP-socket. Herstart bij crash.
- `cdp.ts`: minimale client (id-counter, `send(method, params, sessionId)`, event-emitter, `Target.attachToTarget` met `flatten: true`).
- `browser-session.ts`: één per node-id, zelfde patroon als `Session`. Maakt een target, zet viewport en DPR, start screencast bij de eerste attach en stopt bij de laatste detach. Acks een frame zodra de socket het accepteerde en laat frames vallen als `ws.getBufferedAmount()` een drempel passeert (nieuwste frame wint). Alle CDP-calls door één queue.
- `browser-manager.ts`: registry, `detachAll(clientId)`, snapshot van de laatste URL in het projectbestand (de profielmap houdt cookies).

Contracts, `packages/contracts/src/browser.ts`:

- Requests: `browser.create { id, url?, width, height, deviceScaleFactor }` -> `BrowserInfo`; `browser.attach { id, quality?, maxWidth?, maxHeight? }` -> `{ info, frame? }`; `browser.detach`, `browser.kill`, `browser.list`; `browser.navigate { id, url }`; `browser.command { id, action: 'back' | 'forward' | 'reload' | 'stop' }`; `browser.resize { id, width, height, deviceScaleFactor }`; `browser.input { id, event }` waarbij `event` een discriminated union is over `mouse` (type, x, y, button, buttons, clickCount, modifiers), `wheel` (x, y, deltaX, deltaY), `key` (type, key, code, text, windowsVirtualKeyCode, modifiers) en `text` (text).
- Events: `browser.frame { id, seq, data, metadata }` (data blijft de base64-string van Chrome) en `browser.status { id, url, title, loading, canGoBack, canGoForward, exited }`.
- `BrowserInfo` en `BrowserFrameMetadata` als zod-schemas; `REQUEST_SCHEMAS` en `EVENT_SCHEMAS` uitbreiden.

Client, `apps/client/src/browser/`:

- `BrowserBackend`-interface met twee implementaties: de bestaande webview-registry en `stream-client.ts` (attach, frames naar `createImageBitmap(blob)`, drop van oudere frames als er al één wacht op decode).
- `BrowserStream.tsx`: een `<canvas>` in de node, tekent de laatste bitmap, mapt pointer-events naar CSS-pixels, wheel naar `mouseWheel`, keydown/keyup naar `dispatchKeyEvent`, `paste` naar `insertText`. Focus via de bestaande node-focus, zodat canvas-gestures voorrang houden zoals nu bij de webview-layer.
- `BrowserNode.tsx` kiest de backend op `isDesktop() && daemonIsLocal`.

## Effort

- PoC: 1-2 dagen.
- Productie: 6-9 dagen. Daemon en CDP-client 2, contracts en handlers 1, client-canvas en input-mapping 2, DPR/resize/quality-knoppen en lifecycle 1-2, tests en smoke 1.
- Later: clipboard beide kanten, downloads, file-uploads (`DOM.setFileInputFiles`), `beforeunload`-dialogen (`Page.javascriptDialogOpening`), devtools-knop via een tweede CDP-target.

## Risico's

- `Page.startScreencast` is gemarkeerd als experimenteel; het is wel de basis van DevTools' device mode en van Browserbase, dus het verdwijnt niet zomaar.
- Chrome-binary op de daemon-host. macOS-dev heeft Chrome; een remote Linux-box heeft een installatiestap nodig.
- Toetsenbord-mapping (dead keys, AltGr, IME) is de bug-magneet. `insertText` voor `compositionend` dekt het meeste.
- Remote: elke client met toegang tot de socket surft met de netwerkpositie van de daemon. Dit moet meeliften op de authenticatie die remote-mode toch nodig heeft, en het profiel met cookies staat op de daemon-host.
- 2x DPR over een trage verbinding is te zwaar; default naar 1x tenzij de daemon localhost is.
- `Bun.WebView` is experimenteel en macOS-default is WebKit zonder CDP. Voor het PoC prima met `backend: "chrome"`, voor productie de eigen client (of pas overstappen als de API stabiel wordt).

## PoC-plan

1. Script in `apps/server/src/browser/poc.ts`: `new Bun.WebView({ backend: 'chrome', width: 1280, height: 720 })`, `navigate('https://example.com')`, `cdp('Page.startScreencast', { format: 'jpeg', quality: 80, maxFramesInFlight: 2, sendLastFrame: true })`, luister naar `Page.screencastFrame`, log framegrootte en interval, ack per frame. Meet bytes en fps tijdens een `scroll(0, 400)`-loop op 1x en op 2x DPR.
2. Voeg `browser.attach`, `browser.frame` en `browser.input` (alleen `mouse` en `wheel`) aan de contracts toe en relay via een handler; geen persistentie.
3. Client: een `<canvas>` in `BrowserNode` voor de niet-desktop-tak, tekent frames en stuurt clicks en wheel terug. Meet klik-tot-frame in de browser-devtools op localhost en over een gesimuleerde 50 ms RTT.
4. Beslissing na de meting: onder 150 ms lokaal en acceptabel op 2x DPR betekent doorgaan met de eigen CDP-client en de volledige contracts.

Relevante bestanden in de repo: `/Users/bas/Development/Projects/ruimte/apps/client/src/canvas/nodes/BrowserNode.tsx` (de `!available`-tak is de plek voor de stream), `/Users/bas/Development/Projects/ruimte/apps/client/src/browser/registry.ts` (webview-backend), `/Users/bas/Development/Projects/ruimte/packages/contracts/src/index.ts` (`REQUEST_SCHEMAS`/`EVENT_SCHEMAS`), `/Users/bas/Development/Projects/ruimte/apps/server/src/main.ts` (subscribe/detachAll-patroon om te spiegelen).

Sources:
- [CDP Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/)
- [CDP Input domain](https://chromedevtools.github.io/devtools-protocol/tot/Input/)
- [Bun 1.4 release blog](https://bun.com/blog/bun-v1.4)
- [Bun.WebView docs](https://bun.com/docs/runtime/webview)
- [Bun child process docs](https://bun.com/docs/runtime/child-process)
- [Bun issue #15679, Playwright launch](https://github.com/oven-sh/bun/issues/15679)
- [Bun issue #31792, ws unexpected-response](https://github.com/oven-sh/bun/issues/31792)
- [Playwright issue #38095](https://github.com/microsoft/playwright/issues/38095)
- [Chrome: old headless removed in 132](https://developer.chrome.com/blog/removing-headless-old-from-chrome)
- [Chrome 136 remote debugging and user-data-dir](https://developer.chrome.com/blog/remote-debugging-port)
- [crbug 40096993, remote-allow-origins](https://issues.chromium.org/issues/40096993)
- [devtools-protocol #63, FPS option](https://github.com/ChromeDevTools/devtools-protocol/issues/63)
- [headless-dev: screencast in headless](https://groups.google.com/a/chromium.org/g/headless-dev/c/6XKLTi5bsZA)
- [Browserbase live view](https://docs.browserbase.com/platform/browser/observability/session-live-view)
- [Browserbase session recordings](https://www.browserbase.com/blog/session-recordings)
- [Hyperbrowser live view](https://docs.hyperbrowser.ai/sessions/live-view)
- [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)
- [m1k1o/neko](https://github.com/m1k1o/neko)
- [Anthropic computer-use demo](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo)
- [noVNC](https://github.com/novnc/noVNC)
- [werift](https://github.com/shinyoshiaki/werift-webrtc), [node-datachannel](https://www.npmjs.com/package/node-datachannel), [@roamhq/wrtc](https://www.npmjs.com/package/@roamhq/wrtc)
- [rrweb guide](https://github.com/rrweb-io/rrweb/blob/master/guide.md)
- [Playwright videos](https://playwright.dev/docs/videos)
- [puppeteer-screen-recorder](https://github.com/prasanaworld/puppeteer-screen-recorder)
- [chrome-remote-interface](https://github.com/cyrus-and/chrome-remote-interface)
- [chrome-launcher](https://www.npmjs.com/package/chrome-launcher)
- [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)
- [Electron debugger](https://www.electronjs.org/docs/latest/api/debugger)
- [Headless Chromium memory](https://webscraping.ai/faq/headless-chromium/how-can-i-make-headless-chromium-use-less-cpu-and-memory)
- [multi.app on WebRTC screenshare legibility](https://multi.app/blog/making-illegible-slow-webrtc-screenshare-legible-and-fast)
- [gethopp encoder comparison](https://www.gethopp.app/blog/screensharing-encoders-compared)
