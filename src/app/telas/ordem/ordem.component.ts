/* Nova ordem de serviço.
   Começa pela placa: o carro traz consigo o óleo e os filtros, então o
   atendente digita menos e erra menos. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DadosService } from '../../nucleo/dados.service';
import { ConsultaPlaca, PrecisaModelo, PrecoItem, TipoPreco } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { dinheiro, km, data, placa as fPlaca, num, trocouFiltroAr } from '../../nucleo/formato';
import { SeloComponent } from '../../partes/selo/selo.component';
import { SinoComponent } from '../../partes/sino/sino.component';
import { PlacaMercosulComponent } from '../../partes/placa-mercosul/placa-mercosul.component';
import { ComprovanteComponent, DadosComprovante } from '../../partes/comprovante/comprovante.component';
import { ConfigService } from '../../nucleo/config.service';

import { EtiquetaService, INTERVALOS_COMUNS } from '../../nucleo/etiqueta.service';

@Component({
  selector: 'app-ordem',
  standalone: true,
  imports: [FormsModule, RouterLink, SeloComponent, SinoComponent, PlacaMercosulComponent,
            ComprovanteComponent],
  templateUrl: './ordem.component.html'
})
export class OrdemComponent implements OnInit {
  private dados = inject(DadosService);
  private rota = inject(ActivatedRoute);
  private router = inject(Router);
  private etiquetaService = inject(EtiquetaService);
  private cfg = inject(ConfigService);

  /* Guardado depois de gravar, e não montado na hora de abrir o modal: o
     formulário é limpo assim que a ordem entra, e montar o comprovante a
     partir dele depois pegaria os campos já vazios. */
  comprovante = signal<DadosComprovante | null>(null);
  mostrarComprovante = signal(false);

  entrada = '';
  carro = signal<ConsultaPlaca | null>(null);
  buscando = signal(false);
  enviando = signal(false);
  erro = signal<ErroApi | null>(null);
  naoAchou = signal<string | null>(null);
  selo = signal<{ titulo: string; linha: string; valor: string; meta: string } | null>(null);
  aviso = signal<string | null>(null);
  origemLitros = signal<string | null>(null);
  origemOleo = signal<string | null>(null);
  statusUltimoFiltroAr = signal<{ trocou: boolean; data: string | null } | null>(null);

  trocouFiltroAr = trocouFiltroAr;

  readonly intervalosComuns = INTERVALOS_COMUNS;
  intervaloEtiqueta = signal<number>(7000);
  modoCustomIntervalo = signal<boolean>(false);
  salvarComoPadrao = signal<boolean>(true);

  f = {
    km: null as number | null,
    oleo: '',
    litros: null as number | null,
    total: null as number | null,
    valor_oleo: null as number | null,
    valor_filtro_oleo: null as number | null,
    valor_filtro_ar: null as number | null,
    valor_filtro_cabine: null as number | null,
    valor_filtro_combustivel: null as number | null,
    cod_filtro_oleo: '',
    cod_filtro_ar: '',
    cod_filtro_cabine: '',
    cod_filtro_combustivel: ''
  };

  /* Os quatro filtros, na ordem em que o balcão pensa neles.

     O de óleo vem marcado quando o catálogo devolve um código: numa troca de
     óleo ele é trocado quase sempre, e deixar desmarcado faria o atendente
     marcar de novo em toda ordem. Os outros três começam desmarcados — são
     venda, e venda se decide com o carro na frente, não por padrão do
     sistema. Tudo continua editável: a sugestão não vira imposição. */
  readonly FILTROS = [
    { chave: 'oleo' as const,        rotulo: 'Filtro de óleo',        tipo: 'filtro_oleo' as TipoPreco,        exemplo: 'WO170' },
    { chave: 'ar' as const,          rotulo: 'Filtro de ar',          tipo: 'filtro_ar' as TipoPreco,          exemplo: 'FAP5303' },
    { chave: 'cabine' as const,      rotulo: 'Filtro de cabine',      tipo: 'filtro_cabine' as TipoPreco,      exemplo: 'AKX1215' },
    { chave: 'combustivel' as const, rotulo: 'Filtro de combustível', tipo: 'filtro_combustivel' as TipoPreco, exemplo: 'FCI1630' }
  ];

  trocar: Record<'oleo' | 'ar' | 'cabine' | 'combustivel', boolean> =
    { oleo: false, ar: false, cabine: false, combustivel: false };

  /* A lista de preços inteira vem de uma vez, no início, e fica na memória.

     Perguntar o custo ao servidor a cada tecla digitada num código de peça
     encheria a rede de pedidos e deixaria o número piscando enquanto o
     atendente digita. A lista da oficina tem dezenas de itens, não milhares:
     cabe na memória e responde na hora. */
  precos = signal<PrecoItem[]>([]);
  precosCarregados = signal(false);

  dinheiro = dinheiro; km = km; data = data; fPlaca = fPlaca;

  /** O item da lista de preços, ou null quando aquele óleo/peça não foi cadastrado. */
  preco(tipo: TipoPreco, chave: string | null | undefined): PrecoItem | null {
    const c = String(chave || '').trim().toUpperCase();
    if (!c) return null;
    return this.precos().find(i => i.tipo === tipo && i.chave.toUpperCase() === c) || null;
  }

  /* Custo do óleo = custo por litro x litros. É o único item que depende da
     quantidade, e ignorar isso faria uma troca de 3,5 L custar o mesmo que
     uma de 5 L — no item mais caro da ordem. */
  custoOleo(): number | null {
    const p = this.preco('oleo', this.f.oleo);
    if (!p || p.custo == null) return null;
    const unit = num(p.custo as any);
    if (p.unidade !== 'litro') return unit;
    const l = num(this.f.litros as any);
    return l > 0 ? Math.round(unit * l * 100) / 100 : null;
  }

  custoFiltro(chave: 'oleo' | 'ar' | 'cabine' | 'combustivel'): number | null {
    if (!this.trocar[chave]) return null;
    const def = this.FILTROS.find(f => f.chave === chave)!;
    const cod = (this.f as any)['cod_filtro_' + chave];
    const p = this.preco(def.tipo, cod);
    return p && p.custo != null ? num(p.custo as any) : null;
  }

  /** Quanto a oficina pagou pelo que entrou nesta ordem. */
  custoTotal(): number {
    return num(this.custoOleo() as any)
         + this.FILTROS.reduce((s, f) => s + num(this.custoFiltro(f.chave) as any), 0);
  }

  /* Verdadeiro quando ALGUM item da ordem não tem custo cadastrado. A margem
     então está incompleta, e a tela tem que dizer isso em vez de mostrar um
     número que parece exato. Custo faltando não é custo zero. */
  custoIncompleto(): boolean {
    const oleoFalta = !!String(this.f.oleo || '').trim() && this.custoOleo() == null;
    const filtroFalta = this.FILTROS.some(f => {
      if (!this.trocar[f.chave]) return false;
      const cod = (this.f as any)['cod_filtro_' + f.chave];
      return !!String(cod || '').trim() && this.custoFiltro(f.chave) == null;
    });
    return oleoFalta || filtroFalta;
  }

  /** O que sobra do total depois do que a oficina pagou pelas peças. */
  margem(): number {
    return num(this.f.total as any) - this.custoTotal();
  }

  private carregarPrecos(): void {
    this.dados.precos().subscribe({
      next: r => { this.precos.set(r.itens || []); this.precosCarregados.set(true); },
      /* API velha sem a rota, ou servidor fora: a ordem continua sendo
         lançada normalmente, só sem mostrar custo. Nunca travar o balcão por
         causa de um número de gestão. */
      error: () => { this.precos.set([]); this.precosCarregados.set(true); }
    });
  }

  ngOnInit(): void {
    this.carregarPrecos();
    const p = this.rota.snapshot.queryParamMap.get('placa');
    if (p) { this.entrada = p; this.buscar(); }
  }

  buscar(): void {
    const p = this.entrada.toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.erro.set(null); this.naoAchou.set(null); this.carro.set(null);
    /* Outro carro, outro atendimento: o comprovante do anterior sai da tela
       aqui, e não quando o selo fecha. */
    this.comprovante.set(null); this.mostrarComprovante.set(false);
    if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p)) {
      this.erro.set({ status: 400, mensagem: 'Placa inválida.',
                      detalhe: 'Use o formato ABC1D23 ou ABC1234.' });
      return;
    }
    this.buscando.set(true);
    this.dados.consultarPlaca(p).subscribe({
      next: r => {
        this.buscando.set(false);
        /* A consulta de placa passou a responder 200 também para placa
           desconhecida, pedindo o modelo. Aqui, na ordem de serviço, não há
           tela de escolher modelo — então isto vira "não achou" e o atendente
           digita à mão, a não ser que ele JÁ tenha escolhido o modelo na tela
           de consulta e chegado aqui pelo botão "Lançar ordem". */
        if ((r as PrecisaModelo).precisa_modelo) { this.naoAchou.set(p); return; }
        this.carro.set(r as ConsultaPlaca);
        this.preencher(r as ConsultaPlaca);
      },
      error: (e: ErroApi) => {
        this.buscando.set(false);
        this.erro.set(e);
      }
    });
  }

  /* Puxa o que o sistema já sabe, mas deixa tudo editável: a sugestão não
     pode virar imposição. */
  private preencher(r: ConsultaPlaca): void {
    const qpLitros = this.rota.snapshot.queryParamMap.get('litros');
    const qpOleo = this.rota.snapshot.queryParamMap.get('oleo');

    // 1. Óleo: QueryParam > Preferida > Catálogo viscosidades > Recomendado > Histórico da loja
    if (qpOleo) {
      this.f.oleo = qpOleo;
      this.origemOleo.set('Sugerido na consulta');
    } else if (r.oleo?.preferida) {
      this.f.oleo = r.oleo.preferida;
      this.origemOleo.set('Preferência deste veículo');
    } else if (r.oleo?.viscosidades?.[0]) {
      this.f.oleo = r.oleo.viscosidades[0];
      this.origemOleo.set(r.oleo.origem || 'Catálogo');
    } else if (r.oleo?.recomendado?.texto) {
      this.f.oleo = r.oleo.recomendado.texto;
      this.origemOleo.set(r.oleo.recomendado.fonte || 'Recomendado');
    } else if (r.historico?.[0]?.oleo) {
      this.f.oleo = r.historico[0].oleo;
      this.origemOleo.set('Última troca deste carro');
    } else {
      this.f.oleo = '';
      this.origemOleo.set(null);
    }

    // 2. Litros: QueryParam > Catálogo > Histórico do carro > Na casa
    const numQp = qpLitros ? num(qpLitros) : 0;
    const numCatalogo = r.oleo?.litros != null ? num(r.oleo.litros) : 0;
    const ultimaTrocaComLitros = r.historico?.find(h => h.litros != null && num(h.litros) > 0);
    const numHist = ultimaTrocaComLitros ? num(ultimaTrocaComLitros.litros) : 0;

    if (numQp > 0) {
      this.f.litros = numQp;
      this.origemLitros.set(`Sugerido: ${numQp} L`);
    } else if (numCatalogo > 0) {
      this.f.litros = numCatalogo;
      this.origemLitros.set(`Capacidade no catálogo: ${numCatalogo} L`);
    } else if (numHist > 0) {
      this.f.litros = numHist;
      this.origemLitros.set(`Última troca deste carro: ${numHist} L`);
    } else {
      this.f.litros = null;
      this.origemLitros.set(null);
    }

    // 3. Filtros
    for (const i of r.filtros?.itens ?? []) {
      if (i.tipo === 'oleo') this.f.cod_filtro_oleo = i.codigo;
      if (i.tipo === 'ar') this.f.cod_filtro_ar = i.codigo;
      if (i.tipo === 'cabine') this.f.cod_filtro_cabine = i.codigo;
      if (i.tipo === 'combustivel') this.f.cod_filtro_combustivel = i.codigo;
    }
    this.trocar = { oleo: !!this.f.cod_filtro_oleo, ar: false,
                    cabine: false, combustivel: false };
    this.aplicarPrecosDeVenda();

    // 4. Status do Filtro de Ar na última manutenção
    const ult = r.historico?.[0];
    if (ult) {
      this.statusUltimoFiltroAr.set({
        trocou: trocouFiltroAr(ult),
        data: ult.data
      });
    } else {
      this.statusUltimoFiltroAr.set(null);
    }

    // 5. Preferência de intervalo para a etiqueta de próxima troca
    const intSalvo = this.etiquetaService.obterIntervalo(r.cadastro?.cliente_id, r.placa, this.f.oleo);
    this.intervaloEtiqueta.set(intSalvo);
    this.modoCustomIntervalo.set(!this.intervalosComuns.includes(intSalvo));
  }

  /* Preenche o que a oficina COSTUMA cobrar, da lista de preços.

     Só preenche campo vazio: se o atendente já digitou um valor, ele sabe de
     alguma coisa que a lista não sabe — desconto combinado, peça de outra
     marca — e sobrescrever isso seria o sistema discordando de quem está com
     o cliente na frente. */
  /* O último valor que ESTE código preencheu sozinho, por campo.

     Serve para uma coisa só: saber se o número que está na tela foi posto
     pelo sistema ou digitado por uma pessoa. Enquanto for o do sistema, pode
     ser recalculado à vontade quando o óleo, os litros ou o código mudarem.
     No instante em que alguém digita por cima, o campo passa a ser dela e
     nada mais mexe ali — desconto combinado com o cliente não pode ser
     desfeito por uma tabela. */
  private autoPreenchido: Record<string, number | null> = {};

  private podeAutoPreencher(campo: string): boolean {
    const atual = (this.f as any)[campo];
    return atual == null || atual === this.autoPreenchido[campo];
  }

  private porItem(campo: string, v: number | null): void {
    if (!this.podeAutoPreencher(campo)) return;
    (this.f as any)[campo] = v;
    this.autoPreenchido[campo] = v;
  }

  aplicarPrecosDeVenda(): void {
    const po = this.preco('oleo', this.f.oleo);
    if (po && po.venda != null) {
      const unit = num(po.venda as any);
      const l = num(this.f.litros as any);
      const v = po.unidade === 'litro' ? (l > 0 ? unit * l : null) : unit;
      if (v != null) this.porItem('valor_oleo', Math.round(v * 100) / 100);
    }
    for (const def of this.FILTROS) {
      const campo = 'valor_filtro_' + def.chave;
      if (!this.trocar[def.chave]) continue;
      const p = this.preco(def.tipo, (this.f as any)['cod_filtro_' + def.chave]);
      if (p && p.venda != null) this.porItem(campo, num(p.venda as any));
    }
  }

  /** Óleo ou litros mudaram: o valor sugerido do óleo é outro. */
  aoMudarOleo(): void { this.aplicarPrecosDeVenda(); }

  /* Marcar "trocar agora" já traz o preço daquele filtro. Desmarcar apaga o
     valor: filtro que não entrou no carro não pode continuar somando no
     total, e deixar o número lá esperando alguém reparar é como se cobra a
     mais sem querer. */
  alternarFiltro(chave: 'oleo' | 'ar' | 'cabine' | 'combustivel'): void {
    this.trocar[chave] = !this.trocar[chave];
    const campo = 'valor_filtro_' + chave;
    if (this.trocar[chave]) {
      this.aplicarPrecosDeVenda();
    } else {
      (this.f as any)[campo] = null;
      this.autoPreenchido[campo] = null;
    }
  }

  /* Acessos por nome de campo. O template precisa ler e escrever
     `cod_filtro_ar`, `valor_filtro_cabine` e companhia a partir do laço dos
     quatro filtros, e indexar um objeto tipado direto no HTML não compila. */
  codDe(chave: string): string { return (this.f as any)['cod_filtro_' + chave] || ''; }
  setCod(chave: string, v: string): void {
    (this.f as any)['cod_filtro_' + chave] = (v || '').toUpperCase();
    /* Trocar o código é trocar a peça: o preço da lista vira outro. Sem isto,
       marcar "trocar agora" e só depois digitar o código — que é a ordem
       natural no balcão — deixava o valor vazio. */
    this.aplicarPrecosDeVenda();
  }
  valorDe(chave: string): number | null { return (this.f as any)['valor_filtro_' + chave]; }
  setValor(chave: string, v: number | null): void {
    (this.f as any)['valor_filtro_' + chave] = v;
  }

  selecionarIntervalo(v: number): void {
    this.intervaloEtiqueta.set(v);
    this.modoCustomIntervalo.set(false);
  }

  ativarCustomIntervalo(): void {
    this.modoCustomIntervalo.set(true);
  }

  proximaTrocaKm(): number | null {
    return this.etiquetaService.calcularProximaTroca(this.f.km, this.intervaloEtiqueta());
  }

  /** Soma do que foi digitado, para conferir contra o total. */
  /* O que já está discriminado na ordem. NÃO é o total: falta a mão de obra,
     e é justamente por isso que a tela mostra os dois lados em vez de
     preencher o total sozinha. Somar por conta própria e cobrar a menos é um
     erro que só aparece no fim do mês. */
  somaItens(): number {
    return num(this.f.valor_oleo as any)
         + this.FILTROS.reduce((s, def) => s + (this.trocar[def.chave]
             ? num((this.f as any)['valor_filtro_' + def.chave]) : 0), 0);
  }

  /** Quanto do total ainda não foi discriminado — mão de obra e o que mais houver. */
  restoDoTotal(): number {
    return num(this.f.total as any) - this.somaItens();
  }

  salvar(): void {
    const c = this.carro();
    if (!c || this.enviando()) return;
    this.erro.set(null); this.aviso.set(null);

    if (this.f.total == null || this.f.total <= 0) {
      this.erro.set({ status: 400, mensagem: 'Informe o total da ordem.' });
      return;
    }

    const prox = this.proximaTrocaKm();
    const intAtual = this.intervaloEtiqueta();

    if (this.salvarComoPadrao()) {
      this.etiquetaService.salvarIntervalo(intAtual, c.cadastro?.cliente_id, c.placa);
    }

    this.enviando.set(true);
    this.dados.registrarServico({
      placa: c.placa,
      km: this.f.km ?? undefined,
      oleo: this.f.oleo || undefined,
      litros: this.f.litros ?? undefined,
      total: this.f.total,
      valor_oleo: this.f.valor_oleo ?? undefined,
      /* Filtro não marcado não vai NADA: nem código, nem valor.

         `cod_filtro_*` na ordem quer dizer "esta peça entrou neste carro". O
         catálogo sugere os quatro códigos sempre, e gravar todos faria o
         histórico dizer que o carro trocou quatro filtros quando trocou um —
         e a fila de recuperação lê exatamente isso para saber o que sugerir
         na próxima visita. */
      ...this.camposDosFiltros()
    }).subscribe({
      next: r => {
        this.enviando.set(false);
        // o servidor avisa quando o km andou para trás — quase sempre é digitação
        if (r.aviso) this.aviso.set(r.aviso);
        this.comprovante.set(this.montarComprovante(c, r.id ?? null, prox));
        const metaEtiqueta = prox ? ` · Etiqueta: ${km(prox)} (+${km(intAtual)})` : '';
        this.selo.set({
          titulo: 'Ordem registrada',
          linha: `${c.cadastro?.cliente ?? ''} · ${fPlaca(c.placa)}`,
          valor: dinheiro(this.f.total),
          meta: `${this.f.oleo || 'óleo não informado'} · ${km(this.f.km)}${metaEtiqueta}`
        });
      },
      error: (e: ErroApi) => { this.enviando.set(false); this.erro.set(e); }
    });
  }

  /* O comprovante leva só o que o CLIENTE precisa reconhecer: o que entrou no
     carro, quanto custou e quando voltar. Custo e margem ficam de fora — são
     conta da oficina, e mandar isso no WhatsApp de quem pagou seria entregar
     a margem para a concorrência junto com o recibo. */
  private montarComprovante(c: ConsultaPlaca, id: number | null,
                            prox: number | null): DadosComprovante {
    const itens = [];
    if (this.f.oleo || this.f.valor_oleo != null) {
      itens.push({
        nome: 'Óleo ' + (this.f.oleo || ''),
        detalhe: this.f.litros ? `${this.f.litros} L` : undefined,
        valor: this.f.valor_oleo
      });
    }
    for (const def of this.FILTROS) {
      if (!this.trocar[def.chave]) continue;
      itens.push({
        nome: def.rotulo,
        detalhe: this.codDe(def.chave) || undefined,
        valor: this.valorDe(def.chave)
      });
    }
    const total = num(this.f.total as any);
    const mao = Math.max(0, Math.round((total - this.somaItens()) * 100) / 100);
    return {
      loja: this.cfg.nomeLoja,
      numero: id,
      data: new Date().toISOString().slice(0, 10),
      placa: c.placa,
      modelo: c.veiculo?.modelo ?? null,
      cliente: c.cadastro?.cliente || 'Cliente',
      telefone: c.cadastro?.telefone ?? null,
      km: this.f.km,
      itens,
      maoDeObra: mao,
      total,
      proximaTroca: prox
    };
  }

  /** Só o que foi realmente trocado: código e valor, por filtro marcado. */
  private camposDosFiltros(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const def of this.FILTROS) {
      if (!this.trocar[def.chave]) continue;
      const cod = (this.f as any)['cod_filtro_' + def.chave];
      const val = (this.f as any)['valor_filtro_' + def.chave];
      if (cod) out['cod_filtro_' + def.chave] = cod;
      if (val != null) out['valor_filtro_' + def.chave] = val;
    }
    return out;
  }

  aoFechar(): void {
    this.selo.set(null);
    if (this.aviso()) return;          // deixa o aviso de km na tela
    this.entrada = ''; this.carro.set(null);
    this.origemLitros.set(null); this.origemOleo.set(null);
    this.statusUltimoFiltroAr.set(null);
    this.intervaloEtiqueta.set(7000);
    this.modoCustomIntervalo.set(false);
    this.f = { km: null, oleo: '', litros: null, total: null,
               valor_oleo: null,
               valor_filtro_oleo: null, valor_filtro_ar: null,
               valor_filtro_cabine: null, valor_filtro_combustivel: null,
               cod_filtro_oleo: '', cod_filtro_ar: '',
               cod_filtro_cabine: '', cod_filtro_combustivel: '' };
    this.trocar = { oleo: false, ar: false, cabine: false, combustivel: false };
    this.autoPreenchido = {};
    /* O comprovante NÃO é limpo aqui.

       Este método roda quando o selo de confirmação se fecha sozinho, 2,6
       segundos depois de gravar — e limpar junto fazia a oferta do
       comprovante aparecer e sumir antes de alguém ler. Ele fica até a
       próxima busca de placa, que é quando o atendimento realmente virou
       outro. */
  }
}
