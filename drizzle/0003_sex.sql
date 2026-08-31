-- Las curvas de crecimiento de la OMS son distintas para niño y niña, así que
-- la referencia de peso no se puede dibujar sin este dato. Nulo mientras no se
-- rellene: sin él, la gráfica se dibuja sin banda.
ALTER TABLE babies ADD COLUMN sex text;
