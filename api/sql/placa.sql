/* Campos que a consulta de placa traz e vale a pena guardar.

   A resposta do serviço traz, além de marca/modelo, um bloco `fipe` com o
   modelo ESPECÍFICO ("CROSSFOX 1.6 Mi Total Flex 8V 5p") — que é o que
   identifica a motorização de verdade. Guardar isso separado do modelo curto
   é o que faz o catálogo de filtros acertar. */

ALTER TABLE cache_placa
  ADD COLUMN IF NOT EXISTS fipe_codigo  VARCHAR(12)  NULL AFTER combustivel,
  ADD COLUMN IF NOT EXISTS fipe_modelo  VARCHAR(120) NULL AFTER fipe_codigo,
  ADD COLUMN IF NOT EXISTS fipe_valor   DECIMAL(12,2) NULL AFTER fipe_modelo,
  ADD COLUMN IF NOT EXISTS fipe_score   SMALLINT     NULL AFTER fipe_valor,
  ADD COLUMN IF NOT EXISTS logo_marca   VARCHAR(200) NULL AFTER fipe_score;

/* O mesmo no veículo: o que a loja confirmou fica aqui. */
ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS versao      VARCHAR(120) NULL AFTER modelo,
  ADD COLUMN IF NOT EXISTS fipe_codigo VARCHAR(12)  NULL AFTER ano,
  ADD COLUMN IF NOT EXISTS combustivel VARCHAR(20)  NULL AFTER fipe_codigo;

ALTER TABLE veiculos ADD KEY IF NOT EXISTS ix_fipe (fipe_codigo);
