-- ===========================================================
-- 2026-09-29 — custo do óleo e dos filtros
--
-- O QUE NÃO EXISTIA: nada no banco guardava quanto a oficina PAGA por um
-- óleo ou por um filtro. Toda coluna `valor_*` em `servicos` é quanto foi
-- COBRADO do cliente. Os catálogos Wega e de óleo são de aplicação — dizem
-- qual peça serve em qual carro — e não têm preço nenhum. Por isso o
-- Financeiro avisa, em amarelo, que a sobra mostrada é maior que a real.
--
-- Duas coisas entram aqui:
--
--  1. `precos_itens` — a lista que a oficina mantém: para cada óleo e cada
--     filtro, quanto custa comprar e quanto se costuma cobrar.
--
--  2. Colunas de CUSTO em `servicos`. E isto é o ponto que não pode ser
--     cortado: o custo é copiado para dentro da ordem no dia em que ela é
--     lançada. Se o custo fosse lido da tabela na hora de montar o relatório,
--     o fornecedor subir o preço do óleo em novembro mudaria a margem de
--     todas as ordens de março. O passado tem que ficar parado.
--
-- Rode como usuário ADMINISTRADOR do banco. O usuário da API não tem
-- permissão de DDL, de propósito.
--
--   mariadb -u root -p farias < sql/2026-09-29-custos.sql
--
-- Roda quantas vezes quiser: IF NOT EXISTS em tudo.
-- ===========================================================
SET NAMES utf8mb4;

-- ---------- a lista de preços da oficina ----------
CREATE TABLE IF NOT EXISTS precos_itens (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo           ENUM('oleo','filtro_oleo','filtro_ar','filtro_cabine','filtro_combustivel')
                 NOT NULL,
  -- para óleo: a viscosidade/marca como o balcão digita ("5W30 MOB").
  -- para filtro: o código da peça ("WO170"). É por esta chave que a ordem
  -- encontra o item, então ela é guardada SEMPRE em maiúscula — o balcão
  -- digita de um jeito hoje e de outro amanhã.
  chave          VARCHAR(40)  NOT NULL,
  descricao      VARCHAR(80)  NULL,
  -- Óleo se compra por litro e filtro por peça. Sem esta distinção o custo
  -- de uma troca de 4 litros sairia igual ao de uma de 3,5 — e a margem do
  -- óleo, que é o item mais caro da ordem, seria a mais errada de todas.
  unidade        ENUM('litro','peca') NOT NULL DEFAULT 'peca',
  custo          DECIMAL(8,2) NULL COMMENT 'quanto a oficina paga',
  venda          DECIMAL(8,2) NULL COMMENT 'quanto a oficina costuma cobrar',
  ativo          TINYINT(1)   NOT NULL DEFAULT 1,
  atualizado_em  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  atualizado_por VARCHAR(40)  NULL,
  UNIQUE KEY uk_tipo_chave (tipo, chave),
  KEY ix_tipo (tipo, ativo)
) ENGINE=InnoDB;

-- ---------- o que a ordem passa a guardar ----------
ALTER TABLE servicos
  -- faltavam os dois: a ordem cobrava cabine e combustível e não tinha onde
  -- anotar quanto
  ADD COLUMN IF NOT EXISTS valor_filtro_cabine      DECIMAL(8,2) NULL
    COMMENT 'quanto foi cobrado pelo filtro de cabine',
  ADD COLUMN IF NOT EXISTS valor_filtro_combustivel DECIMAL(8,2) NULL
    COMMENT 'quanto foi cobrado pelo filtro de combustível',
  -- a cópia do custo no dia da ordem
  ADD COLUMN IF NOT EXISTS custo_oleo               DECIMAL(8,2) NULL
    COMMENT 'custo do óleo nesta ordem (custo por litro x litros), copiado no dia',
  ADD COLUMN IF NOT EXISTS custo_filtro_oleo        DECIMAL(8,2) NULL,
  ADD COLUMN IF NOT EXISTS custo_filtro_ar          DECIMAL(8,2) NULL,
  ADD COLUMN IF NOT EXISTS custo_filtro_cabine      DECIMAL(8,2) NULL,
  ADD COLUMN IF NOT EXISTS custo_filtro_combustivel DECIMAL(8,2) NULL;

-- Relatório de margem por período: lê data e as colunas de custo em sequência.
ALTER TABLE servicos ADD KEY IF NOT EXISTS ix_data_custo (data, custo_oleo);
