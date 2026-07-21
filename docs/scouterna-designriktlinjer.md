# Designriktlinjer för Lägermat

Det här dokumentet är den visuella implementationsspecifikationen för Lägermat v1. Produkten ska kännas scoutnära, trygg och handlingskraftig, men är ett fristående verktyg och inte en officiell Scouterna-produkt.

## Källor

Kontrollerade 19 juli 2026:

- [Scouterna: Kommunicera](https://www.scouterna.se/scout-ledare-kar/kommunicera/)
- [Scouterna: Grafisk profil](https://www.scouterna.se/scout-ledare-kar/kommunicera/grafisk-profil/)
- [Scouternas grafiska profil, PDF](https://media.scoutcontent.se/uploads/2023/01/scouterna_grafisk_profil_oktober2023.pdf)
- [Scouternas kommunikationsmanual, PDF](https://media.scoutcontent.se/uploads/2023/01/Scouterna_kom-manual_240823-1-1.pdf)
- [Scouterna: Bilder och filmer](https://www.scouterna.se/scout-ledare-kar/kommunicera/bilder-filmer/)

Källorna används som inspiration och kvalitetsram. Scouternas grafiska profil anger att Scoutblå ska dominera, att komplementfärger ska användas sparsamt och att text, bilder och kontrast ska vara tillgängliga. Lägermat använder inte Scouternas skyddade avsändare.

## Varumärkesgräns

- Använd aldrig Scouternas logotyp, ordmärke eller scoutsymbol i appen, dokumentationen eller exporter.
- Använd ett eget ordmärke, `Lägermat`, tillsammans med en enkel gryta som egen produktmarkör. Grytan får inte kombineras med lilja, treklöver eller annan scoutsymbolik.
- Påstå aldrig att Lägermat är godkänt, utgivet eller driftat av Scouterna.
- Scoutblå och de öppna typografiska ersättningarna nedan skapar släktskap; produktnamn, ikon och gränssnitt skapar avstånd.

## Färgsystem

### Primär färg

| Token | Värde | Användning |
| --- | --- | --- |
| `--colour-scout-blue` | `#003660` | Apphuvud, primär knapp, vald navigation, länkar och fokusmarkering |
| `--colour-scout-blue-strong` | `#002744` | Hover/pressed och mörkare text på ljus yta |
| `--colour-white` | `#ffffff` | Huvudyta och text på Scoutblå |
| `--colour-ink` | `#151515` | Brödtext och rubriker på ljus bakgrund |

Scoutblå ska vara tydligt dominerande och återges som en solid färg. Använd inte opacitet för att skapa urvattnade varianter av den officiella kulören. Ljusa funktionsytor ska vara egna neutrala tokens.

### Komplementfärger

| Källa | Hex | Roll i Lägermat |
| --- | --- | --- |
| Spårargrön | `#41a62a` | Klar, synkad, godkänd eller ingen specialkost |
| Upptäckarblå | `#00a8e1` | Sekundär visualisering; aldrig normal text på vitt |
| Äventyrarorange | `#e95f13` | Varning, granskningsbehov, offline och köad synk |
| Utmanarrosa | `#da005e` | Specialkost finns eller kräver särskild uppmärksamhet |
| Rovergul | `#e2e000` | Sällsynt markeringsfärg; aldrig text på vitt |
| Rovergul text | `#837a02` | Endast ovanpå Rovergul enligt källprofilen |

Färgerna får aldrig bära betydelse ensamma. Varje status kombineras med ikon, text och vid behov form eller kantlinje. Komplementfärgerna ska inte dominera en vy.

### Neutrala och funktionella ytor

| Token | Värde | Användning |
| --- | --- | --- |
| `--colour-canvas` | `#f7f7f5` | Appbakgrund och sidonavigation |
| `--colour-surface` | `#ffffff` | Arbetsytor, listor och dialoger |
| `--colour-border` | `#d7d9dc` | Tabeller, fält och avdelare |
| `--colour-muted` | `#5f6368` | Sekundär text |
| `--colour-warning-surface` | `#fff7f0` | Ljus varningsyta med orange text/kant |
| `--colour-success-surface` | `#f3faef` | Ljus bekräftelseyta med grön text/kant |

De ljusa ytorna är separata funktionsfärger, inte tonade varumärkesfärger.

## Tillgänglig färganvändning

- Normal text ska primärt vara svart, Scoutblå eller vit med minst WCAG AA-kontrast.
- Scoutblå fungerar för både stor och normal text på vitt.
- Spårargrön och Äventyrarorange får bara användas för stor text på vitt enligt Scouternas kontrastguide; i Lägermat används en mörkare semantisk textfärg när texten är liten.
- Upptäckarblå och Rovergul används inte som text på vitt.
- Utmanarrosa fungerar för både stor och normal text på vitt, men används sparsamt.
- Fokus ska vara synligt även utan färg och ha minst 2 px sammanhängande markering.
- Alla interaktiva träffytor ska vara minst 44 × 44 px. Tangentbordsordning och läsordning ska följa det visuella flödet.

## Typografi

Scouternas profil använder Franklin Gothic/TeeFranklin i rubriker och Garamond/Adobe Garamond Pro i brödtext. Lägermat använder fria, lokalt levererade ersättningar:

- **Libre Franklin** för produktnamn, navigation, rubriker, formulär, tabeller, knappar och kort operativ text.
- **EB Garamond** för längre introduktioner, hjälpartiklar och utskriftsmaterial där en lugnare redaktionell ton passar. Den används inte i täta listor eller små kontroller.
- Systemfallback: `Arial, sans-serif` respektive `Georgia, serif`.

UI-kontroller har avsiktlig storlek, vikt och radavstånd; inga kontroller får falla tillbaka till webbläsarens standardtypografi. Brödtext ska vara minst 16 px på skärm och listmetadata minst 14 px när kontrasten är stark.

## Tonalitet och gränssnittstext

Scouternas manual eftersträvar en äkta, kaxig, modig, inkluderande och lekfull ton. I det operativa Lägermat-flödet betyder det:

- skriv enkel svenska och tala direkt till användaren med `du`;
- använd korta verb i knappar: `Lägg till måltid`, `Visa kö`, `Markera leverans klar`;
- skriv vad som behöver göras, inte vad systemet tekniskt har upptäckt;
- var varm och prestigelös i tomlägen och vägledning, men saklig i specialkostvarningar;
- skilj tydligt på `behov`, `beställt`, `sparat lokalt`, `väntar på synk` och `konflikt`;
- undvik intern kalkylarksjargong, skämt i säkerhetskritiska lägen och vaga fel som `Något gick fel`.

Exempel: `2 specialkoster behöver granskas` är bättre än `Validation failed for dietary records`.

## Bild och GDPR

- Kärnappen behöver inga personfotografier. Ikoner och data ska bära arbetsflödet.
- Om redaktionella bilder läggs till senare ska natur, verklig aktivitet, rörelse och äkta känsla prioriteras framför uppställda motiv.
- Bild på identifierbara personer kräver dokumenterad rättslig grund och läger-/kåranpassat samtycke. Barns bilder ska hanteras särskilt restriktivt.
- Personbilder får inte användas som dekorativ bakgrund bakom operativ text eller känslig specialkostinformation.
- Inga externa bild-CDN:er, analysverktyg eller spårande pixlar används i den lokala v1-prototypen.

## Godkända konceptbilder

Konceptbilderna är bindande implementationsspecifikation för komposition, densitet, visuellt språk och responsivitet:

- [`design/lagermat-desktop-matsedel.png`](design/lagermat-desktop-matsedel.png): desktopvy med toppfält, fast sidonavigation, matsedelsmatris, säkerhetsgrind och detaljpanel.
- [`design/lagermat-mobil-leverans.png`](design/lagermat-mobil-leverans.png): mobil leveranslista med offlinestatus, filter, sök, expanderad rad, lokalt sparad status och fast slutförandefält.

Följande är låst:

- Scoutblått apphuvud, vit huvudyta och återhållsamma kantlinjer.
- Desktop använder vänster navigation och en separat detaljpanel; mobil använder en enda listkolumn och fast nederkant.
- Matris och leveranslista ska förbli tabell-/listrivna och får inte omtolkas som ett generiskt kortgrid.
- Varningar är orange med ikon och förklarande text. Klarstatus är grön med ikon och text.
- Kontroller, etiketter och status är kodnative och interaktiva; konceptbilderna får aldrig användas som statiska UI-bakgrunder.
- Exempelvärden i koncepten är visuell copy, inte golden fixture. Golden-data hämtas från arbetsboken och verifieras separat.

## Designkontroll före leverans

Varje större vy ska jämföras mot relevant koncept på desktop och mobil. Kontrollera minst: synlig copy, layout, typografi, färg, ikonstil, spacing, container-/listmodell, fokus, 44 px-träffytor och responsivt beteende. En avvikelse ska rättas eller dokumenteras som ett medvetet kravstyrt undantag.
