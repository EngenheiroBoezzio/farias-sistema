-- ===========================================================
-- 2026-09-26 — configurações da loja no banco
--
-- Até aqui o nome da loja e o link do canal do WhatsApp viviam no pacote do
-- aplicativo e no localStorage de cada computador. O efeito: a Raíssa trocava
-- o link no balcão da frente e o balcão de trás continuava com o antigo, sem
-- ninguém perceber. Isto passa as duas coisas para o banco, onde só existe
-- uma versão da verdade.
--
-- Rode como usuário ADMINISTRADOR do banco. O usuário da API não tem (e não
-- deve ter) permissão de DDL: se um dia uma falha permitir injeção, o estrago
-- para no DELETE e não chega no CREATE/DROP.
--
--   mariadb -u root -p farias < sql/2026-09-26-configuracoes.sql
--
-- Roda quantas vezes quiser: IF NOT EXISTS na tabela e INSERT IGNORE nas
-- linhas iniciais. Não sobrescreve valor já gravado.
-- ===========================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS configuracoes (
  chave        VARCHAR(40)  NOT NULL PRIMARY KEY,
  valor        VARCHAR(400) NOT NULL DEFAULT '',
  alterado_em  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  alterado_por VARCHAR(40)  NULL COMMENT 'username de quem gravou por último'
) ENGINE=InnoDB;

-- Só chave pública entra aqui. Segredo (JWT_SECRET, senha do banco, chave de
-- IA) continua no .env do servidor: esta tabela é lida por qualquer atendente
-- logado, e o dia em que alguém guardar uma chave de API nela, ela vaza.
INSERT IGNORE INTO configuracoes (chave, valor) VALUES
  ('nomeLoja',      'Farias Troca de Óleo'),
  ('canalWhatsapp', '');
