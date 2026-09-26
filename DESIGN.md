# DESIGN.md — Farias Troca de Óleo

**Para que serve este arquivo:** entregue ele inteiro a qualquer IA antes de
pedir mudança de tela. Ele contém as decisões já tomadas, os valores exatos, as
armadilhas deste código e o que é proibido. Uma IA que leia isto produz telas
consistentes com o resto do sistema; uma que não leia vai reinventar a paleta e
desfazer o trabalho.

**Regra número um para quem vai mexer:** *não reinvente.* Se precisar de um
valor que não está aqui, é sinal de que o componente está errado, não de que
falta um token.

---

## 1. O que é este sistema

Sistema de balcão de uma oficina de troca de óleo em Santa Maria/RS. Roda em
Electron (janela de desktop no Windows), front em **Angular 18 standalone** com
signals e a sintaxe nova de template (`@if`, `@for`), API própria em Node.

Quem usa, e isso decide quase tudo:

- **Atendentes no balcão**, com cliente esperando em pé do outro lado. Pressa.
- **A Raíssa**, filha do dono, que administra — é quem olha o Financeiro.
- **Os pais dela**, que usam às vezes e enxergam menos. É por isso que existe o
  modo grande, e é por isso que alvo de clique é 40px e nunca 28px.

O sistema **sugere** e a pessoa **confirma**. Código de filtro errado é peça
errada no motor de um cliente — toda sugestão mostra de onde veio e com que
confiança, e nada é gravado sem alguém clicar.

---

## 2. Os seis princípios

1. **Cor é informação, nunca enfeite.** Só quatro cores podem colorir: em dia,
   a vencer, vencido, informativo. Se tudo é colorido, "vencido" deixa de
   saltar. Cartão de métrica não tem cor própria.
2. **O número que exige ação vem primeiro.** Quatro números do mesmo tamanho
   não dizem o que fazer. Na tela, lidera o que vira dinheiro ou trabalho — os
   211 vencidos, o que sobrou no mês — com o botão junto dele.
3. **O sistema não mente.** Nada de "Servidor Conectado" fixo, nada de versão
   digitada à mão, nada de barra de progresso falsa. Se o dado não existe,
   escreva um traço e diga por quê.
4. **Texto de balcão.** "Entrar", não "Entrar no Sistema". "Financeiro", não
   "Faturamento & Finanças". Botão é frase: só a primeira maiúscula. Nunca `&`
   em título.
5. **Alvo grande.** Qualquer coisa em que se clica ou se digita tem
   `var(--alvo)` de altura (40px, 48px no modo grande). Pílula de 24px não é
   botão.
6. **Decisão de design tem nome.** Se um padrão aparece duas vezes, vira
   classe no `styles.css`. Estilo escrito dentro do HTML não se repete e não se
   mantém — foi o que gerou 379 deles neste projeto.

---

## 3. Tokens — os valores exatos

Todos moram no `:root` de `src/styles.css`. **Nenhum arquivo além do
`styles.css` pode conter um valor de cor.** Nem HTML, nem TypeScript.

### Marca

Tirada do vermelho da logo da Farias. Trocar estes nove muda o sistema inteiro.

```css
--b-900:#3A0508; --b-800:#5C070C; --b-700:#8E0A10; --b-600:#B00C13;
--b-500:#D91018; --b-400:#E8434A; --b-300:#EE8387; --b-100:#FCE3E4; --b-50:#FDF4F4;
```

Contraste medido com branco: `--b-600` dá **7,2:1** (é o fundo de botão);
`--b-700` dá **9,5:1** (é a barra lateral). Por isso cada um está onde está.

### Neutros — quentes, não *slate*

```css
--n-0:#FFFFFF; --n-25:#FBFAF8; --n-50:#F6F3EF; --n-100:#E7E2DC; --n-200:#D3CCC4;
--n-300:#B5ADA6; --n-400:#8A817B; --n-500:#5C534D; --n-700:#3D3730; --n-900:#1A1512;
```

Cinza azulado briga com vermelho: lado a lado, o vermelho puxa para rosa. Se
alguma IA sugerir `#F8FAFC`, `#64748B` ou `#0F172A`, é a paleta do Tailwind
voltando — recuse.

### Estado — as únicas cores que colorem

```css
--pos:#0F6B45;  --pos-bg:#E3F1EA;  --pos-bd:#A8D5BF;   /* em dia */
--warn:#8A5A00; --warn-bg:#FAF0DA; --warn-bd:#E3C784;  /* a vencer */
--crit:#8E0A10; --crit-bg:#FCE3E4; --crit-bd:#F2C4C6;  /* vencido */
--info:#1F5B8F; --info-bg:#E4EDF5; --info-bd:#AEC8DE;  /* aviso neutro */
```

Os três primeiros se separam também por **tom** (claro/escuro), não só por
matiz — quem não distingue verde de vermelho ainda os separa.

### Séries de gráfico

```css
--c1:#8E0A10; --c2:#5C534D; --c3:#1F5B8F; --c4:#0F6B45; --c5:#8A5A00; --c6:#B5ADA6;
```

Variam em claro/escuro de propósito: impresso em preto e branco ainda se lê.

### Papéis, forma e escala

```css
--ground:var(--n-25); --surface:var(--n-0); --surface-2:var(--n-50);
--bd:var(--n-100); --bd-strong:var(--n-200);
--tx:var(--n-900); --tx-2:var(--n-500); --tx-3:var(--n-400);

--rail:#8E0A10; --rail-tx:#F6D6D7; --rail-2:#E8A9AC; --rail-3:#F0BFC1;
--rail-hover:rgba(255,255,255,.10); --rail-on:#B00C13;

--r-xs:4px; --r-sm:6px; --r-md:8px; --r-lg:8px; --r-full:999px;
--e-pop:0 16px 40px -14px rgba(26,21,18,.38);

--t-xs:13px; --t-sm:14px; --t-md:15px; --t-lg:16px; --t-xl:19px; --t-2xl:30px;
--alvo:40px;

--ui:"Schibsted Grotesk",system-ui,-apple-system,sans-serif;
--code:"IBM Plex Mono",ui-monospace,Consolas,monospace;
```

**Três raios e uma sombra. Seis tamanhos de texto, e nada entre eles.** Antes
eram sete raios, quatro sombras e catorze tamanhos (11, 11.5, 12, 12.5, 13,
13.5, 14, 14.5, 15.5, 16, 17, 18, 19, 24). Se um componente pede 17px ou raio
de 14px, o componente está errado.

Monoespaçada (`--code`) só para: placa, código de filtro, viscosidade, data em
tabela, número de versão. É rastro, não texto corrido.

### Modo grande e tema escuro

`html[data-font-size="media"|"grande"]` **redefine a escala inteira e o
`--alvo` junto** — não só o `font-size` do body. Texto crescer com o campo
parado de 40px era exatamente o problema de quem enxerga pouco.

O tema escuro existe **uma vez só**, em `:root[data-theme="dark"]`. Quem
resolve "automático" é o `ConfigService`: lê a preferência do sistema, escreve
`data-theme` no `<html>` e ouve a troca. **Não acrescente um
`@media (prefers-color-scheme:dark)` no CSS** — já existiram dois blocos
idênticos de 18 linhas e manter os dois em dia era questão de tempo.

---

## 4. Componentes prontos

Use estes antes de escrever CSS novo.

| Classe | O que é |
|---|---|
| `.rail` + `.rail-rolagem` | Barra lateral, **travada aberta** em 248px; recolhe para 72px abaixo de 1280px |
| `.head` + `.head-act` | Cabeçalho de tela: título, subtítulo e ações à direita |
| `.kpi` | Faixa de números. `.kpi-destaque` (ou `.kpi-alerta`) à esquerda para o número que exige ação, `.kpi-linha` > `.kpi-item` para o resto |
| `.panel` + `.panel-h` + `.panel-b` | Caixa branca com cabeçalho. `.panel-b.sem-respiro` quando o conteúdo é tabela |
| `.seg` > `button.on` | Seletor de opções lado a lado (período, tema, tamanho, tipo de gráfico) |
| `.cmd` + `.cmd-grupo` + `.cmd-nome` + `.cmd-sep` | Barra de comandos do Financeiro, em grupos nomeados |
| `.abas` | Abas de planilha, `sticky` no rodapé |
| `.lin` + `.lin-t` + `.lin-c` | **Uma linha de configuração**: o que é à esquerda, o controle à direita |
| `.cfg` + `.cfg-secoes` + `.cfg-corpo` | Tela de configuração com menu de seções |
| `.triagem` + `.triagem-fila` + `.fila-item` | Fila de trabalho: lista à esquerda, item aberto à direita |
| `.fila-grupo` + `.fila-linha` | Fila agrupada por urgência (Vencidos) |
| `.btn` `.btn-p` `.btn-s` `.btn-g` `.btn-lg` `.btn-sm` `.btn-w` `.btn-zap` | Botões. `.btn-p` é o único vermelho por tela |
| `.pill` + `.p-pos` `.p-warn` `.p-crit` `.p-mute` | Pílula de situação. `.pill-btn` quando ela também é botão |
| `.placa-txt` | Placa em monoespaçada, para tabela |
| `.busca-grande` | Campo de busca em tamanho de balcão |
| `.girando` | Spinner de botão trabalhando |
| `.vazio` / `.vazio-acao` / `.falha` / `.carregando` | Os quatro estados de uma tela |
| `.barra-fechar` | Rodapé fixo com total e botão de gravar (Nova ordem) |
| `.visualmente-oculto` | Rótulo que o leitor de tela lê e o olho não vê |
| `.tx-3` `.sub` `.num` `.forte` `.mono` `.respiro` `.sem-margem` | Utilidades |

---

## 5. Proibido — a lista de "cara de IA"

Cada item abaixo já esteve neste projeto e foi removido. Se voltar, foi uma IA
que não leu este arquivo.

**Cor e forma**
- Paleta padrão do Tailwind (`#DC2626`, `#3B82F6`, `#8B5CF6`, `#10B981`,
  `#F59E0B`, `#EC4899`, os *slate*).
- Dourado/âmbar como segunda cor de marca. **Não existe dourado na logo da
  Farias.** E `#F59E0B` sobre branco dá 2,2:1 — ilegível.
- Gradiente em botão, em fundo, em cartão.
- Glassmorphism: `backdrop-filter`, cartão translúcido, halo desfocado, grade
  de pontinhos.
- Qualquer 3D: palco isométrico, donut extrudado, linha neon, `drop-shadow`
  colorido. Foram 280 linhas de CSS para escolher entre quatro formatos de
  gráfico.
- Sombra colorida (`rgba(vermelho, …)`) — a sombra é neutra, e é uma só.

**Composição**
- Quadradinho de ícone colorido no canto de cada cartão de métrica. É *o*
  gesto que mais entrega tela gerada.
- Cartão de escolha com selo "✓ Selecionado", prévia e parágrafo de descrição.
  Configuração é linha, não vitrine.
- Ícone no rótulo + ícone dentro do campo + ícone no botão. Um por elemento,
  e só quando informa algo que a palavra não informa.
- Emoji em opção de `<select>` ou em título.

**Texto**
- `&` em título. "Gestão de Usuários & Acessos da Oficina".
- Title Case em botão: "Nova Despesa", "Cadastrar Cliente".
- Inflação: "Administrador Master", "Senha de Acesso", "Sistema de Gestão &
  Balcão", "Padrão Behance SaaS".
- Placeholder com reticências: "Digite seu usuário...".
- Comentário que descreve a ambição (`<!-- HERO METRIC CARDS -->`) em vez do
  motivo.

**Honestidade**
- Indicador de status fixo que não checa nada.
- Número de versão digitado à mão (vem do `package.json` via
  `scripts/aplicar-config.js` → `src/app/nucleo/versao.ts`).
- Endereço do servidor na tela da oficina. Foi decisão do Pedro: eles não
  precisam, e é mais uma coisa para ler errado no telefone. Fica só o botão de
  testar a conexão, que já mede o tempo em ms.
- Dado inventado para preencher tela. Se não existe na API, escreva um traço.

---

## 6. Armadilhas deste código

Coisas que já custaram tempo aqui. Leia antes de mexer.

**Especificidade do seletor de `input`.** A regra base usa dez `:not()`
envolvidos em `:where()` para casar todo campo de digitar sem herdar
especificidade. **Não tire o `:where()`** — sem ele a regra vale (0,11,1) e
qualquer `.classe input` perde, que foi o motivo de o ícone de lupa ficar por
cima do texto nos dois campos de busca.

**Escopo da barra lateral.** As regras de item de menu são
`.rail-rolagem a`, não `.rail a`. Com `.rail a`, o avatar e o nome do rodapé
viram itens de menu de 40px com `display:flex`, e o nome encolhe para "R.".

**Tokens fantasma.** `--bg-2`, `--tx-1` e `--b-200` **não existem**. Já foram
usados em cinco arquivos e resolviam para nada — fundo transparente, cor
herdada, sem ninguém notar. Os certos são `--surface-2`, `--tx` e
`--b-100`/`--b-300`. Rode a auditoria da seção 8 depois de qualquer mudança.

**`const` e `export type` antes do `@Component`.** Em Angular, o decorator tem
que vir colado na classe. Declaração entre os dois é TypeScript inválido e o
erro que sai não diz isso.

**NaN na tela.** `valor ?? 0` não pega NaN. `inteiro()` em `formato.ts` já
guarda com `Number.isFinite`; faça o mesmo em qualquer conta nova. "NaN ordens
faturadas" já apareceu em produção de teste.

**Cores em TypeScript.** O gráfico do painel tinha sete hexadecimais cravados
no `.ts`. Agora ele lê os tokens com
`getComputedStyle(document.documentElement).getPropertyValue('--b-700')`, e é
por isso que o tema escuro funciona no gráfico. Mantenha assim.

**Classe usada e nunca definida.** `.btn-sm` foi usado em quatro telas sem
existir no CSS — os botões "pequenos" saíam do mesmo tamanho. Rode a auditoria.

---

## 7. O que está feito e o que falta

**Pronto:** paleta, tipografia, barra lateral travada, Entrar, Painel,
Clientes, Vencidos ("Chamar de volta"), Financeiro, Configuração, Fila de
filtros, Ficha do veículo, Nova ordem (rodapé fixo), Novo cliente, folha de
impressão.

**Falta na interface:**
- **Consulta de placa** (`placa.component.html`, a maior do sistema). Hoje são
  três telas num scroll só — a busca, o "digite o modelo" e a resposta. Quando
  a resposta chega, a busca continua ocupando o topo. Proposta: assim que
  acha, a resposta toma a tela (óleo em corpo grande, os quatro filtros em
  monoespaçada) e a busca vira uma barra fina com a placa e um "trocar". A
  divergência entre catálogo e histórico da casa deve virar **duas opções
  lado a lado**, porque é ali que o atendente decide.
- **Seção Comunidade** (canal do WhatsApp): ideias de publicação tiradas dos
  próprios números da oficina, editor com prévia, histórico. O
  `canalWhatsapp` hoje é configuração morta — está gravado e nada o usa.
- **Ajudante de novidades**: tour que aparece uma vez por pessoa a cada versão
  grande. O texto vai **dentro do build** (cada versão descreve a si mesma), e
  o "já vi" vai no usuário, no banco. Nunca bloqueia: fecha no Esc, e "agora
  não" some pelo resto do dia.

**Falta na API** (nada disto é urgente, mas três destravam o que já existe):

| | O quê | Por quê |
|---|---|---|
| A | Custo da peça na ordem de serviço | Sem ele o "Sobrou" do Financeiro é uma subtração incompleta — o óleo e o filtro que saem do estoque não entram. A tela avisa isso em amarelo hoje. |
| B | Tabela de publicações do canal | Faz o "última publicação há 9 dias" e o histórico existirem |
| C | Rota que monta as ideias de publicação | Sem tabela nova: lê vencidos, óleos mais usados e clientes novos |
| D | Rota de IA para melhorar texto | **A chave fica na API, nunca no executável** — o app da oficina é um arquivo que qualquer um abre |
| E | Configurações da loja no banco (`nomeLoja`, `canalWhatsapp`) | Hoje vivem no build: a Farias não consegue mudar o próprio nome nem o próprio canal sem recompilar |
| F | Coluna de "última versão de novidades vista" no usuário | Para o ajudante aparecer uma vez por pessoa, não por computador |
| G | Placas e situação na lista de clientes | A lista devolve só a **quantidade** de veículos; mostrar a placa e a situação na linha precisa disso |

---

## 8. Como conferir antes de entregar

Depois de qualquer mudança de tela, rode os três:

```bash
npm ci          # npm install monta árvore misturada; o build morre falando de TypeScript
npm run build   # tem que fechar sem ERROR
```

**Auditoria de classe órfã** — classe usada no HTML e não definida no CSS:

```bash
cd src && python3 - <<'PY'
import re, pathlib, collections
css = pathlib.Path("styles.css").read_text(encoding="utf-8")
css += pathlib.Path("app/partes/sino/sino.component.css").read_text(encoding="utf-8")
definidas = set(re.findall(r'\.([a-zA-Z][\w-]*)', css))
usadas = collections.defaultdict(set)
for f in pathlib.Path("app").rglob("*.html"):
    t = f.read_text(encoding="utf-8")
    for m in re.findall(r'class="([^"{]*)"', t):
        for c in m.split():
            if c: usadas[c].add(f.name)
    for m in re.findall(r'\[class\.([\w-]+)\]', t): usadas[m].add(f.name)
for c, a in sorted((c, a) for c, a in usadas.items()
                   if c not in definidas and not c.startswith('bi')):
    print(f"ÓRFÃ .{c:<20} {', '.join(sorted(a))}")
PY
```

**Auditoria de token fantasma** — `var(--x)` sem `--x` definido:

```bash
cd src && python3 - <<'PY'
import re, pathlib, collections
css = pathlib.Path("styles.css").read_text(encoding="utf-8")
definidos = set(re.findall(r'(--[\w-]+)\s*:', css))
usados = collections.defaultdict(set)
for f in [pathlib.Path("styles.css")] + list(pathlib.Path("app").rglob("*.html")) \
         + list(pathlib.Path("app").rglob("*.css")):
    for m in re.findall(r'var\((--[\w-]+)', f.read_text(encoding="utf-8")):
        usados[m].add(f.name)
for v, a in sorted((v, a) for v, a in usados.items() if v not in definidos):
    print(f"FANTASMA {v:<16} {', '.join(sorted(a))}")
PY
```

**Contagem de estilo inline** — estava em 379, hoje em ~90, e a meta é zero:

```bash
grep -ro 'style="' --include=*.html src/app | wc -l
```

Nenhuma das três pode piorar numa entrega.

---

## 9. O prompt para dar a outra IA

> Leia o DESIGN.md do projeto inteiro antes de responder. Ele traz a paleta, os
> componentes prontos, a lista do que é proibido e as armadilhas deste código.
> Não invente token, não escreva cor em HTML nem em TypeScript, e não crie
> classe nova se já existe uma equivalente na seção 4. Ao terminar, rode as
> três auditorias da seção 8 e me diga o resultado. Se precisar de um dado que
> a API não devolve, diga isso em vez de inventar o número.

---

*Escrito em setembro de 2026, sobre a versão 1.0.11. Se a paleta ou a escala
mudarem, atualize as seções 3 e 4 no mesmo commit — um DESIGN.md desatualizado
é pior que nenhum, porque a IA seguinte confia nele.*
