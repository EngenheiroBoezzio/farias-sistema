# O que mudou nesta API — 26/09/2026

Seis arquivos, três deles novos. Nada de dependência nova: **não precisa
rodar `npm install`** na VPS.

## Novos

| Arquivo | Para quê |
|---|---|
| `src/rotas/config.js` | `GET /api/config` (qualquer um logado) e `PUT /api/config` (só admin). Nome da loja e link do canal do WhatsApp saem do banco. |
| `sql/2026-09-26-configuracoes.sql` | Cria a tabela `configuracoes`. Rode **uma vez**, como root. |
| `scripts/resetar-senha.js` | Troca a senha de quem existe. Senha esquecida não se recupera — bcrypt é mão única. |
| `REINICIAR.bat` | Derruba a API e sobe de novo, sem reiniciar a máquina. |

## Alterados

**`src/servidor.js`** — uma linha, logo abaixo das notificações:

```js
app.use('/api/config', require('./rotas/config'));
```

**`sql/schema.sql`** — o mesmo bloco `CREATE TABLE configuracoes` foi anexado
no fim, para instalação nova já nascer com a tabela. Quem já tem o banco de pé
não precisa dele: use o arquivo de migração.

## Para subir

```
1. extraia este zip por cima da pasta da API
2. mariadb -u root -p farias < sql\2026-09-26-configuracoes.sql
3. clique com o botão direito em REINICIAR.bat → Executar como administrador
```

O passo 2 roda quantas vezes quiser: `CREATE TABLE IF NOT EXISTS` e
`INSERT IGNORE`. Testei com um link já gravado no meio e ele não sobrescreveu.

## Duas coisas sobre este zip

**Não tem `.env`.** Nem o seu, nem nenhum. Extrair por cima não encosta nas
suas senhas de produção.

**Não tem `node_modules`.** O que está na VPS continua valendo.

## O que a rota recusa, e por quê

Existe uma **lista branca de chaves** dentro do `config.js`. Chave fora dela
não é lida nem gravada — nem se alguém inserir a linha no banco à mão. É o que
impede a tabela de virar um depósito de qualquer coisa com o tempo.

O `canalWhatsapp` exige **https**. Esse valor volta para a tela e vira `href` e
`window.open`: aceitar `javascript:` ali seria entregar execução de script a
quem conseguisse gravar uma vez. `http://` puro também é recusado.

E **só chave pública entra nessa tabela**. Qualquer atendente logado a lê.
Quando a rota de IA existir, a chave do provedor fica no `.env`, nunca aqui.

## Sobre o REINICIAR.bat

A API não roda como serviço do Windows: ela é uma **tarefa agendada** chamada
`FariasAPI`, com gatilho ONSTART, criada pelo `INSTALAR.bat`. O roteiro trata
os dois casos — encerra a tarefa e também mata o processo do node na marra,
porque se alguém subiu a API pela pasta Inicializar o `schtasks /End` não
alcança aquele processo.

Ele **não** dá `taskkill /im node.exe`. Procura só o node cuja linha de comando
aponta para o `servidor.js` **desta pasta** — matar node no atacado levaria
junto qualquer outra coisa em Node rodando na máquina.

No fim ele confere de verdade: espera o `/health` responder 200, e esse
endpoint só responde depois de fazer `SELECT 1` no banco. Então o "API no ar"
prova as duas coisas de uma vez.

**Deu certo, a janela fecha sozinha em 5 segundos** — que é o que você pediu.
**Deu errado, ela fica aberta** com o motivo e o caminho do log. Fechar em
silêncio depois de falhar seria o mesmo que não ter rodado nada.

Peça administrador logo na abertura, porque a tarefa foi registrada com
`/RL HIGHEST`: sem elevação o `schtasks /End` e o `taskkill` são negados, e o
roteiro morreria lá na frente dizendo só que a porta continua ocupada.

## O que eu testei aqui antes de te mandar

Subi um MariaDB limpo, apliquei o `schema.sql` inteiro do zero, rodei o
`seed.js`, subi esta API e bati nas rotas:

- `GET /api/config` logado → 200 com as duas chaves
- `GET` sem login → 401
- `PUT` como **atendente** → 403
- `PUT` com `javascript:alert(1)` → 400
- `PUT` com `http://` → 400
- `PUT` com `{"apiUrl":...,"JWT_SECRET":...}` → 400, nada tocou no banco
- `PUT` válido → gravou, e o `SELECT` mostrou `alterado_por` com o username
- rodar a migração duas vezes com valor já gravado → não sobrescreveu
- `/api/painel` e o login continuam iguais
- `resetar-senha.js`: trocou a senha, o login antigo passou a falhar, o novo
  entrou, e usuário inexistente não é criado

O que eu **não** consegui testar é o `REINICIAR.bat` rodando: não tem Windows
aqui. Revisei linha por linha, conferi que todo `goto` tem rótulo, que o
arquivo está em CRLF e sem acento nenhum — mas a primeira execução de verdade
é aí. Se ele reclamar de alguma coisa, me manda o texto da janela.
