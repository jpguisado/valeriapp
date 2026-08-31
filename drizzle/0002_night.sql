-- Modo "A dormir": los minutos de rutina tras un evento antes de volver a
-- darla por dormida. Vive en el hogar porque los dos móviles tienen que
-- calcular los mismos tramos.
ALTER TABLE households ADD COLUMN settle_minutes integer NOT NULL DEFAULT 25;
