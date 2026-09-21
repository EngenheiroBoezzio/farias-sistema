# Front-end — Farias Troca de Óleo

Angular 18 (standalone, sem NgModule) preparado para rodar dentro do Electron
como aplicativo instalável.

**Estado:** compila, e os 16 testes de tela passam contra a API real
(2.133 clientes, 3.128 veículos, 6.220 ordens).

---

## O ponto principal: a URL da API não é compilada

Este era o requisito central, e é o que dita a arquitetura.

Se o endereço do servidor estivesse em `environment.ts`, ele entraria dentro do
bundle na hora do build — e **cada mudança de endereço exigiria gerar um
instalador novo**. Aqui a URL é lida quando o programa **abre**.

Ordem de precedência, da mais forte para a mais fraca:

| # | Origem | Onde fica |
|---|---|---|
| 1 | O que o usuário salvou na tela de Configuração | `localStorage` |
| 2 | O que o Electron leu do disco | `%APPDATA%/Farias Troca de Oleo/config.json` |
| 3 | O arquivo que vai junto no pacote | `public/config.json` |
| 4 | Padrão de desenvolvimento | `http://localhost:3001` |

O arquivo do Electron fica na pasta de dados do usuário **de propósito**: se
ficasse ao lado do executável, cada atualização do app apagaria o endereço
configurado.

Na tela de Configuração há um botão **Testar conexão**, que bate em `/health`
antes de salvar — assim dá para descobrir que o endereço está errado sem
esperar o primeiro erro no meio do atendimento.

```json
// public/config.json
{
  "apiUrl": "http://192.168.0.10:3001",
  "nomeLoja": "Farias Troca de Óleo",
  "canalWhatsapp": ""
}
```

---

## Rodar

```bash
npm install
npm run fontes     # uma vez, numa máquina com internet (veja "Fontes")
npm start          # http://localhost:4200
```

A API precisa estar no ar e aceitar a origem do front:

```ini
# no .env da API
CORS_ORIGENS=http://localhost:4200
```

Para rodar dentro do Electron durante o desenvolvimento:

```bash
npm run dev        # sobe o ng serve e abre a janela do Electron
```

## Compilar o instalador

```bash
npm run empacotar  # gera em ./instalador, sem publicar
```

O `.exe` sai em `instalador/`. O NSIS está configurado para instalação por
usuário (sem pedir administrador), com atalho na área de trabalho e no menu
iniciar, e deixa escolher a pasta.

---

## Versionamento e atualização por GitHub

A espera pedida está pronta em `package.json`:

```json
"publish": [{
  "provider": "github",
  "owner": "SEU-USUARIO-NO-GITHUB",
  "repo": "farias-sistema",
  "releaseType": "release"
}]
```

**Para ligar:**

1. Troque `owner` pelo seu usuário do GitHub.
2. Crie o repositório (pode ser privado).
3. Gere um token com escopo `repo` e exporte como `GH_TOKEN`.
4. Suba a versão em `package.json` e rode `npm run publicar`.

O `electron-updater` compara a versão instalada com a última *release* e baixa
a nova em segundo plano. A instalação acontece **ao fechar o programa**, nunca
no meio do expediente — `autoInstallOnAppQuit: true`.

Enquanto o repositório não existir, `npm run empacotar` funciona igual; só
`npm run publicar` depende dele. E a verificação de atualização avisa que não
está configurada em vez de quebrar o app.

---

## Fontes

Nenhuma fonte vem da internet. O app roda numa oficina que pode estar sem rede,
e tipografia buscada em tempo de execução deixaria a tela quebrada justamente
no pior momento.

```bash
npm run fontes     # baixa e guarda em public/assets/fontes/
```

Depois acrescente na primeira linha de `src/styles.css`:

```css
@import url("assets/fontes/fontes.css");
```

Sem isso o app continua funcionando — o CSS cai em `system-ui`, que é legível.

---

## Como está organizado

```
src/app/
  nucleo/          config, api, auth, tipos, formatação
  partes/          moldura (barra lateral), sino, selo de confirmação
  telas/           uma pasta por tela
electron/
  main.js          janela, config em disco, atualização
  preload.js       a ponte — lista fechada de funções
```

### Decisões que valem explicar

**A sessão morre quando o app fecha.** O token fica em `sessionStorage`, não em
`localStorage`. O pedido era que um computador roubado não abrisse o sistema.

**A barra lateral é de ícones e abre no hover** — e também quando o foco entra
por teclado (`:focus-within`). Quem navega por Tab enxerga os rótulos igual a
quem usa o mouse.

**`withHashLocation()` é obrigatório.** No Electron a página é carregada de
`file://`, e sem hash o roteador quebra ao recarregar a janela.

**Todo DECIMAL da API chega como string.** O driver do MariaDB devolve
`total: "365.00"`, não número. `"365.00" + "120.00"` em JavaScript dá
`"365.00120.00"`, e o erro passa despercebido porque a tela mostra um número
plausível. Por isso existe `num()` em `nucleo/formato.ts`, e toda conta passa
por ele.

**O renderer não enxerga Node.** `contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false`. Tudo que precisa do sistema passa pelo `preload`, por
uma lista fechada de quatro funções.

**Link externo abre no navegador do sistema.** É assim que o `wa.me` funciona
sem sequestrar a janela do app.

---

## O que os testes cobrem

```bash
node e2e.mjs       # precisa do ng serve e da API no ar
```

16 checagens, entre elas: o login recusa senha errada **com a mensagem certa**
(um bug real: o tradutor de erro dizia "sua sessão expirou" para quem tinha
acabado de digitar a senha), a barra lateral expande de 62px para 218px, a
consulta de placa devolve os quatro filtros rotulados por tipo, e a fila de
filtros carrega com sugestão.

---

## O que falta

1. Tela de campanha do canal de avisos (o back-end ainda não tem essa rota).
2. Edição e exclusão de ordem pela interface — a API já faz, a tela não.
3. Trocar `build/icone.png` pela logo real (hoje é um quadrado provisório) e
   gerar o `.ico` para o instalador do Windows.
4. Rodar `npm run fontes` numa máquina com internet.
