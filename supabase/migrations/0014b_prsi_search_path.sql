-- Drobna oprava (0014b): explicitne nastavit search_path u pomocnych
-- funkci Prsi, ktere nejsou SECURITY DEFINER, ale pristupuji ke jmenam
-- tabulek/typu bez schema prefixu - stejny duvod jako u 0004b.

alter function prsi_new_shuffled_deck() set search_path to 'public';
alter function prsi_reshuffle_if_needed(prsi_private, jsonb) set search_path to 'public';
