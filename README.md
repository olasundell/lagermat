# Lägermat

Lägermat är en PWA för lägerplanering: deltagare, specialkost, recept, matsedel, portionsberäkning, inköp och leveranser. Appen utvecklas lokalt och kan distribueras som en privat pilot på Netlify och Supabase.

## Miljöer och säkerhetsgräns

- Lokal utveckling använder Supabase CLI/Docker och utvecklingsseed på loopback.
- Staging använder en fast Netlify-site, ett separat Supabase-projekt och endast syntetiska data.
- Produktion använder en egen domän på Netlify och Supabase Pro i Stockholm. Publik registrering är avstängd och administratörsåtgärder kräver TOTP.
- Startskriptet skapar det CLI-kompatibla nätet `supabase_network_scoutmat` med Docker-inställningen `host_binding_ipv4=127.0.0.1`. API, databas, Studio och testmejl publiceras därför endast på loopback.
- Appen innehåller inga analysverktyg eller externa bild-CDN:er. Endast Supabases publicerbara nyckel får finnas i webbläsaren; servernycklar lagras aldrig i Vite eller Netlify.
- PWA-service workern cachar endast appskalet. Känslig API-data läggs inte i HTTP-cachen; offline-listor lagras uttryckligen och versionsstyrt i IndexedDB.
- Hosted distribution är inte godkänd för verkliga personuppgifter förrän checklistan i [`docs/deployment/privacy-gate.md`](docs/deployment/privacy-gate.md) är godkänd.

## Krav

- Node.js 24+
- pnpm 11+
- Docker Desktop eller annan lokal Docker-runtime

## Kom igång

```bash
pnpm install
pnpm supabase:start
cp .env.example .env.local
pnpm supabase:status
pnpm dev
```

`.env.example` innehåller Supabase CLI:s publika lokala demo-nyckel. Service role- eller secret-nyckeln ska aldrig läggas i Vite-miljön.

Appen kör på [http://127.0.0.1:5173](http://127.0.0.1:5173). Lokala testmejl visas i Mailpit på [http://127.0.0.1:54324](http://127.0.0.1:54324).

Efter `pnpm supabase:reset` kan den seedade administratören `oskar@bjorkstad.test` begära en inloggningslänk. Öppna länken i Mailpit. Nya användare skapas genom **Team och roller** i användarmenyn; de kan inte registrera sig själva.

## Kommandon

| Kommando | Syfte |
| --- | --- |
| `pnpm dev` | Starta Vite på loopback |
| `pnpm build` | Typkontrollera och bygg PWA:n |
| `pnpm build:hosted` | Bygg hosted PWA och verifiera CSP, cache och bundle |
| `pnpm check` | Typkontroll och lint |
| `pnpm test` | Kör Vitest |
| `pnpm test:watch` | Kör Vitest i watch-läge |
| `pnpm test:e2e` | Kör Playwright mot lokal app |
| `pnpm supabase:start` | Starta lokal Postgres/Auth/API/Studio/Mailpit |
| `pnpm supabase:status` | Visa lokala URL:er och nycklar |
| `pnpm supabase:reset` | Bygg om lokal databas från migrationer och seed |
| `pnpm supabase:test` | Kör pgTAP-test av RLS och organisationsisolering |
| `pnpm supabase:lint` | Linta produktschemat `public` i den lokala databasen |
| `pnpm supabase:types` | Skriv ut TypeScript-typer från det lokala schemat |
| `pnpm supabase:stop` | Stoppa den lokala stacken |
| `pnpm check:deployment` | Verifiera hosted konfiguration och repositoryhygien |
| `pnpm bootstrap:hosted -- …` | Skapa första administratör, organisation och läger i ett tomt hosted projekt |

## Hosted distribution

Två fasta Supabase-projekt och Netlify-sites provisioneras en gång. GitHub Actions verifierar samma revision, distribuerar staging, pausar för produktionsgodkännande och distribuerar därefter backend före frontend. Utvecklingsseed används aldrig hosted.

Starta med [`docs/deployment/README.md`](docs/deployment/README.md). Där finns provisioning, releaseordning, återställning, miljövariabler och dataskyddsgrinden. Extern provisioning, Git-commit och push utförs först efter uttryckligt godkännande.

## Design

Designregler och officiella källor finns i [`docs/scouterna-designriktlinjer.md`](docs/scouterna-designriktlinjer.md). Desktop- och mobilkoncepten under `docs/design/` är implementationsspecifikation. Lägermat använder ett eget namn och en egen grytmarkör; ingen officiell Scouterna-logotyp eller scoutsymbol används.

## Dataskydd

Lägermat lagrar endast namn, grupp/patrull/måltidsgrupp, närvaro, matfaktor och nödvändig matrelaterad specialkost. Personnummer, kontaktuppgifter och generell hälsodeklaration ska filtreras bort före persistens. Verkliga data kräver en godkänd personuppgiftsansvarig, rättslig grund, integritetstext, gallringsplan och personuppgiftsbiträdesavtal.
