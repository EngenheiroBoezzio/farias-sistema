# Compilar o aplicativo do balcão

Este pacote é **o programa**, separado da API. A API roda no seu servidor; isto
aqui vira um executável que você instala nas máquinas da oficina e que aponta
para o seu servidor.

Quem compila é você. A oficina recebe só o `.exe`.

---

## Uma vez, na máquina onde você compila

Precisa de **Node.js LTS** e, para gerar o instalador do Windows, de um
**Windows** (o electron-builder monta o `.exe` na plataforma que corresponde).

```bash
cd farias-app
npm ci
```

**`npm ci`, não `npm install`.** A diferença importa aqui: `npm ci` apaga o
`node_modules` e instala exatamente o que está no `package-lock.json`, sem
negociar versão nenhuma. O `npm install` re-resolve, e numa pasta que já teve
outra instalação ele monta uma árvore misturada — Angular novo convivendo com o
TypeScript do projeto. O build então morre com uma mensagem que fala de
TypeScript quando o problema é o Angular:

```
The Angular Compiler requires TypeScript >=5.9.0 and <6.1.0 but 5.5.4 was found
```

Se isso aparecer, é isto: rode `npm ci`. O próprio script de build confere as
versões antes de compilar e avisa com esse mesmo comando.

---

## Toda vez que for gerar uma versão

### 1. Edite `configuracao.json`

É o único arquivo que você mexe. Ele vira parte do executável.

```json
{
  "apiUrl": "https://api.seudominio.com.br",
  "nomeLoja": "Farias Troca de Óleo",
  "canalWhatsapp": "",
  "travado": true,
  "github": { "owner": "seu-usuario", "repo": "farias-sistema" }
}
```

| campo | o que faz |
|---|---|
| `apiUrl` | endereço **público** da sua API. É para onde o programa da oficina vai falar. |
| `travado` | `true` esconde o endereço da tela de Configuração e impede qualquer alteração na máquina da oficina. É o modo de quem hospeda a API para o cliente. |
| `github.owner` | seu usuário ou organização. É de onde o app instalado busca versão nova. Vazio = sem atualização automática. |

Confira sem compilar:

```bash
npm run conferir-config
```

Ele **recusa** configurações que gerariam um instalador quebrado — a principal
é `travado: true` com `apiUrl` apontando para `localhost`, que na máquina da
oficina é o computador do próprio balcão e não o seu servidor. Esse erro só
apareceria depois de instalado, com o cliente na frente.

### 2. Suba o número da versão

O app instalado compara a versão dele com a da release no GitHub. **Sem subir o
número, ninguém atualiza.**

```bash
npm version patch      # 1.0.0 -> 1.0.1
```

### 3. Gere

```bash
npm run empacotar      # gera o instalador em instalador/, sem publicar
npm run publicar       # gera E publica a release no GitHub
```

#### Se der "Cannot create symbolic link"

```
ERROR: Cannot create symbolic link : O cliente não tem o privilégio necessário.
       ...winCodeSign\...\darwin.12\lib\libcrypto.dylib
```

Isso não é erro do projeto. O electron-builder baixa um pacote de assinatura
que contém links simbólicos do macOS, e **criar link simbólico no Windows exige
um privilégio que conta comum não tem**. Duas saídas, qualquer uma resolve:

- **Modo de Desenvolvedor** (recomendado, resolve de vez): Configurações →
  Privacidade e segurança → Para desenvolvedores → ligue **Modo de
  Desenvolvedor**. Ele concede esse privilégio sem precisar de administrador.
- **Prompt como Administrador**: abra o Prompt de Comando com o botão direito →
  Executar como administrador, e rode o `npm run empacotar` por ali.

Se ele já tiver falhado antes, apague a pasta do cache pela metade:

```
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
```

### O ícone do executável

Se o log disser `default Electron icon is used`, o programa vai para o cliente
com a logo do Electron na área de trabalho. O `build/icone.ico` já vai pronto
no pacote, mas é um quadrado da cor da marca — um espaço reservado.

Quando tiver a logo de verdade, salve como `build/icone.png` e rode:

```bash
npm run icone
npm run empacotar
```

Pode exportar em **qualquer tamanho quadrado** — 512x512, 1024x1024, tanto faz.
O script reduz para os sete tamanhos que o Windows usa (16, 24, 32, 48, 64, 128
e 256) e nunca amplia. PNG de 8 bits, sem entrelaçamento; com fundo
transparente funciona, e a transparência é preservada.

O redimensionamento é feito em `scripts/png.js`, escrito à mão com o `zlib` que
o Node já traz. Nenhuma biblioteca de imagem, de propósito: compilar dependência
nativa no Windows é justamente onde as coisas quebram.

O `aplicar-config` avisa antes de compilar se o `.ico` estiver faltando.

Para `publicar`, o GitHub precisa autorizar:

```bash
set GH_TOKEN=seu-token-com-permissao-de-repo     # Windows
export GH_TOKEN=seu-token-com-permissao-de-repo  # Linux/macOS
```

O arquivo sai em `instalador/`. É esse `.exe` que vai para a oficina.

---

## Como a atualização automática funciona

O app verifica ao abrir. Achando versão maior no GitHub, **baixa em segundo
plano** e instala **ao fechar o programa** — nunca no meio do expediente, que
é o pior momento possível para um sistema de balcão reiniciar.

Então o fluxo de uma correção é: mexe no código, `npm version patch`,
`npm run publicar`. Na próxima vez que o balcão fechar o programa, ele já sobe
atualizado. Você não vai à loja.

Se `github.owner` estiver vazio, tudo funciona menos isso — e o
`aplicar-config` avisa em voz alta na hora de compilar.

---

## Por que o endereço não é configurável na tela

Com `travado: true`:

- a tela de Configuração **não tem campo** de endereço nem botão de salvar;
- o endereço aparece em texto, só para leitura, porque na hora do suporte a
  primeira pergunta é "em que servidor você está" — ver não é poder alterar;
- `localStorage` e um `config.json` plantado na pasta de dados do usuário são
  **ignorados**. Não adianta abrir o DevTools: o serviço recusa antes da tela.

Isso está preso por teste — `e2e-electron.js` tenta justamente plantar outro
endereço no `localStorage` e confere que o app continua no servidor certo.

---

## O app não roda em `file://`, e isso é de propósito

Carregado com `loadFile`, o Chromium trata a janela como origem `file://` e
manda `Origin: null` em toda chamada. Para a API isso é uma origem estranha
como qualquer outra: cai fora da lista branca e volta erro. O app abriria
bonito e não falaria com o servidor — e só na máquina da oficina.

Por isso o app registra um esquema próprio e carrega de **`app://farias`**, que
é uma origem real e estável. A API já traz `app://farias` na lista branca por
padrão; não precisa configurar nada.

---

## Conferir antes de entregar

```bash
# com a API de pé no endereço que está no configuracao.json
npm run build
npx electron-builder --linux dir --publish never   # ou --win
xvfb-run -a ./node_modules/.bin/electron e2e-electron.js   # Linux
./node_modules/.bin/electron e2e-electron.js               # Windows/macOS
```

São **15 checagens** contra o app empacotado de verdade: a origem `app://`, a
configuração travada, a tentativa de burlar pelo `localStorage`, o login
através da API remota, o painel trazendo números, e a tela de Configuração sem
campo de servidor.

---

## As fontes

Schibsted Grotesk e IBM Plex Mono não vêm no pacote. Sem elas o app cai em
`system-ui` — legível, só não é a tipografia do projeto. Numa máquina com
internet:

```bash
node scripts/baixar-fontes.js
```

Ele grava em `public/assets/fontes/` e diz para acrescentar na primeira linha
de `src/styles.css`:

```css
@import url("assets/fontes/fontes.css");
```

Depois é só compilar de novo.
