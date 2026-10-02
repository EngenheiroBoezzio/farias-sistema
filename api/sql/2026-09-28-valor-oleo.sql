-- ===========================================================
-- 2026-09-28 — o valor do óleo na ordem de serviço
--
-- A ordem já gravava quanto foi cobrado por cada filtro, mas o óleo —
-- que costuma ser o item mais caro da conta — não tinha campo. Ele
-- desaparecia dentro do total, junto com a mão de obra, e não havia
-- como saber depois quanto daquela ordem foi óleo.
--
-- Rode como usuário ADMINISTRADOR do banco. O usuário da API não tem
-- permissão de DDL, de propósito.
--
--   mariadb -u root -p farias < sql/2026-09-28-valor-oleo.sql
--
-- Roda quantas vezes quiser: ADD COLUMN IF NOT EXISTS.
-- As ordens antigas ficam com NULL, que é a verdade — ninguém anotou
-- esse valor na época, e preencher com zero seria inventar que o óleo
-- saiu de graça.
-- ===========================================================
SET NAMES utf8mb4;

ALTER TABLE servicos
  ADD COLUMN IF NOT EXISTS valor_oleo DECIMAL(8,2) NULL
    COMMENT 'quanto foi cobrado pelo óleo' AFTER litros;
