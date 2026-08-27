-- StulHraje - Etapa 4 (rozsireni): "Flaska" (klasicka spolecenska hra
-- "otoc lahev" pro cely stul, ne jen pro dva hrace jako Prsi/Poker/Dama/Sachy).
-- Kdokoliv u stolu se pripoji jako hrac (jmeno + tajny token), a kdokoliv
-- pripojeny muze zatocit "lahvi" - server nahodne vybere jednoho hrace jako
-- cil (muze padnout i na toho, kdo tocil) a nahodnou kartu z banku otazek
-- ("Pravda") a ukolu ("Ukol"). Cely stav (kdo hraje, posledni tocenka) je
-- verejny (flaska_sessions) - stejne jako u Damy/Sachu tu neni zadna skryta
-- informace, ktera by se soupeřum tajila, protoze hra neni soutezni.
--
-- Bezpecnostni navrh je stejny jako u ostatnich her: flaska_private (bez RLS
-- politik = nedostupna pres anon/authenticated) drzi tajne tokeny hracu, at
-- si nikdo nepripise cizi "identitu" a netoci lahvi za nekoho jineho.
-- flaska_sessions.players drzi jen verejne udaje (jmeno, emoji, verejne id).
--
-- Na rozdil od 1v1 her tu neni zadny "waiting"/"playing" zivotni cyklus -
-- jedna hra na stole zije cely vecer (8 hodin) a kdokoli se muze kdykoliv
-- pripojit i uprostred hrani, presne jak by to fungovalo s realnou lahvi na
-- stole.

create table flaska_sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  players jsonb not null default '[]'::jsonb,
  used_cards jsonb not null default '[]'::jsonb,
  last_spin jsonb,
  spin_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index flaska_sessions_table_idx on flaska_sessions (table_id, created_at desc);

create table flaska_private (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references flaska_sessions(id) on delete cascade,
  player_id uuid not null,
  player_token uuid not null default gen_random_uuid()
);

create index flaska_private_session_idx on flaska_private (session_id);
create unique index flaska_private_token_idx on flaska_private (session_id, player_token);

alter table flaska_sessions enable row level security;
alter table flaska_private enable row level security;

create policy flaska_sessions_select_public on flaska_sessions for select using (true);
-- flaska_private zamerne bez policy => zadny pristup pres anon/authenticated.

alter publication supabase_realtime add table flaska_sessions;

-- Pevna banka karet: kazda je {"c": "pravda"|"ukol", "t": "text"}. Zamerne
-- bez alkoholovych "vypij" ukolu - hra ma bavit spolecnost u stolu, ne tlacit
-- do pití. Vraceno jako jsonb pole, indexovane 0..n-1 (pouziva se pro
-- used_cards, at hra nejdriv projede cely balicek nez se karty zacnou
-- opakovat).
create or replace function flaska_card_bank()
returns jsonb
language sql
immutable
as $function$
  select '[
    {"c":"pravda","t":"Jaký je tvůj nejtrapnější zážitek z rande?"},
    {"c":"pravda","t":"Kterou písničku bys nikdy nepřiznal/a, že máš rád/a?"},
    {"c":"pravda","t":"Jaká je tvoje nejděsivější fobie?"},
    {"c":"pravda","t":"Co je nejbláznivější věc, kterou jsi kdy udělal/a kvůli lásce?"},
    {"c":"pravda","t":"Jaká byla tvoje nejtrapnější dětská přezdívka?"},
    {"c":"pravda","t":"Kdybys mohl/a být na jeden den kýmkoli, kým bys byl/a?"},
    {"c":"pravda","t":"Jaký je tvůj nejtrapnější moment na veřejnosti?"},
    {"c":"pravda","t":"Co je věc, kterou bys nikdy nepřiznal/a svým rodičům?"},
    {"c":"pravda","t":"Jaké je tvoje tajné povolání snů?"},
    {"c":"pravda","t":"Kdy jsi naposledy lhal/a a proč?"},
    {"c":"pravda","t":"Jaká je nejhorší rada, kterou jsi kdy dostal/a?"},
    {"c":"pravda","t":"Co si upřímně myslíš o osobě po tvé levici?"},
    {"c":"pravda","t":"Jaký je tvůj nejděsivější sen, který si pamatuješ?"},
    {"c":"pravda","t":"Kolikrát jsi dnes zkontroloval/a telefon?"},
    {"c":"pravda","t":"Jaké bylo tvé nejtrapnější dětské trauma z lásky?"},
    {"c":"pravda","t":"Co je nejtrapnější, co ti kdy vypadlo z pusy?"},
    {"c":"pravda","t":"Kdo je tvá tajná celebrity láska?"},
    {"c":"pravda","t":"Jaký byl tvůj nejhorší outfit, který sis kdy oblékl/a?"},
    {"c":"pravda","t":"Co je věc, kterou předstíráš, že umíš, ale neumíš?"},
    {"c":"pravda","t":"Jaká je nejtrapnější věc, na kterou sis kdy hledal/a odpověď na internetu?"},
    {"c":"pravda","t":"Kdy ses naposledy opravdu trapně zesměšnil/a?"},
    {"c":"pravda","t":"Jaké zvíře nejvíc připomínáš povahou a proč?"},
    {"c":"pravda","t":"Jaká je tvá nejnesmyslnější noční můra?"},
    {"c":"pravda","t":"Jaký je tvůj guilty pleasure seriál nebo film?"},
    {"c":"pravda","t":"Co bys udělal/a, kdybys dnes večer vyhrál/a v loterii?"},
    {"c":"pravda","t":"Jaká je nejdivnější věc, kterou jsi kdy jedl/a?"},
    {"c":"pravda","t":"Kdo z přítomných by podle tebe přežil zombie apokalypsu nejdéle?"},
    {"c":"pravda","t":"Jaké je tvoje nejtrapnější rande, na které si vzpomeneš?"},
    {"c":"pravda","t":"Co je nejhorší dárek, který jsi kdy dostal/a?"},
    {"c":"pravda","t":"Kdybys musel/a hned teď zazpívat karaoke, jakou písničku by sis vybral/a?"},
    {"c":"ukol","t":"Zazpívej první sloku libovolné písničky nahlas."},
    {"c":"ukol","t":"Předveď svůj nejlepší tanec vsedě."},
    {"c":"ukol","t":"Mluv dalších 5 minut s přehnaným zahraničním přízvukem."},
    {"c":"ukol","t":"Napodob zvíře podle výběru souseda, dokud to neuhodne."},
    {"c":"ukol","t":"Vymysli básničku o osobě po tvé pravici."},
    {"c":"ukol","t":"Předveď, jak vypadáš, když se ráno probouzíš."},
    {"c":"ukol","t":"Zahraj beze slov svou oblíbenou pohádkovou postavu."},
    {"c":"ukol","t":"Řekni alespoň 3 komplimenty osobě naproti tobě."},
    {"c":"ukol","t":"Předstírej telefonát s mimozemšťanem."},
    {"c":"ukol","t":"Vymysli na místě rým na jméno souseda."},
    {"c":"ukol","t":"Předveď imitaci slavné osobnosti, ať ji ostatní uhodnou."},
    {"c":"ukol","t":"Vyprávěj krátký vtip - pokud se nikdo nezasměje, dáš ještě jeden."},
    {"c":"ukol","t":"Zatanči \"robota\" po dobu 10 sekund."},
    {"c":"ukol","t":"Vymysli přezdívku pro každého u stolu."},
    {"c":"ukol","t":"Předveď pantomimou své ráno od budíku po odchod z domu."},
    {"c":"ukol","t":"Zahraj scénku, jako bys byl/a moderátor večerních zpráv."},
    {"c":"ukol","t":"Řekni abecedu pozpátku tak rychle, jak dokážeš."},
    {"c":"ukol","t":"Předveď, jak by tančil robot v dešti."},
    {"c":"ukol","t":"Napodobuj hlas oblíbené filmové postavy po zbytek kola."},
    {"c":"ukol","t":"Vymysli reklamní slogan na věc, na kterou ukáže soused."},
    {"c":"ukol","t":"Zahraj si se sousedem \"kámen, nůžky, papír\" - poražený zavrní jako kotě."},
    {"c":"ukol","t":"Předveď selfie pózu, jako bys byl/a slavná celebrita."},
    {"c":"ukol","t":"Zazpívej \"Happy Birthday\", jako by to zpívala operní diva."},
    {"c":"ukol","t":"Vymysli si nový taneční pohyb a pojmenuj ho."},
    {"c":"ukol","t":"Přednes krátký monolog o tom, proč jsou brambory skvělé."},
    {"c":"ukol","t":"Předveď, jak chodí modelka po molu, kolem stolu."},
    {"c":"ukol","t":"Zahraj si \"sochy\" - zůstaň v pozici, dokud někdo neřekne \"stop\"."},
    {"c":"ukol","t":"Zkus rozesmát souseda beze slov a bez doteku, máš 20 sekund."},
    {"c":"ukol","t":"Popiš svůj dnešní den jako sportovní komentátor."},
    {"c":"ukol","t":"Předveď svou nejlepší \"power pose\" po dobu 10 sekund."}
  ]'::jsonb;
$function$;

-- Emoji pro hrace, prirazuji se podle poradi pripojeni (deterministicky, at
-- se stejny hrac po znovunacteni "nepromenuje").
create or replace function flaska_emoji_for_index(p_idx integer)
returns text
language sql
immutable
as $function$
  select (array['🦊','🐻','🐼','🐨','🐯','🦁','🐸','🐵','🐶','🐱','🐰','🐷'])[(p_idx % 12) + 1];
$function$;

-- Najde existujici hru na danem stole zalozenou v poslednich 8 hodinach
-- (typicka delka jednoho vecera), jinak novou hru zalozi. Vraci jen session_id
-- - hrac se pak jeste musi pripojit pres flaska_join, at dostane svuj token.
create or replace function flaska_get_or_create_session(p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session flaska_sessions%rowtype;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  select * into v_session
  from flaska_sessions
  where table_id = v_table.id and created_at > now() - interval '8 hours'
  order by created_at desc
  limit 1;

  if not found then
    insert into flaska_sessions (venue_id, table_id)
    values (v_table.venue_id, v_table.id)
    returning * into v_session;
  end if;

  return json_build_object('session_id', v_session.id);
end;
$function$;

-- Pripoji noveho hrace ke hre (jmeno zvoli hrac sam). Vraci verejne id,
-- tajny token (ulozi se jen na klientovi) a prirazene emoji.
create or replace function flaska_join(p_session_id uuid, p_qr_token text, p_name text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session flaska_sessions%rowtype;
  v_player_id uuid := gen_random_uuid();
  v_player_token uuid := gen_random_uuid();
  v_name text := nullif(trim(both from coalesce(p_name, '')), '');
  v_players jsonb;
  v_emoji text;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid_table');
  end if;

  if v_name is null then
    return json_build_object('ok', false, 'reason', 'invalid_name');
  end if;
  v_name := left(v_name, 24);

  select * into v_session from flaska_sessions where id = p_session_id and table_id = v_table.id for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  v_players := v_session.players;
  if jsonb_array_length(v_players) >= 16 then
    return json_build_object('ok', false, 'reason', 'full');
  end if;

  v_emoji := flaska_emoji_for_index(jsonb_array_length(v_players));

  v_players := v_players || jsonb_build_array(
    jsonb_build_object('id', v_player_id, 'name', v_name, 'emoji', v_emoji)
  );

  update flaska_sessions set players = v_players, updated_at = now() where id = p_session_id;

  insert into flaska_private (session_id, player_id, player_token)
  values (p_session_id, v_player_id, v_player_token);

  return json_build_object(
    'ok', true,
    'player_id', v_player_id,
    'player_token', v_player_token,
    'name', v_name,
    'emoji', v_emoji
  );
end;
$function$;

-- Zatoceni "lahvi": nahodne vybere jednoho z pripojenych hracu jako cil
-- (klidne i toho, kdo tocil - presne jako u skutecne lahve) a nahodnou
-- kartu z banku, ktera v teto hre jeste nepadla (jakmile dojdou vsechny,
-- balicek se automaticky "zamicha" znovu).
create or replace function flaska_spin(p_session_id uuid, p_player_token uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session flaska_sessions%rowtype;
  v_priv flaska_private%rowtype;
  v_players jsonb;
  v_player_count integer;
  v_target jsonb;
  v_spinner jsonb;
  v_bank jsonb := flaska_card_bank();
  v_bank_size integer := jsonb_array_length(flaska_card_bank());
  v_used jsonb;
  v_available integer[];
  v_idx integer;
  v_card jsonb;
  v_spin jsonb;
begin
  select * into v_session from flaska_sessions where id = p_session_id for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  select * into v_priv from flaska_private where session_id = p_session_id and player_token = p_player_token;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  select elem into v_spinner
  from jsonb_array_elements(v_session.players) elem
  where (elem->>'id')::uuid = v_priv.player_id;

  v_players := v_session.players;
  v_player_count := jsonb_array_length(v_players);
  if v_player_count < 1 then
    return json_build_object('ok', false, 'reason', 'no_players');
  end if;

  v_target := v_players -> (floor(random() * v_player_count)::integer);

  v_used := v_session.used_cards;
  select array_agg(x) into v_available
  from generate_series(0, v_bank_size - 1) x
  where not (v_used @> to_jsonb(x));

  if v_available is null or array_length(v_available, 1) is null then
    v_used := '[]'::jsonb;
    select array_agg(x) into v_available from generate_series(0, v_bank_size - 1) x;
  end if;

  v_idx := v_available[1 + floor(random() * array_length(v_available, 1))::integer];
  v_card := v_bank -> v_idx;
  v_used := v_used || to_jsonb(v_idx);

  v_spin := jsonb_build_object(
    'spinner_id', v_priv.player_id,
    'spinner_name', coalesce(v_spinner->>'name', '?'),
    'spinner_emoji', coalesce(v_spinner->>'emoji', '🦊'),
    'target_id', v_target->>'id',
    'target_name', coalesce(v_target->>'name', '?'),
    'target_emoji', coalesce(v_target->>'emoji', '🦊'),
    'category', v_card->>'c',
    'text', v_card->>'t',
    'at', now()
  );

  update flaska_sessions
  set used_cards = v_used,
      last_spin = v_spin,
      spin_count = spin_count + 1,
      updated_at = now()
  where id = p_session_id;

  return json_build_object('ok', true, 'spin', v_spin);
end;
$function$;
