-- StůlHraje – Etapa 1.1: test naskenování stolu (regenerace qr_token řeší
-- existující sloupec s výchozí hodnotou, nová migrace přidává jen značku testu).
alter table tables add column if not exists tested_at timestamptz;
