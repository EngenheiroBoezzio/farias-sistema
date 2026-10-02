-- ===========================================================
-- Farias Troca de Óleo — esquema MariaDB
-- Regra que guia o desenho: o que é LIDO a toda hora fica pronto
-- na linha; o que é calculado raramente, calcula na hora.
-- ===========================================================
SET NAMES utf8mb4;

-- Sem CREATE DATABASE/USE aqui de propósito: as tabelas nascem no banco para
-- o qual você apontar o comando (mariadb <nome> < schema.sql). Com o nome
-- fixo no arquivo, quem usasse outro DB_NAME criava as tabelas no banco
-- errado sem receber nenhum aviso.

-- ---------- usuários ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(40)  NOT NULL,
  senha_hash    VARCHAR(100) NOT NULL,           -- bcrypt, 12 rounds
  nome          VARCHAR(80)  NOT NULL,
  papel         ENUM('admin','atendente') NOT NULL DEFAULT 'atendente',
  token_version INT UNSIGNED NOT NULL DEFAULT 0, -- logout revoga de verdade
  ativo         TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB;

-- ---------- clientes ----------
CREATE TABLE IF NOT EXISTS clientes (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome          VARCHAR(120) NOT NULL,
  telefone      VARCHAR(13)  NULL,               -- 5555999999999, já normalizado
  tel_inferido  TINYINT(1)   NOT NULL DEFAULT 0, -- DDD deduzido: confira no balcão
  nascimento    DATE         NULL,
  aceita_aviso  TINYINT(1)   NOT NULL DEFAULT 1, -- opt-in (LGPD)
  obs           VARCHAR(255) NULL,
  criado_em     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- colunas geradas: o MariaDB não indexa expressão direto, mas indexa estas.
  -- É o que faz "aniversariantes de hoje" sair por índice em vez de varredura.
  nasc_mes      TINYINT UNSIGNED AS (MONTH(nascimento)) VIRTUAL,
  nasc_dia      TINYINT UNSIGNED AS (DAY(nascimento))   VIRTUAL,
  KEY ix_nome (nome),
  KEY ix_telefone (telefone),
  KEY ix_nasc_mes_dia (nasc_mes, nasc_dia)
) ENGINE=InnoDB;

-- ---------- veículos ----------
-- ultima_troca / ultimo_km / situacao são DESNORMALIZADOS de propósito:
-- são lidos em toda listagem, e refazer esse GROUP BY a cada consulta
-- é o que faria a tela parecer lenta.
CREATE TABLE IF NOT EXISTS veiculos (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id   INT UNSIGNED NOT NULL,
  placa        VARCHAR(8)   NOT NULL,
  modelo       VARCHAR(80)  NULL,
  marca        VARCHAR(40)  NULL,
  cilindrada   VARCHAR(4)   NULL,                -- "1.0", "1.6"
  ano          SMALLINT     NULL,
  ultima_troca DATE         NULL,
  ultimo_km    INT UNSIGNED NULL,
  ultimo_oleo  VARCHAR(30)  NULL,
  visitas      INT UNSIGNED NOT NULL DEFAULT 0,
  situacao     ENUM('em_dia','vencido','parado','frio') NULL,
  criado_em    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_placa (placa),
  KEY ix_cliente (cliente_id),
  KEY ix_situacao_troca (situacao, ultima_troca),
  KEY ix_modelo (modelo),
  CONSTRAINT fk_veic_cli FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- serviços ----------
CREATE TABLE IF NOT EXISTS servicos (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  veiculo_id    INT UNSIGNED NOT NULL,
  cliente_id    INT UNSIGNED NOT NULL,
  data          DATE         NOT NULL,
  km            INT UNSIGNED NULL,
  oleo          VARCHAR(30)  NULL,
  -- (5,2) e não (4,1): o catálogo tem aplicações de 4,25 L e 3,75 L, e com
  -- uma casa decimal a ordem gravava 4,3 — um quarto de litro de óleo somia.
  litros        DECIMAL(5,2) NULL,
  -- Preço e código são coisas diferentes e têm coluna própria. Na planilha
  -- vinham no mesmo campo ("100,00 WOE506"), e o nome "filtro_oleo" colidia
  -- com veiculos.filtro_oleo, que guarda código de peça.
  valor_filtro_oleo DECIMAL(8,2) NULL,   -- quanto foi cobrado
  valor_filtro_ar   DECIMAL(8,2) NULL,
  cod_filtro_oleo   VARCHAR(30)  NULL,   -- qual peça entrou
  cod_filtro_ar     VARCHAR(30)  NULL,
  cod_filtro_cabine VARCHAR(30)  NULL,
  cod_filtro_combustivel VARCHAR(30) NULL,
  -- texto original da planilha, guardado para conferência; a API não grava aqui
  bruto_filtro_oleo VARCHAR(60)  NULL,
  bruto_filtro_ar   VARCHAR(60)  NULL,
  extras_bruto      VARCHAR(60)  NULL,
  total         DECIMAL(10,2) NULL,
  usuario_id    INT UNSIGNED NULL,
  criado_em     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_veiculo_data (veiculo_id, data DESC),
  KEY ix_data (data),
  KEY ix_cliente (cliente_id),
  CONSTRAINT fk_serv_veic FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE CASCADE,
  CONSTRAINT fk_serv_cli  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- itens extras da ordem ----------
-- A planilha usava a coluna "F.CABINE" como campo livre: anel, fluido, palheta,
-- mão de obra, lâmpada. São R$ 105 mil de receita que ninguém conseguia somar.
-- Aqui cada item vira uma linha com valor próprio.
CREATE TABLE IF NOT EXISTS itens_servico (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  servico_id INT UNSIGNED NOT NULL,
  descricao  VARCHAR(60)  NOT NULL,
  valor      DECIMAL(10,2) NULL,
  origem     ENUM('planilha','sistema') NOT NULL DEFAULT 'sistema',
  KEY ix_servico (servico_id),
  KEY ix_descricao (descricao),
  CONSTRAINT fk_item_serv FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- catálogo de óleo (dos PDFs dos fabricantes) ----------
CREATE TABLE IF NOT EXISTS catalogo_oleo (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fonte        VARCHAR(20)  NOT NULL,
  marca        VARCHAR(40)  NULL,
  modelo       VARCHAR(80)  NOT NULL,
  motor        VARCHAR(80)  NULL,
  cilindrada   VARCHAR(4)   NULL,
  ano_ini      SMALLINT     NULL,
  ano_fim      SMALLINT     NULL,
  litros       DECIMAL(5,2) NULL,
  viscosidades VARCHAR(80)  NOT NULL,            -- "5W-30,10W-30"
  KEY ix_modelo_cil (modelo, cilindrada),
  KEY ix_anos (ano_ini, ano_fim)
) ENGINE=InnoDB;

-- ---------- cache de consulta de placa ----------
-- cada placa é consultada UMA vez na vida; depois sai daqui.
CREATE TABLE IF NOT EXISTS cache_placa (
  placa         VARCHAR(8) PRIMARY KEY,
  marca         VARCHAR(40) NULL,
  modelo        VARCHAR(80) NULL,
  versao        VARCHAR(80) NULL,
  cilindrada    VARCHAR(4)  NULL,
  ano           SMALLINT    NULL,
  combustivel   VARCHAR(40) NULL,
  bruto         JSON        NULL,
  consultado_em TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------- avisos enviados (para não repetir contato) ----------
CREATE TABLE IF NOT EXISTS avisos (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  veiculo_id INT UNSIGNED NOT NULL,
  tipo       ENUM('vencido','aniversario','campanha') NOT NULL,
  enviado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_id INT UNSIGNED NULL,
  desfecho   ENUM('sem_resposta','respondeu','voltou','pediu_sair') NULL,
  KEY ix_veic_tipo (veiculo_id, tipo, enviado_em),
  CONSTRAINT fk_aviso_veic FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Índice que cobre a ordenação da lista de serviços.
-- Sem ele o otimizador começa pela tabela de clientes e cai em filesort.
ALTER TABLE servicos ADD KEY IF NOT EXISTS ix_data_id (data DESC, id DESC);

-- ---------- registro de backups ----------
-- Guarda o que aconteceu em cada rodada. Sem isso, "o backup roda" é fé,
-- não informação: ninguém percebe quando para de rodar.
CREATE TABLE IF NOT EXISTS backups (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  arquivo       VARCHAR(160) NOT NULL,
  tipo          ENUM('horario','diario','mensal') NOT NULL DEFAULT 'horario',
  iniciado_em   DATETIME     NOT NULL,
  duracao_ms    INT UNSIGNED NULL,
  bytes         BIGINT UNSIGNED NULL,
  sha256        CHAR(64)     NULL,
  linhas_origem JSON         NULL,   -- contagem no banco real
  linhas_restauro JSON       NULL,   -- contagem depois de restaurar a cópia
  verificado    TINYINT(1)   NOT NULL DEFAULT 0,
  status        ENUM('ok','divergente','falhou') NOT NULL,
  erro          TEXT         NULL,
  KEY ix_quando (iniciado_em DESC),
  KEY ix_status (status, iniciado_em DESC)
) ENGINE=InnoDB;

-- ---------- notificações do sistema ----------
CREATE TABLE IF NOT EXISTS notificacoes (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nivel      ENUM('ok','aviso','erro') NOT NULL DEFAULT 'ok',
  titulo     VARCHAR(120) NOT NULL,
  detalhe    VARCHAR(400) NULL,
  origem     VARCHAR(40)  NOT NULL DEFAULT 'sistema',
  criada_em  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lida_em    DATETIME     NULL,
  lida_por   INT UNSIGNED NULL,
  KEY ix_nao_lidas (lida_em, criada_em DESC),
  KEY ix_criada (criada_em DESC)
) ENGINE=InnoDB;

-- ---------- filtros do veículo ----------
-- Preenchidos UMA vez por carro: da segunda troca em diante o sistema já sabe
-- qual peça vai. Na planilha isso se perdia a cada linha.
ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS filtro_oleo   VARCHAR(40) NULL COMMENT 'código do filtro de óleo',
  ADD COLUMN IF NOT EXISTS filtro_ar     VARCHAR(40) NULL COMMENT 'código do filtro de ar',
  ADD COLUMN IF NOT EXISTS filtro_cabine VARCHAR(40) NULL COMMENT 'código do filtro de cabine',
  -- Faltava aqui, e o código usa em dez lugares (consulta de placa, ficha do
  -- veículo, fila de filtros, catálogo Wega). O banco de produção tem a
  -- coluna — ela entrou por fora em algum momento — mas o schema.sql não a
  -- criava, então instalação nova quebrava na primeira consulta de placa, e
  -- restaurar um backup reaplicando o schema deixaria o mesmo buraco.
  ADD COLUMN IF NOT EXISTS filtro_combustivel VARCHAR(40) NULL COMMENT 'código do filtro de combustível',
  ADD COLUMN IF NOT EXISTS filtros_por   VARCHAR(40) NULL COMMENT 'quem confirmou',
  ADD COLUMN IF NOT EXISTS filtros_em    DATETIME    NULL,
  ADD COLUMN IF NOT EXISTS obs           VARCHAR(255) NULL;

-- índice para achar veículos sem filtro cadastrado (a fila de trabalho da Raíssa)
ALTER TABLE veiculos ADD KEY IF NOT EXISTS ix_sem_filtro (filtro_oleo, situacao);

-- ---------- configurações da loja ----------
-- Nome da loja e link do canal do WhatsApp. Moravam no pacote do aplicativo e
-- no localStorage de cada balcão, o que fazia dois computadores da mesma
-- oficina discordarem em silêncio. Aqui há uma versão só.
-- SOMENTE CHAVE PÚBLICA: qualquer atendente logado lê esta tabela. Segredo
-- (JWT_SECRET, senha do banco, chave de IA) fica no .env do servidor.
CREATE TABLE IF NOT EXISTS configuracoes (
  chave        VARCHAR(40)  NOT NULL PRIMARY KEY,
  valor        VARCHAR(400) NOT NULL DEFAULT '',
  alterado_em  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  alterado_por VARCHAR(40)  NULL COMMENT 'username de quem gravou por último'
) ENGINE=InnoDB;

INSERT IGNORE INTO configuracoes (chave, valor) VALUES
  ('nomeLoja',      'Farias Troca de Óleo'),
  ('canalWhatsapp', '');

-- ---------- valor do óleo na ordem ----------
-- A ordem gravava o valor de cada filtro, mas não o do óleo — que costuma ser
-- o item mais caro da conta. Ele sumia dentro do total, junto com a mão de
-- obra, e não dava para saber depois quanto daquela ordem foi óleo.
ALTER TABLE servicos
  ADD COLUMN IF NOT EXISTS valor_oleo DECIMAL(8,2) NULL
    COMMENT 'quanto foi cobrado pelo óleo' AFTER litros;

-- ---------- lista de preços da oficina ----------
-- Quanto custa comprar e quanto se costuma cobrar, por óleo e por filtro.
-- Nada disso existia: todo valor_* em `servicos` é o que foi COBRADO, e os
-- catálogos Wega e de óleo são de aplicação, sem preço.
CREATE TABLE IF NOT EXISTS precos_itens (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo           ENUM('oleo','filtro_oleo','filtro_ar','filtro_cabine','filtro_combustivel')
                 NOT NULL,
  chave          VARCHAR(40)  NOT NULL,
  descricao      VARCHAR(80)  NULL,
  -- óleo se compra por litro, filtro por peça: sem isso o custo de uma troca
  -- de 4 litros sairia igual ao de uma de 3,5
  unidade        ENUM('litro','peca') NOT NULL DEFAULT 'peca',
  custo          DECIMAL(8,2) NULL COMMENT 'quanto a oficina paga',
  venda          DECIMAL(8,2) NULL COMMENT 'quanto a oficina costuma cobrar',
  ativo          TINYINT(1)   NOT NULL DEFAULT 1,
  atualizado_em  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  atualizado_por VARCHAR(40)  NULL,
  UNIQUE KEY uk_tipo_chave (tipo, chave),
  KEY ix_tipo (tipo, ativo)
) ENGINE=InnoDB;

-- ---------- valores e custos dos quatro filtros na ordem ----------
-- O custo e COPIADO para dentro da ordem no dia em que ela e lancada. Lido da
-- tabela na hora do relatorio, o fornecedor subir o oleo em novembro mudaria
-- a margem de todas as ordens de marco. O passado tem que ficar parado.
ALTER TABLE servicos
  ADD COLUMN IF NOT EXISTS valor_filtro_cabine      DECIMAL(8,2) NULL,
  ADD COLUMN IF NOT EXISTS valor_filtro_combustivel DECIMAL(8,2) NULL,
  ADD COLUMN IF NOT EXISTS custo_oleo               DECIMAL(8,2) NULL
    COMMENT 'custo do óleo nesta ordem (custo por litro x litros), copiado no dia',
  ADD COLUMN IF NOT EXISTS custo_filtro_oleo        DECIMAL(8,2) NULL,
  ADD COLUMN IF NOT EXISTS custo_filtro_ar          DECIMAL(8,2) NULL,
  ADD COLUMN IF NOT EXISTS custo_filtro_cabine      DECIMAL(8,2) NULL,
  ADD COLUMN IF NOT EXISTS custo_filtro_combustivel DECIMAL(8,2) NULL;

ALTER TABLE servicos ADD KEY IF NOT EXISTS ix_data_custo (data, custo_oleo);
