-- StůlHraje – Etapa 2 (část): kuchyňská obrazovka pro personál
-- Navazuje na kapitolu 11 hlavního plánu. Čtení i změnu stavu objednávek už
-- personálu povoluje RLS z migrace 0005 (orders_select_staff, orders_update_staff)
-- – tahle migrace jen zapíná Supabase Realtime na tabulce orders, aby kuchyň
-- viděla nové objednávky a změny stavu okamžitě, bez ručního obnovování stránky.

alter publication supabase_realtime add table orders;
