# API da Farias — backend

Node + Express + MariaDB, montado seguindo o playbook.
**Rodado e testado:** banco carregado com a planilha real, **105 testes
passando** em quatro bancadas, e nenhuma rota acima de 33 ms.

Para instalar num servidor, veja **[INSTALACAO.md](INSTALACAO.md)** — traz o
serviço no boot, os dois usuários do banco, o agendamento do backup com o
cálculo de disco, e a restauração testada.

## Subir

```bash
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # -> JWT_SECRET

# usuário do banco SEM permissão de DDL: a API não altera schema
mariadb -e "CREATE USER 'farias'@'localhost' IDENTIFIED BY 'uma-senha-forte';
            GRANT SELECT,INSERT,UPDATE,DELETE ON farias.* TO 'farias'@'localhost';"

mariadb < sql/schema.sql
node scripts/migrar.js /caminho/PLANILHA_DE_CLIENTES_FARIAS.xlsx
node scripts/seed.js                 # imprime as senhas UMA vez — anote
npm start
```

Conferir:

```bash
curl localhost:3001/health
node scripts/pentest.js           # 21 · segurança
node scripts/pentest-escrita.js   # 35 · rotas que gravam
node scripts/teste-fluxo.js       # 24 · fluxo do balcão
node scripts/teste-wega.js        # 25 · catálogo de filtros
node scripts/bench.js             # latência + plano das consultas
```

## Medições reais

30 chamadas por rota, base com 6.220 serviços e 3.128 veículos:

| Rota | mediana | p95 |
|---|---|---|
| `/api/veiculos/placa/:placa` | **2,8 ms** | 6,0 |
| `/api/painel` | 3,2 | 4,9 |
| `/api/servicos?limite=50` | 4,1 | 7,4 |
| `/api/placa/:placa` (com sugestão de filtro) | 4,4 | 25,6 |
| `/api/clientes?limite=50` | 4,5 | 8,4 |
| `/api/avisos/fila` | 5,2 | 6,4 |
| `/api/veiculos?busca=gol` | 8,6 | 14,5 |
| `/api/veiculos/pendencias/sem-filtro` | 24,0 | 27,1 |

A fila de pendências é a mais lenta de propósito: ela calcula a sugestão de
filtro para os 50 carros da página, comparando cada um com as 2.519 linhas do
catálogo. Cheguei a indexar isso — caiu para 3 ms — mas o índice mudava 9
respostas em 3.075, e o tipo de mudança era o pior: um carro deixava de ser
marcado como **ambíguo**, escondendo do balcão que havia dois códigos de óleo
possíveis. Voltei para a varredura, e `teste-wega.js` agora compara as duas
formas a cada rodada para ninguém reintroduzir isso sem perceber.

Nenhuma consulta varre tabela: placa sai por `const` (1 linha), vencidos e
histórico por `ref`, fechamento do mês por `range`.

### A otimização que mais rendeu

`/api/servicos` começou em **18,5 ms**. O `EXPLAIN` mostrou o otimizador
entrando pela tabela de clientes e caindo em `Using temporary; Using filesort`.
A correção foi materializar os ids primeiro:

```sql
FROM (SELECT id FROM servicos ORDER BY data DESC, id DESC LIMIT 50) AS ids
JOIN servicos s ON s.id = ids.id
JOIN veiculos v ON v.id = s.veiculo_id
JOIN clientes c ON c.id = s.cliente_id
```

A subquery usa só o índice e devolve 50 ids; os JOINs rodam sobre 50 linhas por
chave primária. **14,65 ms → 0,47 ms na consulta; 18,5 → 3,6 ms na rota.**

Medir antes de mexer, como manda o playbook — o culpado não era o que parecia.

## Por que fica rápido

**Resumo do veículo pré-calculado.** `ultima_troca`, `ultimo_km`, `ultimo_oleo`,
`visitas` e `situacao` são colunas de `veiculos`, não um `GROUP BY` por listagem.
Quem paga é o `POST /servicos`, uma vez por ordem, na mesma transação.

**Índices que importam:**

| Índice | Serve para |
|---|---|
| `uk_placa` (UNIQUE) | busca por placa: um seek |
| `ix_situacao_troca` | fila de vencidos já ordenada |
| `ix_data_id` | lista de serviços sem filesort |
| `ix_veiculo_data` | histórico do carro |
| `ix_nasc_mes_dia` | aniversariantes do dia (colunas geradas) |

**Sem N+1.** Lista e contagem saem em duas consultas paralelas.

**Cache curto no painel** (30 s). Dez aberturas seguidas custam uma consulta.

**Toda resposta traz `_ms`** e o header `X-Tempo-ms`. Acima de 200 ms o log
registra `[lento]`.

O banco inteiro tem **5,1 MB**, com o catálogo de filtros dentro. Cabe na RAM
com folga — por isso "delay zero" é realista aqui.

## Pentest: 21/21

```
ok  rotas protegidas exigem sessão (3 rotas)
ok  senha errada e usuário inexistente dão a MESMA resposta
ok  4 cargas de SQL injection não quebram nem vazam
ok  corpo vazio devolve 400, sem nome de tabela ou coluna
ok  /eu ignora papel e id vindos do cliente
ok  token adulterado recusado
ok  logout revoga o token na hora
ok  sem X-Powered-By · nosniff · frame-options
ok  limite=999999 é cortado no teto de 200
ok  força bruta no login barrada com 429
```

O login roda bcrypt contra um hash falso quando o usuário não existe: mesma
mensagem e mesmo tempo de resposta, para não vazar quais contas existem.

## O que a migração encontrou

De 7.361 linhas, **6.220 aproveitadas**. Descartadas: 853 sem nome, 278 sem
placa, 8 sem data, 2 com data no futuro.

**A coluna `F.CABINE` não era filtro de cabine.** Era campo livre de itens
extras. A migração separou 3.044 itens, com **R$ 90.671** em receita que a
planilha não conseguia somar:

| Item | Vezes | Total |
|---|---|---|
| Anel de vedação | 1.437 | R$ 14.996 |
| Filtro de cabine | 192 | R$ 12.539 |
| Fluido | 236 | R$ 10.903 |
| Mão de obra | 113 | R$ 8.699 |
| Palheta | 52 | R$ 5.569 |
| Militec | 31 | R$ 3.850 |

Isso corrige um número que eu tinha dado antes: filtro de cabine entra em
**3%** das ordens, não 43%. Os 43% eram o campo usado para outra coisa.

**1.111 telefones tiveram o DDD deduzido** como 55. Ficam marcados com
`tel_inferido = 1` e a API devolve esse campo para a tela avisar.

## O playbook, item por item

| Item | Onde |
|---|---|
| Instrumentar tempo | middleware em `servidor.js`, `_ms` em toda resposta |
| Timeout em chamada externa | `db.js` (4 s por consulta), `PLACA_TIMEOUT_MS` |
| gzip | `compression()` |
| Preflight com cache | `cors({ maxAge: 86400 })` |
| `/health` público | sim, fora do rate limit |
| Validar na borda | `meio/validar.js`, antes de qualquer SQL |
| Erro não vaza banco | `meio/erros.js` — `ER_*` vira 400 genérico |
| Lista branca de campos | `somente()` + `CAMPOS` por rota |
| Campos sensíveis do servidor | `usuario_id` vem da sessão; `/eu` recusa `papel` |
| Autorização em camadas | `exigeLogin` → `exigePapel` → `exigeEscrita` |
| GET vs. escrita | `exigeEscrita` libera GET/HEAD, barra o resto |
| Sessão revogável | `token_version` conferido a cada requisição |
| TTL curto | 3 dias |
| bcrypt 12 rounds | `seed.js` e troca de senha |
| Rate limit em camadas | geral 600/15min · login 8/15min · placa 15/min |
| Query parametrizada | 100% com `?`; `ORDER BY` de lista fechada |
| Segredos fora do código | `.env`, exemplo só com nomes |
| helmet + CORS lista branca | sim, nunca reflete o `Origin` |
| Cookie HttpOnly/Secure/SameSite | `opcoesDoCookie()` |

Um a mais, que não estava no playbook: **o usuário do banco não tem DDL.**
Sem `DROP`, `ALTER` ou `CREATE` — a API não muda schema nem em caso de falha
grave. Por isso a migração usa `DELETE` e não `TRUNCATE`.

## O catálogo de filtros Wega

O cliente usa filtro Wega, então o catálogo oficial da linha leve 2023/2024
virou base de dados: **2.519 aplicações, 56 montadoras, de Alfa Romeo a Volvo**.

Extraído do PDF **por coordenada de coluna**, não por texto corrido. Há linha
sem filtro de óleo, e lendo o texto achatado o código de combustível cairia na
coluna do óleo — peça errada no motor do cliente. O PDF ainda traz cópias das
páginas vizinhas jogadas para fora do papel (x chega a −1315), que sem recorte
viravam 1.244 linhas duplicadas.

Cada linha guarda a **página do PDF e o texto original**, para conferir de onde
saiu cada código sem reabrir o catálogo.

`GET /api/placa/:placa` devolve os quatro tipos rotulados:

```json
"filtros": {
  "status": "sugerido", "confianca": 75,
  "origem": "Wega · Renault Kwid (Life / Zen / Intense) (2017 em diante)",
  "pagina_pdf": 31,
  "itens": [
    { "tipo": "oleo",        "rotulo": "Filtro de óleo",        "codigo": "WO412" },
    { "tipo": "ar",          "rotulo": "Filtro de ar",          "codigo": "FAP5218" },
    { "tipo": "combustivel", "rotulo": "Filtro de combustível", "codigo": "FCI1630" },
    { "tipo": "cabine",      "rotulo": "Filtro de cabine",      "codigo": "AKX1215",
      "alternativo": "AKX1215/C", "nota": "O segundo código é a versão com carvão ativado." }
  ]
}
```

**O catálogo sugere; o balcão confirma.** O que a loja confirmou tem prioridade
e nunca é sobrescrito. `POST /api/veiculos/:id/filtros/aceitar` grava a
sugestão registrando `filtros_por = "catálogo, aceito por <usuário>"`, para
depois dar para separar o que foi conferido de verdade do que foi aceito no
atacado. Sugestão de baixa confiança devolve 409 pedindo confirmação explícita.

Cobertura medida: **1.035 dos 1.124 carros ativos sem filtro (92%)**, sendo 39%
com código único e 53% com mais de uma opção para o balcão escolher.

Que o catálogo é a marca certa não é suposição: varrendo a base da Farias
apareceram **36 códigos Wega digitados à mão pelo balcão ao longo dos anos, e
31 deles (86%) existem no catálogo**, com o carro certo.

### O desempate por geração

O catálogo escreve `Gol` no nome de **todas** as linhas de Gol, do G2 de 1994
ao G7 de 2020 — a geração vai na descrição, não no nome. Resultado: as linhas
empatavam na pontuação e quem ganhava era a que estivesse antes na página do
PDF. Um Gol 2020 recebia `WO370`, que é filtro de G3/G4.

Entre linhas cuja faixa contém o ano do carro, ganha a que **começa mais perto
dele**; empatando nisso, a faixa mais estreita. É desempate puro — entra
depois da ordenação por nota, então nunca muda quem tirou a maior pontuação.

```
Gol 1996 -> WO370    Gol 2012 -> WO340
Gol 2004 -> WO340    Gol 2016+ -> WO545
```

A cobertura seguiu em **92%** e o guardião de equivalência contra a varredura
completa (400 veículos) voltou a bater 100% depois que a varredura recebeu a
mesma regra. Fica preso por teste em `scripts/teste-modelo.js`.

## Consulta sem placa: o histórico da própria casa

Consulta de placa que devolve motorização pede **CNPJ**, e a Farias não tem.
Então o caminho padrão não usa serviço externo nenhum.

Placa desconhecida deixou de ser erro: `GET /api/placa/:placa` responde **200**
com `precisa_modelo: true` e a lista dos modelos que mais entram na oficina.
Quem recebe 404 pinta a tela de vermelho; o que o balcão precisa ver ali é um
campo pedindo o modelo.

Duas rotas novas, ambas sem rede e sem custo:

- `GET /api/placa/modelos?busca=` — autocompletar, juntando os 641 modelos que
  a oficina atende com os do catálogo Wega. Casa `SPACEFOX` com `Space Fox`,
  porque o balcão escreve grudado o que o catálogo separa.
- `GET /api/placa/por-modelo?modelo=&ano=` — óleo e os quatro filtros.

E a resposta passou a cruzar **duas fontes**: o catálogo e o que a Farias já
pôs em carros do mesmo modelo e da mesma época (janela de ±3 anos, quando há
carros bastante para contar).

Num Gol 2015 o catálogo de óleo dá 30% de confiança; o histórico da casa dá
**53 trocas de 5W-40 em 68**. A segunda resposta é melhor, é de graça, e já
estava no banco desde a migração.

O agrupamento é por **viscosidade**, não por produto: `5W40 MOB`, `5W40 SHELL`
e `5W40 HAV` são a mesma decisão técnica, e contadas separadas escondiam que a
casa concorda — 56% virava 81%. A marca continua na resposta como
`marca_usual`, porque é o que está na estante.

Amostra pequena não vira certeza: a confiança é multiplicada por
`min(1, total/20)`. Dois carros concordando saem com 10%, não com 100%, e a
recomendação vem marcada como `forca: "baixa"`.

Quando catálogo e casa concordam, a resposta diz isso (`confere_com_a_casa`).
Quando discordam, devolve `divergencia` com os dois códigos e a contagem — é
aí que o atendente tem que parar e olhar o motor.

**170 checagens** passando ao todo: 25 do fluxo, 35 das rotas que gravam, 25 do
catálogo, 39 da consulta por modelo, 25 da leitura da consulta de placa e 21 de
segurança.

## A tela mora dentro da API

O front compilado vai em `publico/`, e o servidor entrega ele na mesma porta
quando essa pasta existe. Some o passo de configurar o endereço da API em
cada computador do balcão — que é onde instalação emperra — e some o CORS,
porque tela e API passam a ser a mesma origem. Sem a pasta, a API continua
sendo só API, que é como o `ng serve` e o Electron falam com ela.

Três coisas que isso obrigou a arrumar, e as três eram defeito de verdade:

**O CORS derrubava o próprio app.** O Angular marca os `<script>` com
`crossorigin`, então o navegador manda `Origin` até em requisição para o
mesmo servidor. A lista branca não reconhecia a própria origem e respondia
500 em cima do próprio bundle. Mesma origem nunca é "outra origem": agora
`Origin` igual ao `Host` que atendeu passa. É seguro porque página de outro
site não consegue forjar o `Origin` dela.

**A CSP ficou fechada, e por isso o `inlineCritical` saiu.** Servindo HTML,
`contentSecurityPolicy: false` deixou de fazer sentido. A política agora é
`script-src 'self'` — sem `unsafe-inline`, que é onde o XSS moraria. Isso
brigava com o `inlineCritical` do Angular, que injeta um `onload=` no `<link>`
do CSS. Entre afrouxar a CSP e abrir mão de alguns milissegundos numa tela de
rede local, a CSP ficou.

**O `.env` era lido da pasta atual.** `require('dotenv').config()` procura em
`process.cwd()`. Funciona enquanto alguém roda `node src/servidor.js` de
dentro da pasta, e falha no único momento que importa: quando o Windows sobe
o serviço, que começa em `C:\Windows\System32`. Agora `src/ambiente.js`
ancora o caminho em `__dirname`, e a prova de instalação sobe a API
deliberadamente de outra pasta para garantir que continua assim.

## A instalação virou código testado

`scripts/testar-instalador.js` instala do zero num banco descartável e confere
**31 pontos**. Foi escrito porque instalação é o único código que ninguém roda
duas vezes: se quebrar, quebra na máquina do cliente.

Ele achou na primeira rodada o defeito que justificava existir: o instalador
aplicava `schema.sql`, `wega.sql` e `valores.sql` — e **não** o `placa.sql`.
A instalação subia inteira e só quebrava na primeira consulta de placa,
porque faltavam as colunas de versão e FIPE. Numa base já migrada isso nunca
apareceria. Hoje são os quatro arquivos, na ordem, e faltar um **para** a
instalação em vez de seguir.

Numa instalação real na máquina do Pedro apareceram mais dois defeitos, e os
dois viraram modo de prova:

**Pasta no lugar da planilha.** O instalador só perguntava se o caminho
existia — e pasta existe. Dizia "[ok] arquivo encontrado" e ia ler uma pasta
como planilha, estourando com `EISDIR` vinte linhas depois. Agora confere se
é arquivo, se termina em `.xlsx`, e quando recebe uma pasta lista os `.xlsx`
que vê lá dentro. (`PROVA_PLANILHA=pasta`)

**Importação quebrada matava a instalação inteira.** Banco, tabelas, `.env` e
catálogos eram jogados fora por causa do passo mais fácil de refazer. O
sistema funciona com a base vazia — a consulta por modelo responde pelo
catálogo desde o primeiro dia —, então agora avisa, segue, e imprime o
comando para importar depois. (`PROVA_PLANILHA=quebrada`)

E o `.bat` dizia "nada ficou pela metade" ao parar, o que era falso: o banco
já existia. Agora o instalador lista o que **de fato** gravou antes de parar,
e diz que rodar de novo é seguro. Mentira em instalador faz a pessoa procurar
problema no lugar errado.

Ele conversa com o instalador respondendo ao **texto** de cada pergunta, não
numa ordem fixa: jogar respostas no stdin não funciona (o readline descarta o
que chega antes de existir pergunta) e responder por posição quebra sozinho
no dia em que uma pergunta entrar no meio. Pergunta sem resposta prevista
derruba a prova em 90 segundos dizendo qual foi.

## Falta

1. Enviar o backup diário para fora do servidor (ver seção Backup)
2. Catálogo de filtro de câmbio automático (a Farias vende ATF: 237 lançamentos
   de fluido, 45 de óleo de caixa — o PDF existe, ainda não foi carregado)
3. O catálogo de óleo não cobre **0W30**, usada 33 vezes na base
4. Fornecedor de consulta de placa que não exija CNPJ — se aparecer, é só
   preencher `PLACA_API_URL` no `.env`; o código já está pronto e testado

---

# Backup

## De quanto em quanto tempo

O dump completo leva **0,6 s** e ocupa **0,25 MB** comprimido. Com esse custo,
não existe motivo técnico para espaçar — a pergunta vira quanto trabalho se
aceita perder.

| Agenda | Quando | Retido | Espaço |
|---|---|---|---|
| Horário | 8h–11h e 14h–18h, seg a sáb | 24 últimos | ~6 MB |
| **Diário** | **12h30** (janela do almoço) | 30 últimos | ~7,5 MB |
| Mensal | dia 1º, 12h45 | 12 últimos | ~3 MB |

Cerca de **17 MB no total**. O diário roda na janela que você pediu: a oficina
está parada, ninguém grava, e é ele que fica guardado por 30 dias.

Se o backup rodasse só no almoço e o disco morresse às 17h, perderiam-se as
ordens da tarde — com os valores que o Farias já cobrou e não teria onde
conferir. De hora em hora, o pior caso vira "a última hora".

Instalar: `crontab -e` e colar `scripts/crontab.txt`.

## A verificação

Um `.sql` que ninguém restaurou não é backup, é esperança. Cada rodada:

1. conta as linhas no banco real
2. gera o dump com `--single-transaction` (foto consistente, sem travar a oficina)
3. comprime e calcula o SHA-256
4. **restaura num banco temporário** e conta de novo
5. compara; só marca `ok` se bater tabela por tabela

Testado com um dump truncado a 60% (simulando disco cheio no meio da escrita):
`servicos` veio com **0 linhas** contra 6.220 no banco, e a rodada seria marcada
como `divergente` com notificação de erro.

O usuário `farias_backup` tem `SELECT` no banco real e `ALL` **apenas** no banco
temporário de verificação. Nem o backup pode alterar produção.

## O vigia

`scripts/vigia-backup.js` roda às 19h15 e avisa quando o backup **parou de
rodar** — cron desligado, servidor trocado, caminho mudado. Backup que falha é
visível; backup que deixou de existir não gera nada, e é assim que se descobre
no pior dia que não há cópia há meses.

Ele reclama se: não há backup bem-sucedido há mais de 26h, o arquivo registrado
sumiu do disco, ou 3+ rodadas falharam na semana.

## As notificações

`GET /api/notificacoes` devolve `{ nao_lidas, erros, notificacoes[] }` — é o que
alimenta o sino do topo. Verde quando é só informação, vermelho quando há erro.

Sucesso notifica **uma vez por dia**: aviso repetido de hora em hora vira ruído
e ninguém lê. Falha notifica sempre.

`GET /api/notificacoes/backups` (só admin) traz o histórico e um campo `alerta`
com o diagnóstico — é a tela onde se descobre que algo parou.

## O que falta, e é importante

As cópias ficam **na mesma máquina**. Se o HD queimar, somem junto com o banco.
Mande o diário para fora — rsync para outro servidor ou o Drive do Farias. Tem
uma linha pronta comentada no fim do `crontab.txt`.

Enquanto isso não existir, o backup protege contra erro humano e corrupção de
tabela, mas não contra perda do servidor.
