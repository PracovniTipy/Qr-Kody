# StůlHraje — Etapa 0 + Etapa 1 + Etapa 1.1 (částečně)

Technický základ (Etapa 0) podle kapitoly 14 hlavního plánu: React/TypeScript
PWA, napojení na Supabase, migrace pro hospody/uživatele/stoly/menu,
přihlášení administrátora a veřejná stránka stolu.

Etapa 1 přidává administraci hospody: úpravu základních údajů, správu stolů
s QR odkazy a správu kategorií/položek menu.

Etapa 1.1 (zatím část podle kapitoly 11 hlavního plánu) přidává tisk QR
stojánků a test naskenování/obnovu QR tokenu stolu. Průvodce založením
hospody a import menu z PDF/fotky ještě chybí.

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
  hospod, ke kterým máš přiřazenou roli (mělo by tam být "Hospoda U lípy").
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

- `/admin/hospoda/:venueId/tisk` — generátor tiskových QR stojánků pro
  všechny aktivní stoly (QR obrázek vygenerovaný na klientovi knihovnou
  `qrcode`, tisk přes `window.print()` s vlastním `@media print` stylem),
- obnova (zneplatnění) QR tokenu stolu tlačítkem "Nový QR" — starý odkaz
  přestane fungovat, číslo stolu zůstane stejné,
- ruční značka "Otestováno" pro potvrzení testovacího skenu stolu
  (sloupec `tables.tested_at`, migrace 0003).

Zbytek Etapy 1.1 (průvodce založením hospody, import menu z PDF/fotky přes
OCR/AI) zatím chybí — jde o samostatnou větší funkci, viz kapitola 6.2
hlavního plánu.

## 4) Co záměrně chybí (přijde v dalších etapách)

Průvodce založením hospody a import menu z PDF/fotky (zbytek Etapy 1.1).
Košík a odesílání objednávky, kuchyňská obrazovka, QR platba, tržby, hry — viz
kapitola 11 hlavního plánu (Etapa 2 a dál). Podle pravidel pro vývoj
(kapitola 13) se nemá programovat všechno najednou — tohle je záměrně jen
základ, na kterém se dá stavět.

## 5) Nasazení

Plán počítá s Cloudflare Pages/Workers (viz kapitola 8). Build příkaz:
`npm run build`, výstupní složka: `dist`. Proměnné `VITE_SUPABASE_URL` a
`VITE_SUPABASE_ANON_KEY` nastav v prostředí Cloudflare Pages, ne do repozitáře.
