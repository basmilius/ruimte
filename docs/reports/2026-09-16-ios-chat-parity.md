# AI-chat op iPhone en iPad: onderzoek en bouwvoorstel

16 september 2026. Onderzocht op commit `0d9c297f`. Bas heeft het voorstel goedgekeurd en gevraagd om iPhone-builds bij mijlpalen. De drie stappen zijn geïmplementeerd en de eindbuild is op de fysieke iPhone geïnstalleerd.

## Uitvoering na goedkeuring

De native chat heeft nu Working, Thinking, shimmer, geleidelijke tekstonthulling en zichtbare actieve tools. Het gespreksmenu biedt Words, Blocks en Whole. Bij Reduce Motion blijven labels statisch en verschijnt nieuwe tekst direct. Er zijn aparte toestanden voor een blokkerend verzoek en een verbroken verbinding.

Afgeronde beurten vouwen hun werk in. Antwoorden en waarschuwingen blijven zichtbaar. Subagentberichten staan onder hun eigen agent, met status, uitvoer en resultaat. Een automatische vervolgbeurt kan de bijbehorende subagent openen. Bestandswijzigingen gebruiken checkpointdata, de bestaande diffroute of providergegevens. Een vervangingsfragment krijgt geen verzonnen bestandsregelnummers.

Markdown ondersteunt nu ook geneste lijsten, takenlijsten, meerregelige quotes, referentielinks en passende fence-lengten. Lange prompts zijn inklapbaar; mentions en skills zijn herkenbaar. Berichten hebben kopieeracties voor tekst en Markdown. Bestandslinks openen de native machinebestandsweergave en kunnen naar een regel verwijzen. Rasterafbeeldingen krijgen thumbnails en openen hun origineel via Quick Look.

De rijstructuur en berichttekst hebben afzonderlijke updates. Tekstdeltas bouwen de rijstructuur niet opnieuw op en herberekenen de openstaande verzoeken niet. Markdown bewaart reeds geparste segmenten. Highlighting verwerkt de laatste wachtende tekst met een begrensd tempo, zodat een continue stream de kleuren niet blijft uitstellen. Tooluitvoer begint met maximaal 4.000 tekens; diffs met maximaal 400 regels. Beide zijn uit te klappen.

| Mijlpaal | Controle | iPhone |
| --- | --- | --- |
| 1. Activiteit en streaming | Build geslaagd; 15 gerichte tests geslaagd | Geïnstalleerd en gestart |
| 2. Beurten, subagents en diffs | Build geslaagd; 11 gerichte tests geslaagd | Geïnstalleerd en gestart |
| 3. Inhoud en leesacties | Build geslaagd; 33 gerichte tests geslaagd | Geïnstalleerd; de laatste scrollcontrole met 19 tests is ook geslaagd |

`bun run format`, `bun run check` en de Swift-formatcontrole zijn geslaagd. De bestaande lintwaarschuwingen blijven staan. Er is geen daemonherstart nodig voor deze wijzigingen.

De controles zijn unit- en componentstatetests op de fysieke iPhone, geen UI-automatisering. Er zijn geen simulator, screenshots of iPad-installatie gebruikt. De visuele timing, tekstselectie tijdens streaming, VoiceOver, grotere tekst, energiegebruik en iPad-multitasking zijn nog niet in een echte gesprekssessie beoordeeld. Ook native Markdown is geen claim dat ieder denkbaar Markdown-dialect identiek rendert. Het oorspronkelijke onderzoek en de acceptatiecriteria hieronder blijven de referentie voor de visuele beoordeling.

## Correctie: overlappende chatrijen

Na de eindbuild meldde Bas dat chatelementen door elkaar kunnen lopen. De oorzaak is gereproduceerd in een gerichte componenttest op de fysieke iPhone: een gehoste SwiftUI-rij groeide van 80 naar 240 punten, terwijl de collectie de rij op 80 punten bleef indelen. Ook latere krimp werd niet overgenomen. Tekstdeltas en disclosures kunnen de inhoud bijwerken zonder een nieuwe collectiesnapshot.

`ChatTimelineCollection` gebruikt nu `.enabledIncludingConstraints`, zodat UIKit de rijhoogte opnieuw meet wanneer de gehoste inhoud zijn Auto Layout-maat wijzigt. Dit is de [automatische self-sizing-modus van UIKit](https://developer.apple.com/documentation/uikit/uicollectionview/selfsizinginvalidation-swift.enum/enabledincludingconstraints). Berichten worden niet afgeknipt en tekstupdates hoeven de cellen niet opnieuw te configureren.

De regressietest controleert opeenvolgend 80, 240, 60 en 180 punten, de positie van de volgende rij en het uitblijven van celherconfiguraties. Deze faalde vóór de wijziging en slaagt erna. Alle negen `ChatScrollTests` zijn geslaagd, inclusief leesanker, late metingen, toetsenbordinsets en scrollinteractie. Dit bewijst de hoogteoverdracht; de gemelde echte gesprekssituatie is nog niet visueel herbeoordeeld.

De gecorrigeerde build is op de fysieke iPhone geïnstalleerd en gestart. `bun run format`, `bun run check` en de gerichte Swift-formatcontrole zijn geslaagd.

## Scrollpositie bij uitklappen en naar het einde gaan

Uitklappen houdt rekening met de leesruimte tussen de bovenbalk en de composer. Past de geopende inhoud al in beeld, dan blijft de positie staan. Een korte uitklapper die onder de composer zou vallen schuift net genoeg omhoog. Bij langere inhoud schuift de aangeklikte kop naar boven, ook als die binnen een grotere toolgroep staat. Opengevouwen beurten nemen de ingevoegde werkrijen mee. De meting wacht op de nieuwe rijhoogtes; een nieuwe sleepbeweging of de knop naar het einde annuleert de wachtende verplaatsing. Reduce Motion schakelt de scrollanimatie uit.

De knop naar het einde roept eerst de publieke UIKit-methode [`stopScrollingAndZooming()`](https://developer.apple.com/documentation/uikit/uiscrollview/stopscrollingandzooming()) aan. Daarna neemt de expliciete scrollopdracht de besturing over en volgt de chat weer nieuwe inhoud. Een laat eindesignaal van de afgebroken beweging mag deze keuze niet terugdraaien.

De Swift-build en repositorycontroles zijn geslaagd. De gerichte iPhone-tests zijn voorbereid voor korte en lange uitklappers, geneste koppen, ingevoegde werkrijen, onderbreken door slepen en het annuleren van een native scrollanimatie. Uitvoering en installatie wachten nog op het ontgrendelen van de iPhone. De echte momentumgesture en de visuele timing zijn nog niet handmatig beoordeeld.

## Oorspronkelijk onderzoek en voorstel

Onderstaande bevindingen beschrijven de situatie vóór goedkeuring. De actuele uitvoering staat hierboven.

## Conclusie

De native chat ontvangt de meeste gegevens al, maar toont minder betekenis en voortgang dan de webclient. De grootste oorzaak is de vertaling van chatitems naar zichtbare rijen. Web leidt daar actieve tools, afgeronde beurten, subagentwerk en bestandswijzigingen uit af. iOS bundelt opeenvolgende tools, reasoning en subagents in één ingeklapt `Work log`.

Mijn voorstel is om dezelfde inhoud en toestanden native te ondersteunen, in drie stappen. Eerst actieve status en streaming, daarna de gesprekstructuur en inhoud, vervolgens leesacties en afwerking. De bestaande UIKit-collectie blijft verantwoordelijk voor scrollpositie en virtualisatie; SwiftUI blijft de rijen tekenen.

De benodigde velden staan al in `packages/contracts/src/chat.ts`: onder andere `activeTurnId`, `streaming`, `createdAt`, `endedAt`, `progress`, `parentToolUseId`, `checkpointDiff` en subagentstatus. Voor de voorgestelde presentatie is naar huidige code geen protocolwijziging nodig. Beschikbaarheid bij oudere opgeslagen gesprekken blijft een expliciete terugvalroute.

## Onderzoeksgrens

Volledige codebeoordeling van de gespreksinhoud, met directe raakvlakken aan de composer. Web gebruikt React, Tailwind en gedeelde CSS-tokens. iOS gebruikt SwiftUI in UIKit-cellen, `MobileStyle` en Lucide. Het voorstel volgt die bestaande systemen.

Dit is een vergelijking van de huidige repository, geen visuele vergelijking van geïnstalleerde builds. De precieze versie op apparaten en op de gepubliceerde webomgeving is niet vastgesteld. Er zijn geen simulator, apparaatinstallatie of UI-tests uitgevoerd. De sessie had geen gekoppelde context volgens `ruimte-context list`.

| Categorie | Bekeken bewijs | Uitkomst |
| --- | --- | --- |
| Typografie | `MarkdownMessage.swift`, `MessageRows.tsx`, `Markdown.tsx`, codeblokken | Verschillen in markdownstructuur, lange prompts, verwijzingen en leesacties. |
| Oppervlakken | `ChatTimeline.swift`, `ChatScreen.swift`, `WorkRows.tsx`, `PendingDock.tsx` | Actief werk zit op iOS verborgen; diffs en verzoeken zijn minder informatief. Bestaande 44-puntsbediening behouden. |
| Animaties | Transacties van de iOS-cellen; web `reveal.ts`, `MessageRows.tsx`, `styles.css:690` | Geen iOS-shimmer of geleidelijke tekstonthulling. Werkelijke beweging niet visueel beoordeeld. |
| Iconen | Lucide-rijen op beide platforms, statuslabels | Web maakt tooltypen en waarschuwingen herkenbaar; iOS gebruikt vaak één generiek icoon. |
| Prestaties | `ChatModel.receive`, `ChatTimelineController.flushUpdate`, markdownparsing en highlighting | iOS berekent de rijgroepering opnieuw bij tekstupdates. Kosten op apparaten niet gemeten. |

## Verschillen en voorgestelde wijzigingen

HIGH betekent dat informatie verkeerd kan worden toegeschreven of een belangrijke toestand onvoldoende herkenbaar is. MEDIUM betekent een merkbaar verschil in gebruik of presentatie.

### Actieve toestanden en beweging

| Ernst | Locatie | Nu | Voorstel | Waarom |
| --- | --- | --- | --- | --- |
| MEDIUM | `ChatScreen.swift:43`, `ChatTimeline.swift:6`, `ChatModel.swift:129`; web `WorkingRow` | De timeline ontvangt alleen items en revision. Alleen de composer gebruikt `activeTurnId`; een losse `info`-update verhoogt revision niet. | Een afgeleide activiteitsstatus doorgeven en apart verversen. Tijdens een actieve beurt onderaan `Working for 00:14`, ook voordat tekst of tools verschijnen. Eindigen bij voltooiing, fout of stop. Verbinding verloren en een blokkerend verzoek krijgen een eigen statische aanduiding. | Statusfeedback moet aansluiten op de werkelijke toestand. `running` bij ChatInfo zegt dat het CLI-proces leeft, niet dat een beurt actief is. |
| MEDIUM | `ChatTimeline.swift:250`, `:478`; web `styles.css:690` | Alleen een kleine spinner in Work log bij een tool of subagent met running-status. Reasoning gebruikt `streaming` en activeert die spinner niet. De cel schakelt SwiftUI-transactieanimaties breed uit. | Eén gedeelde shimmer voor actieve labels, met de webcyclus van 1,6 seconde als uitgangspunt. Alleen de inhoud animeren, met behoud van stabiele celgeometrie. | Beweging moet activiteit aangeven zonder scrollsprongen. Een statisch label blijft altijd beschikbaar. |
| MEDIUM | `ChatTimeline.swift:549`, `MarkdownMessage.swift:139`; web `AssistantRow`, `reveal.ts` | Binnenkomende tekst verschijnt per ontvangen update; de renderer krijgt geen streamingstatus. | Nieuwe woorden geleidelijk onthullen met de webfade van 300 ms. Het restant afmaken wanneer de stream eindigt. Bestaande berichten direct tonen. Later in stap 3 ook de webkeuzes Words, Blocks en Whole aanbieden. | De waargenomen snelheid wordt gelijkmatiger. Reeds gelezen tekst hoort niet opnieuw te animeren. |
| MEDIUM | `ChatTimeline.swift:551`; web `ThinkingRow` | Reasoning zit achter Work log en vervolgens een tweede disclosure. Geen looptijd of actieve tekst. | Een eigen `Thinking...`-rij met live providertekst, daarna `Thought for ...` en inklappen volgens het webgedrag. De gekozen streamingmodus bepaalt wat tijdens het schrijven zichtbaar is. | Actieve feedback blijft vindbaar. Alleen reasoning tonen dat de provider daadwerkelijk aanlevert. |
| MEDIUM | `ChatTimeline.swift:554`; web `WorkLiveRow`, `WorkGroupRow`, `logic/tools.ts` | Toolnaam en ruwe state; input en output achter twee kliks. Lopende en afgeronde tools zitten in dezelfde groep. | Actieve tools apart met passend icoon, command/pad/samenvatting, looptijd en de laatste 12 outputregels als de provider die levert. Afgeronde tools groeperen, bijvoorbeeld `Read 4 files`. | De gebruiker moet kunnen zien welke handeling loopt. Begrensde uitvoer voorkomt dat één tool het gesprek overneemt. |

### Gesprekstructuur en betekenis

| Ernst | Locatie | Nu | Voorstel | Waarom |
| --- | --- | --- | --- | --- |
| MEDIUM | `ChatTimeline.swift:428`, `:599`; web `deriveTimelineRows` | Groeperen op opeenvolgende itemtypen, niet op beurt. Een turn krijgt een generieke regel. | Groeperen op `turnId`. Een afgeronde beurt krijgt `Worked for ...`, `Failed after ...` of `You stopped after ...`; eindantwoord en bestandswijzigingen blijven zichtbaar. Agentgestarte beurten krijgen hun eigen verklaring. | Een lang gesprek moet scanbaar blijven zonder de werkgeschiedenis kwijt te raken. |
| HIGH | `ChatTimeline.swift:577`, `:549`; web `groupChildren`, `SubagentRow` | `parentToolUseId` wordt niet gebruikt. Subagenttekst kan daardoor als een gewoon assistantbericht in de hoofdconversatie staan. De agentrij toont alleen een eenvoudige disclosure. | Werk en berichten onder hun eigen subagent plaatsen. Taak, status, looptijd, laatste tool, achtergrondstatus, resultaat en eventuele afkapping tonen. Dezelfde koppeling gebruiken bij automatisch vervolgwerk. | Herkomst van tekst moet duidelijk zijn. Een subagentantwoord mag niet als het hoofdantwoord worden gelezen. |
| MEDIUM | `ChatTimeline.swift:565`, `:599`; web `ChangedFilesRow`, `EditDiff`, `UnifiedDiff` | Aanwezige patches staan als gewone code. Alleen een opgeslagen checkpointdiff levert een turnlijst op. | Eén overzicht per beurt met bestanden, aantallen toegevoegde/verwijderde regels en leesbare diffs. Eerst checkpointdata, dan de bestaande `chat.turnDiff`-route waar passend, daarna providerpatches of voor/na-inhoud. Toon binary, too-large en truncated expliciet. | De gebruiker moet wijzigingen kunnen beoordelen, ook wanneer de provider geen uniforme patch aanlevert. |
| HIGH | `ChatTimeline.swift:584`, `:590`, `:612`, default; `ChatScreen.swift:401`; web history-rijen en `NoteRow` | Pending vragen en approvals staan zowel in het gesprek als boven de composer. Decisions/states zijn grotendeels ruwe waarden. Een note verliest via default zijn info/warning/error-presentatie. | Actieve verzoeken bij de composer; uitkomst in de geschiedenis. Menselijke labels, command/diffdetails bij approvals en een weigerreden waar de provider die ondersteunt. Notes met niveau, icoon en toegankelijke betekenis; compaction met het beschikbare tokenaantal. | Belangrijke waarschuwingen en beslissingen moeten herkenbaar zijn. Bestaande vraagformulieren en toestemmingsacties zijn al aanwezig en worden uitgebreid. |

### Lezen, inhoud en updates

| Ernst | Locatie | Nu | Voorstel | Waarom |
| --- | --- | --- | --- | --- |
| MEDIUM | `MarkdownMessage.swift:17`, `ChatTimeline.swift:535`; web `Markdown.tsx`, `UserRow` | Eenvoudige eigen blokparser. Lijstregels worden als inline tekst getekend; geneste lijsten, takenlijsten en meerregelige blokken hebben geen volwaardige structuur. Gebruikerstekst is plain text. | Markdowngevallen gelijk trekken met gedeelde voorbeeldteksten: lijsten, taken, quotes, tabellen, fences en links. Lange prompts inklapbaar maken; mentions en skills herkenbaar tekenen. | Opmaak draagt betekenis. Een opsomming of verwijzing moet op beide platforms hetzelfde betekenen. |
| MEDIUM | `MarkdownMessage.swift:154`, `ChatAttachmentButton.swift:16`, `ChatTimeline.swift:554`; web `MarkdownLink`, `ImageThumb`, `ReadImage`, `TimelineMenuPopup` | Bijlagen zijn bestandsknoppen zonder afbeeldingsthumbnail. Chatbestandslinks hebben geen routering naar machinebestanden. Alleen code heeft een specifieke kopieeractie. | Thumbnails en afbeeldingspreview voor ondersteunde bronnen; bestandsverwijzingen naar de bestaande native bestandsweergave routeren, inclusief regelnummers waar ondersteund. Een contextmenu voor Copy message, Copy as Markdown en bestaande Copy code. | Gespreksinhoud moet direct bruikbaar zijn. Bestandspaden verwijzen naar de machine van de chat. |
| MEDIUM | `ChatModel.swift:139`, `ChatTimeline.swift:313`, `MarkdownMessage.swift:139`, `:211`; web structure/items en `IncrementalLines` | Iedere delta verhoogt de timeline-revision en hergroepeert de items. Markdown wordt als geheel opnieuw geparsed. Code-highlighting wordt bij elke verandering gewist en opnieuw ingepland. | Structuurupdates scheiden van tekstupdates. Alleen gewijzigde rijen verversen; afgeronde markdownblokken behouden. Highlighting begrenzen en bestaande kleuren behouden tijdens nieuwe output. Timers en shimmer lokaal laten draaien zolang zichtbaar. | Dit is nodig voordat extra animaties worden toegevoegd. Het huidige gedrag is aangetoond in code; de prestatie-impact moet nog worden gemeten. |

## Bouwvolgorde ter goedkeuring

### 1. Zichtbare activiteit en vloeiende tekst

- Een getypeerd presentatiemodel voor chatrijen, met stabiele IDs en expliciete actieve status. Het bestaande wirecontract blijft de bron.
- Working, Thinking en actieve toolrijen zichtbaar maken. Blokkerende approvals onderscheiden van asynchrone vragen waarbij de agent doorwerkt.
- Shimmer en geleidelijke tekstonthulling. Getallen blijven even breed, zodat de timer niet schuift.
- Info-updates, verbindingstatus, stop, fouten, herstel en terugkeer naar een chat correct verwerken.
- Alleen betrokken rijen bijwerken en afgeronde tekst direct tekenen bij heropenen.

Eerste reviewmoment: een beurt van verzenden tot eindantwoord moet op iPhone dezelfde voortgang vertellen als web. Deze stap is op zichzelf bruikbaar.

### 2. De volledige inhoud van een beurt

- Afgeronde beurten en toolgroepen samenvatten, met het eindantwoord zichtbaar.
- Subagents correct nesten, inclusief live werk, resultaten en automatische vervolgbeurten.
- Bestandswijzigingen verzamelen en native diffs tekenen. De bestaande Git-diffweergave biedt herbruikbare uitgangspunten.
- Pending verzoeken en geschiedenis scheiden; approvaldetails en note/compaction-presentatie aanvullen.
- Scrollankers behouden bij inklappen, uitklappen, streamen en wijzigingen boven de leespositie.

Tweede reviewmoment: hetzelfde synthetische gesprek moet dezelfde inhoud en dezelfde herkomst tonen op beide clients.

### 3. Markdown, media en leesacties

- Markdownstructuur aanvullen; lange prompts, mentions en skills gelijk trekken.
- Streamingkeuzes Words, Blocks en Whole toevoegen, standaard Words zoals web.
- Afbeeldingen, machinebestandslinks en kopieeracties toevoegen aan gesprekken.
- Dezelfde componenten controleren op smalle iPhone- en iPad-detailbreedten, grotere tekst, donker/licht en Reduce Motion.
- VoiceOver laat berichten, werk en beslissingen onderscheiden. De timer wordt niet iedere seconde aangekondigd.

Derde reviewmoment: inhoud en bediening werken op beide formaten zonder horizontale overflow van de hele conversatie. Brede code, tabellen en diffs mogen afzonderlijk horizontaal scrollen.

De lastigste delen zijn stabiele tekstonthulling bij markdown, selectie tijdens updates en correct nesten/inklappen zonder scrollsprongen. Daarom bouw ik die op dezelfde afgeleide rijen en synthetische voorbeeldgesprekken, in plaats van ieder visueel element een eigen statebron te geven.

## Native uitvoering

De brede uitschakeling van celanimaties blijft een grens voor geometrie. Shimmer en tekstfade krijgen een eigen lokale renderer. SwiftUI biedt `TextRenderer` voor aangepaste tekstweergave; selectie, links en VoiceOver moeten bij de concrete uitvoering worden gecontroleerd. Zie [Apple TextRenderer](https://developer.apple.com/documentation/swiftui/textrenderer).

Een periodieke timer kan alleen de verstreken tijd verversen; een animatieschema kan worden gepauzeerd. Dit ondersteunt het voorstel om werk buiten beeld geen voortdurende animatie-updates te laten veroorzaken. Zie [Apple TimelineSchedule](https://developer.apple.com/documentation/swiftui/timelineschedule). Dit is een ontwerpkeuze, geen al gemeten energiebesparing.

Bij Reduce Motion stel ik statische actieve labels en direct zichtbare nieuwe tekst voor. De systeemvoorkeur is beschikbaar via [Apple accessibilityReduceMotion](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion).

## Overwogen alternatieven

| Locatie | Alternatief | Afweging |
| --- | --- | --- |
| Gehele timeline | De webchat in een WKWebView plaatsen | Niet gekozen. De native scrollinsets, tekstbediening en navigatie zijn al aanwezig; een tweede volledige client maakt integratie en lifecycle complexer. |
| Working en tools | Alleen een spinner of shimmer toevoegen | Niet voldoende. Actieve tools blijven verborgen en subagentberichten blijven verkeerd gegroepeerd. |
| `ChatTimelineController` | Alle celanimaties aanzetten | Niet gekozen. Dat kan hoogtemetingen, keyboardinsets en leesankers weer laten bewegen. Alleen de bedoelde inhoud krijgt animatie. |
| `MarkdownMessage` | Iedere delta als een nieuw geanimeerd bericht tekenen | Niet gekozen. Dat herstart effecten, verliest selectie en vergroot de hoeveelheid layoutwerk. |

## Aanpalende verschillen

De webcomposer heeft ook een contextmeter en een bewerkbare/verwijderbare wachtrij. iOS toont momenteel alleen het aantal berichten in de wachtrij. Die verschillen zijn gevonden, maar horen bij een aparte composeruitbreiding; het voorstel hierboven richt zich op conversatie-inhoud en de presentatie van actieve verzoeken.

Historypaginering is een apart protocol- en geheugenprobleem. Minder herberekenen en slimmer renderen helpt tijdens lezen en streamen, maar maakt de bestaande volledige attach-snapshot niet kleiner. Ook notificaties, Live Activities en algemene navigatie vallen buiten dit voorstel.

## Verificatie

Uitgevoerd op de bestaande webreferentie:

```sh
bun test apps/client/src/chat/logic/timeline.test.ts \
  apps/client/src/chat/ui/reveal.test.ts \
  apps/client/src/chat/ui/markdown-blocks.test.ts \
  apps/client/src/chat/logic/tools.test.ts
```

Resultaat: 44 tests geslaagd, 0 mislukt, 92 assertions. Deze bevestigen onder meer actieve Working-rijen, beurtgroepering, subagentkoppeling, reveal-timing, markdownfences en live tooloutput. Ze bewijzen geen iOS-pariteit.

De bestaande iOS-tests voor chatdeltas, reset, markdown en scrollankers zijn gelezen. Na goedkeuring zijn gerichte checks nodig voor de nieuwe afleiding en streamingstate. Gebruik synthetische gesprekken, met ontbrekende oudere velden, providerfouten en herstel na disconnect. Geen echte gebruikersgesprekken in fixtures.

Acceptatie na implementatie:

1. Direct na het begin van een beurt verschijnt actieve feedback, ook bij wachten op eerste tekst.
2. Alleen nieuw binnengekomen tekst animeert; reeds afgeronde antwoorden doen dat ook na heropenen niet.
3. Een timer, delta of shimmer bouwt niet de hele historie opnieuw op.
4. Actieve tools blijven leesbaar, fouten zijn herkenbaar, stop en voltooiing laten geen achtergebleven actieve status zien.
5. Hoofdantwoord, subagentwerk, changed files en beslissingen staan onder de juiste beurt.
6. Omhoog scrollen bewaart de leespositie. Uitklappen, toetsenbordwissels en nieuwe tekst trekken de lezer niet naar beneden.
7. Hetzelfde gesprek blijft bruikbaar bij iPhone- en iPad-breedten, grotere tekst, Reduce Motion en VoiceOver.

Niet geverifieerd: geïnstalleerde builds, echte providerstreams, visuele timing op 10% snelheid, apparaatframerate/geheugen, tekstselectie tijdens streaming, VoiceOver, Dynamic Type en iPad-multitasking. Deze blijven open totdat ze daadwerkelijk zijn beoordeeld. Bouw- en installatiecontroles volgen pas na goedkeuring; de actuele apparaatworkflow wordt dan aan de geldende afspraken getoetst.

Oordeel: **Block** voor een claim van volledige conversatiepariteit. De HIGH-bevindingen over subagentherkomst en status/waarschuwingen zijn nog aanwezig; de genoemde apparaatcontroles zijn niet uitgevoerd. Dit oordeel blokkeert het bouwvoorstel niet. De implementatie wacht op de door Bas gevraagde goedkeuring.
