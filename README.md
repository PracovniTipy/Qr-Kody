# StůlHraje — Etapa 0 + Etapa 1 + Etapa 1.1 + Etapa 2 + Etapa 4 (částečně)

Technický základ (Etapa 0) podle kapitoly 14 hlavního plánu: React/TypeScript
PWA, napojení na Supabase, migrace pro hospody/uživatele/stoly/menu,
přihlášení administrátora a veřejná stránka stolu.

Etapa 1 přidává administraci hospody: úpravu základních údajů, správu stolů
s QR odkazy a správu kategorií/položek menu.

Etapa 1.1 přidává průvodce založením hospody, tisk QR stojánků, test
naskenování/obnovu QR tokenu stolu a import menu z PDF/fotky přes AI
(Claude vision).

Etapa 2 (podle kapitoly 11 hlavního plánu) přidává košík, odeslání
objednávky ze stránky stolu, kuchyňskou obrazovku pro personál, QR platbu a
přehled tržeb.

Etapa 4 (zatím jen část) přidává první arkádovou hru pro hosty u stolu —
"Chytání padajících surovin" — se skóre, žebříčkem hospody a základní
ochranou proti podvádění. Zbylé hry z masterplánu (kapitola 7) na řadu
přijdou později, viz kapitola 11.

> Poznámka: kód je hotový a připravený, ale tenhle sandbox nemá přístup k npm
> registru, takže tady nešlo spustit `npm install` ani ověřit build. Než to
> pustíš, projdi si kroky níže na svém počítači nebo v GitHub repozitáři.

## 1) Supabase projekt

1. Založ projekt na [supabase.com](https://supabase.com) (free tier).
2. V **SQL editoru** spusť `supabase/migrations/0001_init_schema.sql`.
3. V **Authentication → Users** ručně založ jednoho uživatele (např.
   `majitel@test.stulhraje.cz`) — bude to majitel testovací hospody.
4. Zkopíruj jeho User UID, vlož ho do `supabase/seed/seed_test_venue.sql`
   místo `REPLACE_WITH_ADMIN_USER_UUID` a spusť ten skript v SQL editoru.
5. Skript na konci vypíše `qr_token` testovacího stolu — to je URL, kterou
   otevřeš na telefonu (viz níže).

## 2) Lokální spuštění

```bash
npm install
cp .env.example .env.local
# do .env.local dopiš VITE_SUPABASE_URL a VITE_SUPABASE_ANON_KEY
# (Supabase → Project Settings → API)
npm run dev
```

Aplikace poběží na `http://localhost:5173`.

- Admin: `http://localhost:5173/admin/login` — přihlas se e-mailem a heslem
  uživatele, kterého jsi založil v kroku 1.3. Po přihlášení uvidíš seznam
  hospod, ke kterým máš přiřazenou roli (mělo by tam být "Hospoda U lípy"),
  a formulář pro založení další hospody.
- Veřejná stránka stolu: `http://localhost:5173/v/u-lipy/t/<qr_token>` —
  token vezmi z výstupu seed skriptu.

## 3) Co je hotové (Etapa 0)

- databázové migrace pro `venues`, `venue_users`, `tables`, `menu_categories`,
  `menu_items`, včetně RLS pravidel, která oddělují data jednotlivých hospod,
- bezpečná DB funkce `get_table_context`, přes kterou host (bez přihlášení)
  dostane jen data své hospody a svého stolu — nikdy víc,
- přihlášení administrátora přes Supabase Auth,
- veřejná stránka stolu s testovacím menu,
- základní PWA nastavení (manifest, ikonky — ikony `public/icon-192.png` a
  `public/icon-512.png` zatím chybí, doplň je než budeš nasazovat naostro).

## 3b) Co je hotové (Etapa 1)

- `/admin/hospoda/:venueId` — úprava názvu/slugu/aktivity hospody (jen role
  MAJITEL/MANAZER, vynucuje RLS pravidlo `venues_update_manager`),
- správa stolů: přidání, deaktivace, smazání, QR odkaz ke zkopírování,
- správa kategorií a položek menu: přidání, úprava, skrytí, smazání.

## 3c) Co je hotové (Etapa 1.1 — část)

- průvodce založením hospody přímo z `/admin` — formulář (název + adresa)
  volá bezpečnou RPC funkci `create_venue_for_current_user` (migrace 0004),
  která atomicky založí hospodu a přihlášeného uživatele v ní rovnou udělá
  MAJITELEM (RLS na `venues`/`venue_users` záměrně nemá insert policy pro
  běžné uživatele, aby si nikdo nešel přiřadit roli k cizí hospodě),
- `/admin/hospoda/:venueId/tisk` — generátor tiskových QR stojánků pro
  všechny aktivní stoly (QR obrázek vygenerovaný na klientovi knihovnou
  `qrcode`, tisk přes `window.print()` s vlastním `@media print` stylem),
- obnova (zneplatnění) QR tokenu stolu tlačítkem "Nový QR" — starý odkaz
  přestane fungovat, číslo stolu zůstane stejné,
- ruční značka "Otestováno" pro potvrzení testovacího skenu stolu
  (sloupec `tables.tested_at`, migrace 0003).

Import menu z PDF/fotky přes AI (Claude vision, Edge Function `import-menu`)
je hotový — průvodce rozpozná položky a ceny z fotky/PDF, dají se ručně
zkontrolovat/upravit a teprve pak publikovat do menu hospody, viz kapitola
6.2 hlavního plánu.

## 3d) Co je hotové (Etapa 2 — část)

- veřejná stránka stolu má košík: krokový výběr množství u každé položky
  menu, lišta s počtem kusů a celkovou cenou dole na obrazovce,
- odeslání objednávky přes bezpečnou RPC funkci `submit_order` (migrace
  0005) — server podle `qr_token` ověří, že stůl i hospoda jsou aktivní, a
  že každá položka patří dané hospodě a je dostupná, teprve pak objednávku
  založí (stejný vzor jako `get_table_context`: host nikdy nemá přímý
  přístup k tabulkám `orders`/`order_items`),
- host po odeslání (i po refreshi stránky) vidí své poslední objednávky ze
  svého stolu a jejich stav (Přijato/Připravuje se/Hotovo/Zrušena) přes RPC
  funkci `get_table_orders`,
- `/admin/hospoda/:venueId/kuchyne` — kuchyňská obrazovka pro personál:
  přehled aktivních objednávek dané hospody (napříč stoly), tlačítka pro
  posun stavu (Přijato → Připravuje se → Hotovo) a zrušení. Čtení i zápis
  jde přímo přes Supabase klienta (chrání to RLS `orders_select_staff` /
  `orders_update_staff` z migrace 0005, žádná zvláštní RPC funkce tu není
  potřeba), nové objednávky a změny stavu se promítnou okamžitě přes
  Supabase Realtime (migrace 0006), s pravidelným obnovením jako zálohou.

3e) Co je hotové (Etapa 2 — QR platba)

- hospoda si v Nastavení hospody může nepovinně zadat svůj bankovní účet
  (IBAN) — pole `bank_account` (migrace 0007),
- pokud je účet vyplněný, host na stránce stolu vidí panel "K zaplacení"
  s částkou (součet nezaplacených objednávek) a QR kódem ve formátu český
  standard "QR Platba"/SPD (`SPD*1.0*ACC:...`) — naskenovatelný většinou
  bankovních appek, žádná platební brána ani API klíč není potřeba,
- personál na stránce Stoly a QR odkazy vidí u stolu s nezaplacenou útratou
  částku a tlačítko "Označit jako zaplaceno" — nastaví příznak `paid` u
  objednávek stolu (migrace 0007), čtení i zápis chrání existující RLS
  pravidla (`venues_update_manager`, `orders_update_staff`).

3f) Co je hotové (Etapa 2 — přehled tržeb)

- `/admin/hospoda/:venueId/trzby` — přehled tržeb pro personál/majitele:
  dnešní tržby a tržby za posledních 30 dní (souhrnné karty) a tabulka
  tržeb/počtu objednávek po dnech,
- počítá se ze zaplacených objednávek (`orders.paid = true`, viz QR platba
  výše) — čtení jde přímo přes Supabase klienta, chrání to stejné RLS
  pravidlo `orders_select_staff` jako kuchyňská obrazovka (migrace 0005),
  žádná nová migrace ani RPC funkce tu nebyla potřeba.

## 3g) Co je hotové (Etapa 4 — arkádová hra)

- `/v/:venueSlug/t/:tableToken/hra` — první arkádová hra "Chytání padajících
  surovin" (30 s, tažení košíku, chytání padajících surovin), přístupná
  odkazem "🎮 Hrát" ze stránky stolu,
- skóre a žebříček jdou přes bezpečné RPC funkce (`start_game_session`,
  `submit_game_score`, `get_game_leaderboard`, migrace 0008) — stejný vzor
  jako u objednávek: klient nikdy nezapisuje do `game_sessions`/`game_scores`
  přímo (RLS je zapnuté, ale bez policy pro anon/authenticated),
- základní ochrana proti podvádění (kapitola 9.1): server hlídá, že mezi
  začátkem a odesláním skóre uplynul realistický čas (20–600 s), že skóre
  nepřesahuje teoretické maximum pro danou hru a že jedna hraná session jde
  odeslat jen jednou — ověřeno i ručně přímým voláním RPC (moc rychlé
  odeslání, přehnané skóre i opakované odeslání stejné session server
  odmítne),
- hráčské účty zatím nejsou (kapitola 9, Etapa 9) — žebříček je anonymní,
  jen s dobrovolnou přezdívkou u skóre (max. 20 znaků).

## 4) Co záměrně chybí (přijde v dalších etapách)

Masterplán (kapitola 7) počítá s dalšími čtyřmi hrami se skóre (flappy-bird
styl, hospodský běh, skákání nahoru, "breakout"/arkanoid) a pěti stolními
hrami bez skóre (šachy, prší, dáma, flaška, poker) — podle kapitoly 11 na
řadu přijdou až po MVP, ne najednou. Dál chybí i vše ostatní z masterplánu:
partnerský program, turnaje, hráčské účty, vícejazyčné menu, hodnocení,
mapa podniků, předplatné a pilotní test (Etapa 5) u reálné hospody. Podle
pravidel pro vývoj (kapitola 13) se nemá programovat všechno najednou —
tohle je záměrně jen základ, na kterém se dá stavět.

## 5) Nasazení

Plán počítá s Cloudflare Pages/Workers (viz kapitola 8). Build příkaz:
`npm run build`, výstupní složka: `dist`. Proměnné `VITE_SUPABASE_URL` a
`VITE_SUPABASE_ANON_KEY` nastav v prostředí Cloudflare Pages, ne do repozitáře.
