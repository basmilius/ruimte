Lees CLAUDE.md, docs/HANDOFF.md en docs/research/browser-streaming.md voordat je iets doet. Werk in het Nederlands naar mij, geen en- of em-dashes. Dit is een onderzoeksopdracht, geen implementatie: er komt geen productiecode in `apps/` of `packages/` bij. Meetscripts mogen in `docs/research/browser-streaming/` staan.

## Uitgangspunt

De browser-node is vandaag een Electron `<webview>`. Dat blijft zo in de desktop-app: binnen Electron hoeven we niets te streamen, de webview rendert de pagina zelf. Het onderzoek gaat over de andere situatie: de client draait in een gewone browser (Chrome, Safari, Firefox) tegen de daemon, dus de Server Edition op `http://<machine>:4210/` en een gepairde daemon op een andere machine. Daar is geen webview, en daar moet een browser-node toch een levende, bedienbare pagina tonen. De bestaande research-notitie beveelt aanpak A aan (headless Chromium op de daemon, CDP `Page.startScreencast` als JPEG-frames over de bestaande WebSocket, input terug via CDP). Die notitie bevat schattingen, geen metingen, en laat een aantal vragen open. Dit onderzoek moet de beslissing hard maken.

## Vragen die beantwoord moeten worden

1. **Metingen in plaats van schattingen.** Bouw een wegwerp-meetscript in Bun (spawn een lokale Chrome met `--headless --remote-debugging-port=0`, of `Bun.WebView` met `backend: 'chrome'` als dat in Bun 1.4 werkt) dat een screencast start en meet: bytes per frame en frames per seconde bij stilstand, tijdens scrollen en tijdens een video, op 1x en 2x DPR, bij quality 60 en 85; en de latency van een `Input.dispatchMouseEvent` tot het volgende frame. Meet ook wat de daemon-machine ervan merkt (CPU en geheugen van de Chrome-processen bij één, drie en tien open pagina's). Zet de resultaten als tabellen in de notitie onder een kop "Metingen" en zeg hoe ze gemeten zijn.
2. **Chrome op de daemon-host.** Waar vinden we de binary op macOS en Linux (Chrome, Chromium, Edge, Brave), wat doen we als er geen is (downloaden zoals Playwright, of een duidelijke melding), en wat betekent dat voor de gecompileerde daemon uit fase 11 en voor een remote Linux-box zonder desktop.
3. **Input-mapping.** Hoe vertalen we browser-events uit de client naar CDP zonder de bekende valkuilen: dead keys, AltGr, IME en `compositionend`, plakken van tekst en afbeeldingen, sneltoetsen die de client zelf wil houden (Cmd+K, Escape naar het canvas), wheel met precisie-scroll van een trackpad, pinch-zoom. Welke gaan via `dispatchKeyEvent`, welke via `insertText`, en wat kan niet.
4. **Bandbreedte en kwaliteit op afstand.** Wat is werkbaar over LAN, over een tunnel met 50 ms RTT en over een mobiele verbinding; welke knoppen (quality, `everyNthFrame`, `maxWidth`, DPR) zetten we automatisch op basis van `reachability` uit `endpoint.info`, en is JPEG voldoende of is WebP via `Page.captureScreenshot` of een WebCodecs-encoder in de daemon het overwegen waard.
5. **Beveiliging.** Een client die de socket mag gebruiken surft met de netwerkpositie van de daemon en met het cookieprofiel op de daemon-host. Wat volgt daaruit: een profiel per daemon of per project, wat te doen met downloads en file-uploads, en of `browser.*` achter de bestaande pairing (`decideAccess`) genoeg is of een extra toestemming vraagt.
6. **Levenscyclus.** Hoe hoort een gestreamde browser-node zich te gedragen als de client weggaat (pagina blijft leven zoals een terminal-sessie, of stopt na een tijd), bij een reload van de client, bij een crash van Chrome, en bij het wisselen van project (de webview-registry houdt views vandaag verborgen in plaats van ze te vernietigen; zie phase 7 in de handoff).
7. **Alternatieven nog één keer.** Weerleg of bevestig kort waarom WebRTC, een reverse proxy in een iframe, noVNC/neko en DOM-mirroring afvallen, nu met de metingen erbij. Kijk ook naar wat bestaande producten met een "live view" doen (Browserbase, Hyperbrowser, Anthropic's computer-use demo) en of daar iets in zit dat de notitie mist.

## Oplevering

- Een bijgewerkte docs/research/browser-streaming.md: metingen, antwoorden per vraag, een expliciete aanbeveling en de risico's die overblijven. Schrijf het als beslisdocument, met bronnen.
- Een voorstel voor de implementatie als tekst in diezelfde notitie: contracts (`browser.*` requests en events), daemon-modules, client-modules, en waar de backend-keuze zit (`isDesktop()` kiest de webview, anders de stream), in fases met een schatting per fase. Geen code.
- Een korte lijst met wat je niet hebt kunnen meten of verifiëren en waarom.

## Spelregels

- Start nooit zelf de dev server; `bun dev` draait al. Meetscripts draaien los, met `RUIMTE_HOME` in een tijdelijke map als ze een daemon nodig hebben, en ruimen hun Chrome-processen en profielmappen op.
- Geen wijzigingen in `apps/` of `packages/`. Commit alleen de research-notitie en de meetscripts, conventional commits (`docs:`).
- Zeg het expliciet als je iets niet zeker weet of niet hebt kunnen meten; raad niet.
