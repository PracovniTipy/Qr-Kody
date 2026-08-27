-- StulHraje - Flaska: snizeni maximalniho poctu hracu u jednoho stolu z 16 na 10
-- (na jeden stul realisticky nesedi vic lidi, a emoji paleta ma 12 znaku, takze
-- do 10 hracu je porad kazdy odlisitelny bez opakovani).
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
  if jsonb_array_length(v_players) >= 10 then
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
