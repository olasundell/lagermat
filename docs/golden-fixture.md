# Golden-fixture för beräkning

Fixturen låser de granskade beräkningsreglerna och kör samma mängdlägen som
appens SQL-beräkning. Decimalerna är strängar i fixturen och `numeric` i
PostgreSQL; inga värden räknas med binär `number`-aritmetik. Arbetsbokens
inköpsenheter används inte som receptmått.

## Källor och spårbarhet

Den lokala arbetsboken är `Lägermat att dela 2024 - 2.0.xlsx`, SHA-256 `86d95a271a20f7c224563e6bbae8abf06853fd9c50097491bb283b3f52ebc892`.

| Ingrediens | Cellområde | Regel från arbetsboken | Golden-beräkning |
| --- | --- | --- | --- |
| Aubergine | `0.1 Recept!C87:F87` | 0,25 st per viktad portion | `0,25 × 22,8 = 5,7 st` |
| Bacon | `0.1 Recept!C44:F44` | 0,05 kg per viktad portion | `0,05 × 86,5 = 4,325 kg` |
| Bregott | `0.1 Recept!C13:J13` | Arbetsbokens pakethint ersätts med ett kuraterat behov på 0,01 kg per viktad portion; mjölkprotein exkluderas | `0,01 × 344,1 = 3,441 kg` |

Arbetsboken har en ogiltig, överflödig pivot-cache-relation utan `Id` och `Target`. Den lästes med den föreskrivna kalkylbladsruntime efter att endast den relationen tagits bort ur en temporär kopia. Originalfilen ändrades inte.

Istras kriterium `dcaf97ec-a04f-4999-a901-9f43f01bb2c2` anger ett publikt
Google-kalkylark som andra källa. Varken projektet, arbetsbokens metadata eller
Istra innehåller arkets URL. Arbetsbokens tidigare Bregott-facit i paket är
uttryckligen ersatt eftersom förpackningen hör till en vald leverantörsartikel,
inte till receptet. När en URL finns ska den och en versionsbunden exporthash
läggas i [goldenLagermat.json](../src/test-fixtures/goldenLagermat.json).

## Reproducerbarhet

Den rena domäntesten räknar fixturen med `decimal.js`. Databastesten skapar
fyra isolerade måltider med faktor-summorna 22,8, 86,5, 344,1 och 10, kör
`calculate_camp`, och jämför PostgreSQLs exakta `numeric`-resultat. Därefter
genererar den inköpslistan och verifierar att 5,5 kg beräknat behov och 6 kg
beställt finns sida vid sida utan att det ena skriver över det andra.

Kör:

```sh
./node_modules/.bin/vitest run src/test-fixtures/goldenLagermat.test.ts
./node_modules/.bin/supabase test db
```
