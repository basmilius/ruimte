> Statuscorrectie, 16 september 2026: de eerste drie punten hieronder zijn opgepakt in `86dbcfc5`. De signed iPhone-build is geïnstalleerd en gestart. De daemon is niet herstart; beide APNs-sleutels staan inmiddels lokaal in `~/.private/ruimte/apns`, maar upload naar Cloudflare wacht op expliciete toestemming en Worker-migratie 0008 is nog niet gedeployd. Distributie is uitgesteld op verzoek. Lees de actuele secties van [het rapport](2026-09-15-ios-app.html) en het laatste [iteratieverslag](2026-09-15-ios-composer-review.md). De oorspronkelijke opdracht hieronder blijft als historie bewaard en is geen opdracht om de implementatie opnieuw te doen.

# Ruimte iOS: vervolg in een schone sessie

Werk de bestaande native Ruimte-app af. Bas focust zich tijdelijk op ander werk. Ga zelfstandig door met uitvoerbare verbeteringen en geef korte voortgangsupdates in het Nederlands. Deze prompt is de overdracht van 16 september 2026, na commit `54e636b3` op lokale `main`. Controleer de huidige werkboom en nieuwe commits voordat je wijzigt. Behoud werk van anderen.

## Lees eerst

- `docs/reports/2026-09-15-ios-app.html`: de actuele status en restpunten bovenaan. Het oude onderzoek en faseplan daaronder zijn historische context.
- `docs/reports/2026-09-15-ios-composer-review.md`: bewijs en beperkingen per iteratie, vooral de laatste secties.
- De toepasselijke repository-instructies, `CLAUDE.md` en de iOS-besluiten in `docs/DECISIONS.md`, voor zover aanwezig. `apps/ios/README.md` loopt op onderdelen achter op de code en moet worden bijgewerkt.

## Afspraken met Bas

- Itereer snel. Bouw en installeer uitsluitend op zijn fysieke iPhone: `00008130-001C7D411E20001C`. Geen iPad-installaties, simulator of UI-tests. Kleine gerichte tests voor gewijzigd protocol, crypto of state zijn toegestaan; draai geen brede suite voor een kleine UI-wijziging. Niet gemeten apparaatgedrag blijft expliciet open.
- Gebruik alleen publieke Apple-API's en behoud native navigatie. Geen gesture-workarounds die knopinteractie onderscheppen. De huidige UI is samen met Bas uitgewerkt; geen nieuwe herinrichting zonder aanleiding.
- Herstart de draaiende Ruimte-daemon niet: daar lopen actieve sessies. Server- en contractcode mag worden voorbereid en met geïsoleerde fixtures worden gecontroleerd. Een wijziging aan de huidige daemon is pas live na een later afgesproken herstart.
- Development-signing werkt al. Bundle `app.ruimte.mobile`, team `7RGV9KKX87`, lokale signing in `apps/ios/Signing.xcconfig`. Geen sleutels of tokens in output of commits.
- Commit afgerond werk lokaal met Engelse conventional commits, zonder attributie. Niet pushen of naar TestFlight uploaden. Bereid externe configuratie concreet voor en vermeld wat daarna nog nodig is. De eerdere toestemming voor Pulsar-updates blijft gelden voor noodzakelijke backendwijzigingen; beoordeel de concrete wijziging en bestaande configuratie eerst.
- Gebruik Codex wanneer je sub-agents inzet, nooit Claude. Delegatie is niet nodig om deze opdracht te beginnen.
- Gebruik toepasselijke skills, waaronder code-comments bij code en html-report/unslop voor de rapportage. Werk binnen bestaande toestemming door; stel alleen een vraag als een ontbrekend antwoord het werk werkelijk blokkeert.

## Huidige implementatie

De app staat in `apps/ios`, minimum iOS/iPadOS 26, lokaal Xcode 27. SwiftUI met UIKit voor timeline/canvas, SwiftTerm voor terminals en LucideSwift voor iconen. Geen lokale daemon in de app.

Gebouwd zijn native Apple-login, GitHub-login, HTTPS-pairinglinks, een gezamenlijke projectenlijst, iPad master-detail, views, chats, terminal, bestanden/media, Git, usage, browser, canvas, tekeneditor met vormen/tekst en Apple Pencil, notificatie-extensie en Live Activities. Dat is implementatiebewijs, geen volledige apparaatacceptatie.

Belangrijke actuele keuzes:
- Tagline: `Space for AI Engineering`. Apple staat vóór GitHub.
- Processes is bewust uit de app verwijderd. Live Activities zijn in deze app alleen voor iPhone, standaard voor de laatst geopende chat. De oude tekst over iPad-activiteiten is geen actuele opdracht.
- Gebruik de grijze webpalette, monochrome iconen en de gedeelde sidebar-rijen met geanimeerde press-state. Native toggles behouden hun systeemkleur. Projecttitels en viewnamen hebben maximaal één regel met ellipsis.
- iPad heeft altijd een sidebar met detail na login. Projectkeuze wisselt de sidebar; het detail start met een selectieprompt. De Ruimte-branding staat alleen in de startsidebar. Behoud de zachte border en de tabs/zoekinteractie.
- Canvasnodes worden niet verplaatst of geresized. Tekenelementen in een drawing hebben hun eigen selectie- en bewerkingstools. Browserpagina's hebben geen privileged machine bridge.
- Chat/terminal-attachments en machineverbindingen worden gedeeld. Een pagina sluiten mag geen agentsessie stoppen of een andere scene loskoppelen. Terminal attach gebruikt `follow:true` en verandert de desktopmaat niet.

## Al opgeloste performanceproblemen

`NativeWebRTCLink.swift` wacht sinds `54e636b3` maximaal een eerste venster van 250 ms op bruikbare initiële candidates, in plaats van standaard de vijf seconden gather-timeout af te wachten. Zonder candidate blijft de vijfsecondenfallback bestaan. Normale ICE-policy is `all`: direct waar mogelijk, TURN als terugval. Relay-only is uitsluitend diagnostiek. Bewaar candidate-deduplicatie en stuur extra candidates pas na het antwoord; eerdere replay veroorzaakte broker-rate-limits en verbroken verbindingen. Behoud pinned machine keys, gesigneerde signaling, channelBinding en handshake-limieten.

Op de fysieke iPhone is de verbinding met deze Mac gemeten op 709 ms in plaats van 5.625 ms; de tweede machine op 681 ms in plaats van 5.528 ms. Beide host/host, zonder TURN. Dit zijn losse metingen vanaf linkcreatie, exclusief accountdiscovery en laden van gegevens. Het bewijst geen broker-vrije LAN-route. Log: `/tmp/ruimte-connection-iphone-fast.log`, als die nog aanwezig is.

`SharedMachineSession` houdt de laatste verborgen ChatModel maximaal 30 seconden live. Zichtbare scenes delen ownership; disconnects verwijderen verborgen chats. Heropenen kan de snapshot en providerlijst hergebruiken en slaat een overbodige `chat.create` over. `MachineClient.receiveInOrder` decodeert buiten de main actor, bewaart volgorde en negeert frames van vorige verbindingen. Deze cache is nog niet met een UI-meting getimed.

## Werkvolgorde

1. Maak een korte actuele inventaris van concrete functionele gaten tegenover de bedoelde mobiele scope. Scheid ontbrekende code, ongetest gedrag en distributiewerk. Oude README-claims over ontbrekende tekentools, Processes of de Apple-webflow zijn achterhaald. Herbouw bestaande onderdelen niet.
2. Pak grote chats structureel aan. `chat.attach` stuurt nu alle items. Een echte App: Codex-chat had circa 17,7 miljoen UTF-16-eenheden en 2.871 items, vooral tooloutput. De receiverlimiet is tijdelijk 64 Mi UTF-16, handshake 4.096. Ontwerp een begrensde eerste historypagina en laden van oudere items via het gedeelde contract, daemon en iOS. Bewaar snapshot/delta-volgorde, approvals, resets/clear en scrollpositie bij prepend. Ondersteun de draaiende oudere daemon zonder de link te verbreken of stil items weg te laten. Verifieer de aanpak met kleine synthetische fixtures; kopieer geen gebruikersgesprekken naar tests. Verhoog niet opnieuw alleen de framelimiet. Meet waar mogelijk bytes, decodeertijd en requestaantallen; label on-device openingstijden als ongemeten zolang Bas ze niet heeft beoordeeld.
3. Maak Live Activity push-to-start af voor de laatst bekeken iPhone-chat. De huidige `NotificationCoordinator` start via `Activity.request` wanneer de app actief is; er is nog geen verwerking van `pushToStartTokenUpdates`. Controleer de gedeelde tokenroutes, account/device-binding, intrekking, opt-out en daemon/Worker-payloads. Voorkom dubbele activities. Behoud de grens dat alleen toegestane ActivityKit-inhoud onversleuteld reist. Raadpleeg actuele officiële Apple-documentatie bij implementatie. iPad-activiteiten blijven uit scope.
4. Controleer de notificatieketen op concrete ontbrekende implementatie: toestemming, registratie, encryptie/decryptie, verlopen of al beantwoorde verzoeken, eenmalige achtergrondacties en fallback naar de chat. Gebruik de bestaande X25519/HKDF/AES-GCM, routing-AAD en machinehandtekening. Replay-, expiry- en intrekkingscontroles blijven intact. Onderzoek de huidige APNs-configuratie zonder secrets te tonen. Lokale tests bewijzen geen APNs-bezorging, Wi-Fi/5G-succesratio of gedrag na langdurig achtergrondgebruik; leg die resterende acceptatie vast.
5. Werk README en dit rapport bij. Bereid de Xcode Cloud/TestFlight-route voor op basis van de aanwezige `apps/ios/ci_scripts`, signing en privacy-manifesten. Maak concreet welke repositorywijzigingen af zijn en welke Apple-accountconfiguratie, distributiesigning of upload nog nodig is. Development-signing is al geregeld. Publiceren/uploaden is geen onderdeel van deze opdracht.

Een extern geblokkeerd onderdeel mag zelfstandig werk aan andere onderdelen niet stilleggen. Noteer de blokkade met bewijs en ga verder. Noem de app pas feature complete wanneer alle afgesproken functies zijn geïmplementeerd; rapporteer apparaatacceptatie en releasegereedheid afzonderlijk.

## Build, controle en overdracht

Werk vanuit `/Users/bas/Development/Projects/ruimte`. `apps/ios/project.yml` is de projectbron. Genereer na projectwijzigingen met `xcodegen generate --spec apps/ios/project.yml`. Behoud packagepins en commit geen buildoutput of xcuserdata. Format gewijzigde Swift-code. `NativeWebRTCLink.swift` heeft een buitenste `#if` met niet-ingesprongen inhoud; voorkom formatterruis. Draai `bun run format` en `bun run check` vóór een commit. Controleer gewijzigde contracten/codegen gericht; bestaande lintwaarschuwingen zijn bekend.

```sh
xcodebuild -project apps/ios/Ruimte.xcodeproj -scheme Ruimte -configuration Debug \
  -destination 'id=00008130-001C7D411E20001C' -derivedDataPath /tmp/ruimte-ios-xcode \
  -allowProvisioningUpdates build
xcrun devicectl device install app --device 00008130-001C7D411E20001C \
  /tmp/ruimte-ios-xcode/Build/Products/Debug-iphoneos/Ruimte.app
xcrun devicectl device process launch --device 00008130-001C7D411E20001C \
  --terminate-existing app.ruimte.mobile
```

Laat een onbereikbare of vergrendelde iPhone geen reden zijn om codewerk te stoppen. Meld installatie dan als open. Optionele verbindingstracing gebruikt alleen tijdelijk `RUIMTE_TRACE_CONNECTION=1`; start daarna normaal. Geen screenshots of UI-automatisering als vervanging van de afgesproken snelle iteratie.

Werk het actuele deel van het HTML-rapport en `docs/reports/2026-09-15-ios-composer-review.md` bij met commits, concrete resultaten en beperkingen. Eindig met wat is gebouwd/geïnstalleerd, wat nog niet live is op de daemon, en wat Bas later moet beoordelen. Vraag niet tussendoor om algemene bevestiging om verder te gaan.
