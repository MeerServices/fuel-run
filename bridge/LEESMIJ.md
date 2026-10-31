# Fuel Run controller-bridge

Een browser kan niet zelf naar UDP luisteren. Deze kleine bridge doet dat voor het spel:
hij luistert op **UDP-poort 6001** naar de controller en geeft elk bericht via een WebSocket door aan Fuel Run.
Ook serveert hij het spel zelf op **poort 6002**.

## Starten
1. Installeer Node.js (versie 16 of nieuwer) via https://nodejs.org als dat nog niet op de computer staat.
2. Zet deze map op de computer die de UDP-berichten van de controller ontvangt.
3. Windows: dubbelklik `start-windows.bat`. Mac/Linux: `./start-mac-linux.sh`.
4. Het spel opent vanzelf in je browser op http://localhost:6002 (gebruik `--no-open` als je dat niet wilt).
   Open het spel:
   - op die computer: http://localhost:6002
   - op een telefoon of tablet in hetzelfde netwerk: http://<ip-adres-van-die-computer>:6002
     (het adres staat in het venster van de bridge)

Via de bridge staat de controller in het spel automatisch aan (CONFIG > Controller via UDP).
Speel je via https://meerservices.github.io/fuel-run op dezelfde computer, zet hem dan in CONFIG aan
met bridge-adres `ws://localhost:6002`.

## Berichten
`{"deviceNumber":1,"buttonNumber":3,"event":"pressStart"}` en `"pressEnd"`.
Knoppen: 0 omhoog · 1 links · 2 midden · 3 rechts · 4 omlaag.

In het spel: pijlen = vliegen, midden = vuren + bommen (en starten/overslaan),
omhoog + omlaag tegelijk = schild, links + rechts tegelijk = nuke.
In CONFIG kies je of het spel naar alle controllers luistert of alleen naar één apparaatnummer.

## Opties
`node fuel-run-bridge.js --udp 6001 --port 6002`

Laat Windows Firewall de verbinding toe als daarom gevraagd wordt (privénetwerk), anders komen de
UDP-berichten en de telefoon niet binnen.
