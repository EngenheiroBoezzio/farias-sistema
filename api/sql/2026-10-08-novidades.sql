-- ===========================================================
-- Novidades — o "o que mudou" que a equipe vê no sino.
--
-- É coisa DIFERENTE de `notificacoes`: a notificação é um alerta que vem e vai
-- (o backup falhou, o backup voltou), e o "lida" dela é global. A novidade é
-- registro permanente de versão, e cada pessoa precisa ver o próprio aviso de
-- "tem coisa nova" — senão a Raíssa abrir num computador apagaria a bolinha
-- dos pais dela no outro. Por isso: tabela própria + carimbo por usuário.
--
-- Idempotente: pode rodar de novo sem erro.
-- ===========================================================

CREATE TABLE IF NOT EXISTS novidades (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  versao       VARCHAR(20)  NULL,                 -- "1.0.16", quando houver
  titulo       VARCHAR(140) NOT NULL,
  corpo        TEXT         NOT NULL,             -- o que mudou, uma linha por item
  a_pedido     TINYINT(1)   NOT NULL DEFAULT 0,   -- "você pediu isso"
  destaque     TINYINT(1)   NOT NULL DEFAULT 0,   -- fixa no topo
  publicada_em TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criada_por   VARCHAR(40)  NULL,
  KEY ix_publicada (publicada_em DESC)
) ENGINE=InnoDB;

-- O carimbo POR USUÁRIO: a última vez que esta pessoa abriu as novidades.
-- "Não lida" = novidade publicada depois deste instante. Uma coluna só, em
-- vez de uma tabela de junção, porque a pergunta é sempre "tem algo novo para
-- mim desde a última vez?" — e isso é uma data, não um histórico.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS novidades_visto_em DATETIME NULL;
