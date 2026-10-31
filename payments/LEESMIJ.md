# Fuel Run – betalen met Mollie

Spelers kunnen met echt geld **FR-Coin pakketten** en **winkelartikelen** kopen.
De betaling loopt via een kleine gratis server bij Cloudflare (een *Worker*). Die bewaart je geheime
Mollie-sleutel, maakt de betaling aan en zet na betalen de coins of het artikel bij de juiste spelersnaam.

## 1. Mollie
1. Maak een account op <https://www.mollie.com> (voor echte betalingen moet Mollie je bedrijf eerst controleren; testen kan meteen).
2. Ga naar **Developers → API keys** en kopieer de **Test API key** (begint met `test_`).

## 2. Cloudflare Worker
1. Maak een gratis account op <https://dash.cloudflare.com>.
2. **Workers & Pages → Create → Create Worker**, noem hem bijvoorbeeld `fuel-run-pay` en klik **Deploy**.
3. Klik **Edit code**, haal alles weg, plak de inhoud van `worker.js` en klik **Deploy**.
4. Ga naar **Settings → Variables and Secrets** en voeg twee **Secrets** toe:
   - `MOLLIE_KEY` = je Mollie-sleutel (eerst `test_…`)
   - `ADMIN_CODE` = je beheercode (dezelfde als bij HIGHSCORES BEHEREN in de god mode)
5. Kopieer het adres van je Worker, bijvoorbeeld `https://fuel-run-pay.jouwnaam.workers.dev`.

## 3. Firebase
Plak de volledige inhoud van `firestore.rules` in **Firestore → Regels** en klik **Publiceren**.

## 4. In het spel (god mode)
1. Zorg dat de beheercode is ingevuld bij **HIGHSCORES BEHEREN → OPENBAAR**.
2. Vul bij **BETALEN MET MOLLIE** het adres van je Worker in, en de prijzen van de coin-pakketten.
3. Vul bij **WINKEL · PRIJZEN IN EURO** de prijs per artikel in (minimaal € 0,50; leeg = niet met geld te koop).
4. **OPSLAAN**. Er staat dan "Betaalserver gekoppeld · TESTMODUS".

## 5. Testen en live gaan
- In testmodus kies je op de betaalpagina van Mollie gewoon **Paid**: er wordt niets afgeschreven.
- Werkt alles? Vervang in Cloudflare `MOLLIE_KEY` door je **Live API key** (`live_…`).

Alleen spelers met een naam die met een cijfercode is beschermd kunnen betalen, zodat de aankoop altijd bij de juiste naam komt.
