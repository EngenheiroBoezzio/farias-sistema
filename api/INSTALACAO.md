# Instalação — Sistema Farias Troca de Óleo

## O caminho rápido: INSTALAR.bat

No Windows, clique com o botão direito em **INSTALAR.bat** e escolha
**Executar como administrador**. Ele pergunta onde instalar, a senha do root
do banco, o caminho da planilha e a porta, mostra um resumo e **só então
grava**.

Do resumo em diante ele faz tudo sozinho:

- cria o banco e os dois usuários, com senhas **sorteadas na hora**;
- aplica os quatro arquivos SQL, na ordem certa;
- gera o `JWT_SECRET`;
- importa a planilha, se você indicar o arquivo;
- carrega os catálogos de óleo e de filtros Wega;
- cria os usuários do sistema e **imprime as senhas uma única vez**;
- agenda o backup diário e o início junto com o Windows;
- sobe o sistema, roda as bancadas de conferência e abre a tela no navegador.

**Não precisa instalar nada antes.** Faltando Node.js ou MariaDB, o instalador
se oferece para instalar pelo gerenciador de pacotes do Windows — perguntando
primeiro, nunca por conta própria. Sem internet ou sem o gerenciador, ele diz
exatamente o que baixar.

### A tela vem junto

O front-end já vai compilado dentro do pacote, na pasta `publico/`, e a
própria API o entrega na mesma porta. Terminada a instalação, o balcão abre:

```
nesta máquina        http://localhost:3001
nos outros do balcão http://192.168.x.x:3001
```

E acabou — **não há endereço de API para configurar em cada computador**, que
é onde uma instalação costuma emperrar, e não há CORS no caminho, porque a
tela e a API são a mesma origem. O aplicativo Electron continua possível para
quem preferir ícone na área de trabalho; aí sim há um endereço a apontar, e
o instalador deixa ele pronto em `config-do-aplicativo.json`.

### Uma coisa que ficou de fora: as fontes

A tela usa Schibsted Grotesk e IBM Plex Mono. Elas **não** vêm no pacote
porque a máquina onde o sistema foi compilado não tinha acesso ao Google
Fonts. Sem elas o app cai em `system-ui` — continua legível e nada quebra, só
não fica com a tipografia do projeto.

Para colocar, numa máquina com internet:

```bash
cd farias-app
node scripts/baixar-fontes.js
```

Ele grava em `public/assets/fontes/` e diz para acrescentar na primeira linha
de `src/styles.css`:

```css
@import url("assets/fontes/fontes.css");
```

Depois recompile (`npm run build`) e copie `dist/farias-app/browser/` por cima
de `publico/`, mantendo o `config.json` que o instalador gravou. A política de
segurança de conteúdo já permite: as fontes passam a ser do próprio servidor.

### Conferido numa instalação limpa

```bash
node scripts/testar-instalador.js
```

Instala num banco zerado e confere **31 pontos**: as tabelas (inclusive as
colunas que vêm do `placa.sql`), os catálogos carregados, o usuário da API
sem permissão de alterar estrutura, a API subindo **a partir de outra pasta**
— que é como o serviço do Windows inicia —, a tela sendo servida com política
de segurança de conteúdo, e a consulta por modelo respondendo numa base sem
nenhum histórico.

Tem mais dois modos, e os dois existem por causa de erro que aconteceu de
verdade numa instalação:

```bash
PROVA_PLANILHA=pasta    node scripts/testar-instalador.js   # 35 pontos
PROVA_PLANILHA=quebrada node scripts/testar-instalador.js   # 35 pontos
```

O primeiro responde o caminho de uma **pasta** no campo da planilha. O
instalador antigo aceitava (pasta "existe") e estourava depois com `EISDIR`;
agora ele recusa, mostra os `.xlsx` que enxerga ali dentro e pergunta de novo.

O segundo aponta para um arquivo `.xlsx` ilegível. Antes isso **derrubava a
instalação inteira** — banco, tabelas, `.env` e catálogos iam junto por causa
do passo mais fácil de refazer. Agora avisa, segue com a base vazia e diz o
comando para importar depois.

O resto deste documento é o passo a passo manual — serve para Linux, para
entender o que o instalador faz, e para consertar quando algo sai do lugar.

---

Guia para colocar a API no ar numa máquina Linux e deixar rodando sozinha.
Todos os números aqui foram medidos na base real da Farias (2.133 clientes,
3.128 veículos, 6.220 ordens de serviço), não são estimativa.

**Testado em:** Ubuntu 24.04 · Node 22 · MariaDB 10.11

---

## 1. O que precisa na máquina

| Item | Versão | Por quê |
|---|---|---|
| Node.js | 20 ou superior | a API roda nele |
| MariaDB | 10.6 ou superior | o banco |
| `gzip`, `mysqldump` | já vêm com o MariaDB | backup |
| Disco | 2 GB livres | ver o cálculo na seção 7 |
| RAM | 1 GB | o catálogo de filtros fica em memória (~2 MB) |

A API não precisa de internet para funcionar. Só precisaria se você ligar a
consulta de placa por API externa, que é opcional.

```bash
sudo apt update
sudo apt install -y nodejs npm mariadb-server
node -v        # precisa mostrar v20 ou maior
```

---

## 2. Colocar os arquivos no lugar

```bash
sudo mkdir -p /opt/farias-api
sudo chown $USER:$USER /opt/farias-api
# copie o projeto para /opt/farias-api (scp, rsync, pendrive, tanto faz)
cd /opt/farias-api
npm install --omit=dev
mkdir -p backups logs
```

---

## 3. O banco

### 3.1 Garantir que o MariaDB sobe sozinho no boot

**Esta é a parte que mais dá problema.** Se a máquina reiniciar de madrugada e
o banco não subir, o sistema amanhece fora do ar e ninguém percebe até o
primeiro cliente chegar.

```bash
sudo systemctl enable mariadb      # marca para subir no boot
sudo systemctl start mariadb
sudo systemctl is-enabled mariadb  # tem que responder: enabled
```

Confirme que sobreviveu a um reboot antes de considerar instalado:

```bash
sudo reboot
# depois que voltar:
systemctl is-active mariadb        # tem que responder: active
```

Se o MariaDB não subir, o erro quase sempre está no dono da pasta de dados.
O log dirá `Tablespace ... was not found`. Conserto:

```bash
sudo chown -R mysql:mysql /var/lib/mysql
sudo systemctl restart mariadb
```

### 3.2 Criar o banco e os dois usuários

São dois usuários de propósito, com poderes diferentes. **A API não tem
permissão de alterar a estrutura do banco** — se um dia uma falha permitir
injeção de comando, o estrago para no `DELETE`, não chega no `DROP TABLE`.

```bash
sudo mariadb <<'SQL'
CREATE DATABASE IF NOT EXISTS farias CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- usuário da API: mexe nos dados, não mexe na estrutura
CREATE USER IF NOT EXISTS 'farias'@'localhost' IDENTIFIED BY 'TROQUE-ESTA-SENHA';
GRANT SELECT, INSERT, UPDATE, DELETE ON farias.* TO 'farias'@'localhost';

-- usuário do backup: só lê o banco real; escreve apenas no banco de conferência
CREATE USER IF NOT EXISTS 'farias_backup'@'localhost' IDENTIFIED BY 'TROQUE-ESTA-TAMBEM';
GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER ON farias.* TO 'farias_backup'@'localhost';
GRANT ALL PRIVILEGES ON `farias_verifica`.* TO 'farias_backup'@'localhost';

FLUSH PRIVILEGES;
SQL
```

### 3.3 Criar as tabelas

São **quatro** arquivos e a ordem importa. `schema.sql` cria tudo; os outros
acrescentam o que veio depois.

```bash
sudo mariadb farias < sql/schema.sql
sudo mariadb farias < sql/valores.sql    # separa preço de código de peça
sudo mariadb farias < sql/wega.sql       # catálogo de filtros
sudo mariadb farias < sql/placa.sql      # colunas de versão/FIPE
```

> Não pule o `placa.sql`. Sem ele a instalação sobe normalmente e só quebra
> depois, na primeira consulta de placa — o tipo de falha que não aparece em
> base já migrada, só em instalação nova. O instalador aplica os quatro e
> **para** se algum faltar no pacote.

> Estes comandos usam `sudo mariadb` (root do banco) porque criam tabelas.
> A API nunca faz isso — é justamente o ponto da separação.

---

## 4. Configuração

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Abra o `.env` e preencha:

```ini
PORT=3001
NODE_ENV=producao

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=farias
DB_PASSWORD=a-senha-que-você-criou-em-3.2
DB_NAME=farias
DB_POOL=10

# cole aqui a saída do comando acima. Mínimo 32 caracteres.
# Trocar este valor desconecta todo mundo — é assim que se derruba
# uma sessão vazada.
JWT_SECRET=

SESSAO_TTL=3d
CORS_ORIGENS=http://localhost:5173,http://localhost:4200

BACKUP_DB_USER=farias_backup
BACKUP_DB_PASSWORD=a-outra-senha-de-3.2
BACKUP_DIR=./backups
```

```bash
chmod 600 .env     # tem senha dentro
```

---

## 5. Carregar os dados

```bash
# 1. a planilha do Farias
node scripts/migrar.js /caminho/PLANILHA_DE_CLIENTES_FARIAS.xlsx

# 2. separar preço de código de peça (a planilha misturava os dois)
node scripts/separar-valor-codigo.js            # simula, mostra o que faria
node scripts/separar-valor-codigo.js --aplicar  # grava

# 3. catálogo de óleo e catálogo de filtros Wega
node scripts/carregar-catalogo.js
node scripts/carregar-wega.js

# 4. criar os usuários do sistema — imprime as senhas UMA vez
node scripts/seed.js
```

**Anote as senhas do passo 4 na hora.** Elas não são mostradas de novo, e o
banco guarda só o hash.

---

## 6. Subir a API como serviço

Rodar com `npm start` num terminal não serve: fecha o terminal, cai o sistema.

```bash
sudo tee /etc/systemd/system/farias-api.service > /dev/null <<'UNIT'
[Unit]
Description=API Farias Troca de Oleo
After=network.target mariadb.service
Requires=mariadb.service

[Service]
Type=simple
User=farias
WorkingDirectory=/opt/farias-api
ExecStart=/usr/bin/node src/servidor.js
Restart=always
RestartSec=5
StandardOutput=append:/opt/farias-api/logs/api.log
StandardError=append:/opt/farias-api/logs/api.log

# a API não precisa de nada fora da própria pasta
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

sudo useradd -r -s /usr/sbin/nologin farias 2>/dev/null || true
sudo chown -R farias:farias /opt/farias-api
sudo systemctl daemon-reload
sudo systemctl enable --now farias-api
```

`Requires=mariadb.service` faz a API esperar o banco. `Restart=always` levanta
de novo se ela cair.

Conferir:

```bash
systemctl status farias-api
curl localhost:3001/health
# resposta esperada: {"ok":true,"banco_ms":1,...}
```

---

## 7. Backup e reserva de disco

### 7.1 Quanto o backup ocupa — com a conta feita

Medido na base real:

| O que | Tamanho |
|---|---|
| Banco inteiro | **5,1 MB** |
| Um backup comprimido | **0,34 MB** |
| Crescimento | **130 ordens/mês**, ~860 bytes cada = **~0,11 MB/mês** no banco |

A retenção que o script mantém sozinho:

| Tipo | Quantos guarda | Ocupa hoje |
|---|---|---|
| horário | 24 | ~8 MB |
| diário | 30 | ~10 MB |
| mensal | 12 | ~4 MB |
| **total** | | **~22 MB** |

Projetando o crescimento: em **10 anos** a base chega a cerca de 18 MB e o
conjunto de backups a cerca de 75 MB.

**Reserve 2 GB.** É muito mais do que a conta pede, e é de propósito: a
conferência do backup restaura uma cópia num banco temporário, o MariaDB
precisa de espaço para log de transação, e disco cheio corrompe banco. 2 GB
custa nada e tira o assunto da frente por uma década.

```bash
df -h /opt/farias-api      # confira o espaço livre antes de seguir
```

Se quiser o backup num disco separado (recomendado — HD que queima leva o
banco *e* o backup junto se estiverem no mesmo lugar):

```bash
sudo mkdir -p /mnt/backup-farias
sudo chown farias:farias /mnt/backup-farias
# no .env:  BACKUP_DIR=/mnt/backup-farias
```

### 7.2 Agendar

```bash
sudo -u farias crontab -e
# cole o conteúdo de scripts/crontab.txt
```

O que está agendado:

- **de hora em hora**, 8h–11h e 14h–18h, de segunda a sábado — o pior caso de
  perda vira "a última hora de trabalho"
- **diário às 12h30**, na parada do almoço, quando ninguém está gravando
- **mensal no dia 1º**, guardado por um ano
- **vigia às 19h** — avisa se o backup *parou de rodar*. Backup que falha é
  visível; backup que simplesmente deixou de existir é o perigoso.

Cada backup se confere sozinho: gera o dump, comprime, calcula o SHA-256,
**restaura num banco temporário e compara as contagens linha a linha**. Só
então grava o registro de sucesso. Se a conferência não bater, aparece uma
notificação no sino do painel.

### 7.3 Backup fora da máquina

O que está acima guarda cópias **na mesma máquina**. Se o HD queimar, some
tudo junto. Mande o diário para fora também:

```bash
# exemplo com rclone para o Google Drive do Farias
0 13 * * 1-6  cd /opt/farias-api && rclone copy backups/ farias-drive:backups/ \
                --include "*diario*" --max-age 25h >> logs/backup.log 2>&1
```

### 7.4 Restaurar — procedimento testado

Restauração testada nesta base: **0,27 segundo**, 11 tabelas, faturamento de
R$ 1.773.880 conferido depois.

Primeiro restaure num banco separado e confira. **Nunca** por cima do banco de
produção sem olhar antes.

```bash
# 1. escolher o backup
ls -lt backups/

# 2. restaurar numa cópia
sudo mariadb -e "DROP DATABASE IF EXISTS farias_restauro;
                 CREATE DATABASE farias_restauro CHARACTER SET utf8mb4;"
gunzip -c backups/farias-diario-AAAAMMDD-HHMMSS.sql.gz | sudo mariadb farias_restauro

# 3. conferir se veio tudo
sudo mariadb farias_restauro -e "
  SELECT (SELECT COUNT(*) FROM clientes) clientes,
         (SELECT COUNT(*) FROM veiculos) veiculos,
         (SELECT COUNT(*) FROM servicos) servicos,
         (SELECT ROUND(SUM(total)) FROM servicos) faturamento;"

# 4. só se os números fizerem sentido, promover para produção
sudo systemctl stop farias-api
sudo mariadb -e "DROP DATABASE farias; CREATE DATABASE farias CHARACTER SET utf8mb4;"
gunzip -c backups/farias-diario-AAAAMMDD-HHMMSS.sql.gz | sudo mariadb farias
sudo systemctl start farias-api
curl localhost:3001/health
```

---

## 8. Conferir se ficou tudo certo

As bancadas entram no sistema como a Raíssa entraria, então precisam da senha
dela — a que o `seed.js` imprimiu **uma vez** na instalação. Exporte antes:

```bash
cd /opt/farias-api
export TESTE_USUARIO=raissa
export TESTE_SENHA='a-senha-que-o-seed-imprimiu'

node scripts/teste-fluxo.js                         # 25 passos do fluxo do balcão
node scripts/pentest-escrita.js                     # 35 checagens das rotas que gravam
node scripts/teste-wega.js                          # 25 checagens do catálogo de filtros
node scripts/teste-modelo.js http://127.0.0.1:3001  # 39 da consulta por modelo
node scripts/teste-placa-api.js                     # 25 da leitura da consulta de placa
node scripts/pentest.js                             # 21 checagens de segurança
node scripts/bench.js                               # latência de cada rota
```

São **170 checagens** e todas precisam fechar com **zero falhas**. Elas criam
e apagam os próprios dados de teste — não sujam a base.

Rode nessa ordem e **reinicie a API entre uma e outra**. O `pentest.js` vai por
último de propósito: ele termina disparando força bruta no login para provar
que o limitador reage, e isso trava o login por 15 minutos — se rodar antes,
derruba o teste seguinte e a falha parece do sistema.

O `bench.js` avisa `MEDIDA INVÁLIDA` se alguma rota não responder 200. Se isso
aparecer, foi o limitador de requisições (2.000 a cada 15 min): reinicie a API
e rode de novo.

Se aparecer `FALHA login` logo na primeira linha, é o `TESTE_SENHA` errado ou
não exportado — não é falha do sistema.

### A instalação em si

```bash
node scripts/testar-instalador.js
```

Este é diferente dos outros: ele **instala do zero** num banco descartável e
confere 31 pontos do resultado (35 nos modos `PROVA_PLANILHA=pasta` e
`PROVA_PLANILHA=quebrada`). Roda antes de entregar uma versão nova, não
na máquina em produção — ele apaga e recria o banco de prova. Use
`PROVA_BANCO=` e `PROVA_DIR=` para mudar onde.

### A tela

```bash
cd ../farias-app
node e2e-instalado.mjs
```

Abre um navegador de verdade contra a instalação (API servindo o front na
mesma porta) e percorre 30 pontos do caminho do balcão: entrar, consultar
placa, placa desconhecida, digitar o modelo, autocompletar, cadastrar com os
códigos já preenchidos.

---

## 9. Atualizar depois

```bash
cd /opt/farias-api
node scripts/backup.js diario          # backup ANTES de qualquer coisa
git pull                               # ou copie os arquivos novos
npm install --omit=dev
sudo mariadb farias < sql/<novo>.sql   # se a atualização trouxer SQL
sudo systemctl restart farias-api
curl localhost:3001/health
node scripts/pentest.js
```

Se trocar o catálogo Wega por uma edição nova, não precisa reiniciar:

```bash
node scripts/carregar-wega.js
curl -X POST localhost:3001/api/notificacoes/recarregar-catalogo \
     -H "authorization: Bearer <token-de-admin>"
```

---

## 10. Quando der problema

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:3306` | MariaDB não está rodando | `sudo systemctl start mariadb` |
| Log do banco: `Tablespace not found` | dono da pasta de dados errado | `sudo chown -R mysql:mysql /var/lib/mysql` |
| `JWT_SECRET ausente ou curto demais` | `.env` sem a chave | gere com o comando da seção 4 |
| `CREATE command denied` | é o esperado | a API não altera estrutura; use `sudo mariadb` |
| Resposta `429` | limitador de requisições | 600/15min no geral, 8 tentativas de login, 15/min na consulta de placa |
| Login travado por 15 min | senha errada várias vezes | espere, ou reinicie a API para zerar o contador |
| Sino do painel com aviso de backup | conferência não bateu | veja `logs/backup.log` e rode `node scripts/backup.js diario` na mão |
| API reiniciando sozinha | veja `logs/api.log` | `systemctl status farias-api` mostra o motivo |

---

## 10a. Como o balcão descobre óleo e filtro (sem pagar nada)

Este é o caminho padrão, e ele **não depende de nenhum serviço externo**.
Funciona sem internet e sem contrato.

O atendente digita a placa. A partir daí:

1. **A placa é da casa** → responde na hora com o histórico do próprio carro:
   o óleo que a Farias já pôs nele e os filtros que a loja já confirmou. É a
   resposta mais confiável que existe, porque alguém daqui já fez o serviço.
2. **A placa não é conhecida** → a tela **não dá erro**. Ela abre um campo
   pedindo o modelo, já com os doze modelos que mais entram na oficina para
   clicar, e um autocompletar que casa tanto o jeito do balcão escrever
   (`SPACEFOX`) quanto o do catálogo (`Space Fox`).
3. Com o modelo (e o ano, se souberem), o sistema responde óleo e os quatro
   filtros, cruzando **duas fontes**:
   - o catálogo Wega, com a página do PDF de onde saiu;
   - o que a **própria Farias** já usou em carros do mesmo modelo e da mesma
     época.

Quando as duas concordam, a tela diz isso em verde e o atendente confirma sem
pensar. Quando discordam, a tela mostra as duas e manda conferir o motor —
que é exatamente quando tem que parar.

### Por que o histórico da casa entra junto

Num Gol 2015, o catálogo de óleo dá 30% de confiança. O histórico da Farias
dá **53 trocas de 5W-40 em 68**, quase sempre Mobil. A segunda resposta é
melhor, é de graça, e já estava no banco.

O sistema agrupa por **viscosidade**, não por produto de prateleira:
`5W40 MOB`, `5W40 SHELL` e `5W40 HAV` são a mesma decisão técnica. Contadas
separadas, escondiam que a casa concorda. A marca continua aparecendo, como
"normalmente SHELL", porque é o que está na estante.

Amostra pequena **não vira certeza**: a confiança é descontada quando há
poucas trocas para contar. Dois carros com o mesmo óleo saem com 10% de
confiança e a tela marca a resposta como fraca, não como regra da casa.

### O ano importa, e o sistema leva a sério

O catálogo Wega escreve `Gol` no nome de **todas** as linhas de Gol — do G2
de 1994 ao G7 de 2020. A geração vai na descrição, não no nome. Sem
desempate, um Gol 2020 pegava a linha de 2004 só porque ela vinha antes na
página do PDF, e saía o filtro de óleo errado.

Entre linhas que contêm o ano do carro, ganha a que **começa mais perto
dele**. Hoje:

| Gol | Filtro de óleo |
|---|---|
| 1996 | WO370 |
| 2004 | WO340 |
| 2012 | WO340 |
| 2016 em diante | WO545 |

Isso está preso por teste (`scripts/teste-modelo.js`), para não voltar.

### Conferir

```bash
node scripts/teste-modelo.js                       # sobe uma API só para o teste
node scripts/teste-modelo.js http://127.0.0.1:3001 # usa a instalada
```

**39 checagens**, nenhuma consulta paga, nenhuma internet.

---

## 10b. Consulta de placa por serviço externo (opcional)

Tudo acima funciona sem isto. O serviço externo é um **upgrade**: em vez de
digitar o modelo, o balcão digita só a placa e recebe modelo, versão e
**motorização** — o que sobe a confiança do filtro de ~75% para ~90%.

> **Atenção antes de contratar:** os serviços bons pedem **CNPJ**. Se a
> Farias não tiver, este atalho não está disponível e o caminho do item 10a
> continua sendo o que roda todo dia — que é como o sistema foi entregue.
> O `.env` sai sem `PLACA_API_URL`, e é assim que ele deve ficar até existir
> um fornecedor contratado.

### Por que é paga

Placa → veículo é dado do Denatran. Não existe fonte pública gratuita:
o `sinesp-api` do npm está sem atualização desde **dezembro de 2020**, o
pedido de consulta por placa no BrasilAPI segue **aberto e sem implementação**,
e o SINESP, mesmo quando funcionava, **não devolvia motorização** — que é
justamente o que falta aqui. A FIPE também não serve sozinha: ela recebe
marca + modelo + ano e devolve preço, não aceita placa.

### Quanto custa, com a conta feita na base real

| | |
|---|---|
| Preço por consulta | **R$ 0,03** |
| Lote mínimo | 1.000 consultas |
| Carros novos na Farias | **51 por mês** (média de 19 meses) |
| Custo mensal | **R$ 1,53** |
| Duração do lote mínimo | **20 meses** |
| Preencher de uma vez os 1.408 sem motorização | **R$ 42,24**, uma vez |

Cada placa é consultada **uma vez na vida** e fica em `cache_placa`. O custo é
por carro novo, não por consulta do balcão.

### Ligar

O sistema **não está preso a um fornecedor**. O formato da chamada vem do
`.env`, então trocar de serviço não exige mexer no código.

**Opção A — APIBrasil (tem faixa gratuita: 100 consultas/dia)**

Crie conta em <https://app.apibrasil.io>, ative "API Placa Dados" e pegue o
DeviceToken e o Bearer.

```ini
PLACA_API_URL=https://gateway.apibrasil.io/api/v2/vehicles/dados
PLACA_API_TOKEN=seu-bearer-token
PLACA_API_METODO=POST
PLACA_API_CABECALHOS={"DeviceToken":"seu-device-token","Authorization":"Bearer {token}"}
PLACA_API_CORPO={"placa":"{placa}"}
PLACA_TIMEOUT_MS=8000
```

100 por dia é muito mais do que a Farias precisa (51 carros novos por **mês**).
**Confirme antes** se a resposta traz a motorização: a documentação pública
não mostra o campo `cilindrada`, e sem ele a sugestão de filtro não melhora.
Teste com a placa do seu carro pelo painel deles antes de adotar.

**Opção B — API Placas (paga, R$ 0,03 por consulta)**

A documentação mostra `cilindradas` explicitamente e traz o bloco FIPE com a
versão específica.

```ini
PLACA_API_URL=https://wdapi2.com.br/consulta/{placa}/{token}
PLACA_API_TOKEN=seu-token-aqui
PLACA_TIMEOUT_MS=8000
```

Aqui o método é GET (o padrão) e o token vai na própria URL, então
`PLACA_API_METODO`, `PLACA_API_CABECALHOS` e `PLACA_API_CORPO` ficam vazios.

Em qualquer das duas, `{placa}` e `{token}` são substituídos pelo sistema, e a
resposta é desembrulhada automaticamente se vier aninhada em `response`,
`data`, `dados` ou `retorno`. Reinicie a API depois de mexer no `.env`.

3. Confira sem gastar consulta:

```bash
node scripts/teste-placa-api.js
```

Esse teste sobe um servidor falso e confere a leitura inteira — **25
checagens**, nenhuma consulta paga. Cobre os dois formatos: GET com token na
URL e POST com token em cabeçalho, incluindo resposta aninhada.

### O que o sistema aproveita da resposta

A resposta traz o modelo curto (`CROSSFOX`) e um bloco `fipe` com várias
linhas candidatas, cada uma com um `score`. **O modelo específico com a
motorização só está nesse bloco**: `CROSSFOX 1.6 Mi Total Flex 8V 5p`.

O sistema pega a linha de **maior score** (pegar a primeira da lista dá versão
errada em carro com mais de uma), converte `cilindradas: "1599"` em `1.6`,
normaliza `"Alcool / Gasolina"` para `flex` — que é o rótulo que o catálogo
Wega usa — e guarda também o código FIPE, o valor do veículo e a logo da
montadora.

Com a motorização preenchida, a sugestão de filtro sobe de ~75% para **90% de
confiança**, porque o catálogo passa a casar pelo motor e não só pelo nome.

### Preencher os carros antigos

```bash
node scripts/preencher-por-placa.js                  # simula, não gasta nada
node scripts/preencher-por-placa.js --aplicar --max=100
```

Só consulta quem está sem motorização e ativo, começa pelos de mais visitas,
respeita o cache, e **para sozinho** se o serviço recusar a credencial ou se
der cinco erros seguidos sem nenhum acerto. Nunca sobrescreve o que a loja
preencheu à mão.

Rode em lotes. Não há pressa: carro parado há dois anos não precisa ser
consultado hoje.

---

## 11. O que este sistema **não** faz

Dito aqui para não virar surpresa:

- **Não manda mensagem sozinho no WhatsApp.** Monta o link pronto por cliente;
  quem clica e envia é o atendente. Envio automático em massa derruba o número.
- **Não decide o filtro pelo cliente.** O catálogo Wega *sugere*, e a tela
  mostra de que página do PDF saiu. Quem confirma é o balcão. Filtro errado é
  peça errada no motor de um cliente.
- **Não consulta placa na internet** a não ser que você configure
  `PLACA_API_URL`. Sem isso, a placa é resolvida pelo cadastro e pelo catálogo.
- **Não cobre 100% dos carros.** O catálogo resolve 92% da fila de filtros
  (1.042 de 1.136 carros ativos). O resto é preenchido à mão, uma vez por carro.
