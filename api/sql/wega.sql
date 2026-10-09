/* Catálogo de filtros Wega — linha leve 2023/2024.
   Extraído do PDF oficial por coordenada de coluna (scripts/../wega/extrair.py).

   Guardamos a linha original do PDF em `linha_bruta`: catálogo de peça errado
   é peça errada no motor do cliente, então precisa haver como conferir de onde
   cada código saiu sem reabrir o PDF. */

CREATE TABLE IF NOT EXISTS catalogo_filtro (
  id                SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fonte             VARCHAR(20)  NOT NULL DEFAULT 'wega',
  marca             VARCHAR(40)  NOT NULL,
  modelo            VARCHAR(80)  NOT NULL,
  versao            VARCHAR(200) NULL,          -- "(Elegant) - gasolina - mecânico"
  combustivel_txt   VARCHAR(20)  NULL,          -- gasolina/diesel/flex, quando dá para ler
  ano_ini           SMALLINT     NULL,
  ano_fim           SMALLINT     NULL,          -- NULL = "em diante"
  f_ar              VARCHAR(30)  NULL,
  f_oleo            VARCHAR(30)  NULL,
  f_oleo_opc        VARCHAR(30)  NULL,
  f_combustivel     VARCHAR(30)  NULL,
  f_combustivel_opc VARCHAR(30)  NULL,
  f_cabine          VARCHAR(30)  NULL,
  f_cabine_carvao   VARCHAR(30)  NULL,
  posicao           VARCHAR(20)  NULL,
  pagina            SMALLINT     NULL,          -- página do PDF, para auditoria
  linha_bruta       VARCHAR(400) NULL,
  PRIMARY KEY (id),
  KEY ix_marca_modelo (marca, modelo),
  KEY ix_modelo (modelo),
  KEY ix_ano (ano_ini, ano_fim)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* O veículo guarda o que a loja CONFIRMOU. O catálogo só sugere.
   Combustível entrou agora porque a Wega lista esse filtro e, sem a coluna,
   a sugestão não teria onde ser confirmada. */
ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS filtro_combustivel VARCHAR(40) NULL AFTER filtro_cabine;

-- Em servicos o código do filtro de combustível entra como cod_filtro_combustivel,
-- criado em valores.sql junto com os outros códigos.
