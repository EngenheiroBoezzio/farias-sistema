/* Separa PREÇO de CÓDIGO DE PEÇA nas ordens de serviço.

   A planilha da Farias usava as colunas "filtro_oleo"/"filtro_ar" para anotar
   quanto foi cobrado ("45", "50"), e às vezes o atendente digitava o código
   junto ("100,00 WOE506"). Com esse nome, a coluna colidia com
   veiculos.filtro_oleo, que guarda código de peça: mesmo nome, significado
   oposto, em tabelas diferentes — armadilha certa na hora de montar a tela.

   Depois desta migração:
     valor_filtro_*  -> quanto foi cobrado (DECIMAL, dá para somar)
     cod_filtro_*    -> qual peça entrou (quando o atendente anotou)
     extras_bruto    -> o campo livre de onde saíram os itens avulsos */

ALTER TABLE servicos
  ADD COLUMN IF NOT EXISTS valor_filtro_oleo  DECIMAL(8,2) NULL AFTER litros,
  ADD COLUMN IF NOT EXISTS valor_filtro_ar    DECIMAL(8,2) NULL AFTER valor_filtro_oleo,
  ADD COLUMN IF NOT EXISTS cod_filtro_oleo    VARCHAR(30)  NULL AFTER valor_filtro_ar,
  ADD COLUMN IF NOT EXISTS cod_filtro_ar      VARCHAR(30)  NULL AFTER cod_filtro_oleo,
  ADD COLUMN IF NOT EXISTS cod_filtro_cabine  VARCHAR(30)  NULL AFTER cod_filtro_ar,
  ADD COLUMN IF NOT EXISTS cod_filtro_combustivel VARCHAR(30) NULL AFTER cod_filtro_cabine;

/* consultas de faturamento por item */
ALTER TABLE servicos ADD KEY IF NOT EXISTS ix_data_valor (data, valor_filtro_oleo);
