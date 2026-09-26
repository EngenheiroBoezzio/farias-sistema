/* Nova ordem de serviço.
   Começa pela placa: o carro traz consigo o óleo e os filtros, então o
   atendente digita menos e erra menos. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DadosService } from '../../nucleo/dados.service';
import { ConsultaPlaca, PrecisaModelo } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { dinheiro, km, data, placa as fPlaca, num, trocouFiltroAr } from '../../nucleo/formato';
import { SeloComponent } from '../../partes/selo/selo.component';
import { SinoComponent } from '../../partes/sino/sino.component';
import { PlacaMercosulComponent } from '../../partes/placa-mercosul/placa-mercosul.component';

import { EtiquetaService, INTERVALOS_COMUNS } from '../../nucleo/etiqueta.service';

@Component({
  selector: 'app-ordem',
  standalone: true,
  imports: [FormsModule, RouterLink, SeloComponent, SinoComponent, PlacaMercosulComponent],
  templateUrl: './ordem.component.html'
})
export class OrdemComponent implements OnInit {
  private dados = inject(DadosService);
  private rota = inject(ActivatedRoute);
  private router = inject(Router);
  private etiquetaService = inject(EtiquetaService);

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
    valor_filtro_oleo: null as number | null,
    valor_filtro_ar: null as number | null,
    cod_filtro_oleo: '',
    cod_filtro_ar: '',
    cod_filtro_cabine: '',
    cod_filtro_combustivel: ''
  };

  dinheiro = dinheiro; km = km; data = data; fPlaca = fPlaca;

  ngOnInit(): void {
    const p = this.rota.snapshot.queryParamMap.get('placa');
    if (p) { this.entrada = p; this.buscar(); }
  }

  buscar(): void {
    const p = this.entrada.toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.erro.set(null); this.naoAchou.set(null); this.carro.set(null);
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
  somaItens(): number {
    return num(this.f.valor_filtro_oleo as any) + num(this.f.valor_filtro_ar as any);
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
      valor_filtro_oleo: this.f.valor_filtro_oleo ?? undefined,
      valor_filtro_ar: this.f.valor_filtro_ar ?? undefined,
      cod_filtro_oleo: this.f.cod_filtro_oleo || undefined,
      cod_filtro_ar: this.f.cod_filtro_ar || undefined,
      cod_filtro_cabine: this.f.cod_filtro_cabine || undefined,
      cod_filtro_combustivel: this.f.cod_filtro_combustivel || undefined
    }).subscribe({
      next: r => {
        this.enviando.set(false);
        // o servidor avisa quando o km andou para trás — quase sempre é digitação
        if (r.aviso) this.aviso.set(r.aviso);
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

  aoFechar(): void {
    this.selo.set(null);
    if (this.aviso()) return;          // deixa o aviso de km na tela
    this.entrada = ''; this.carro.set(null);
    this.origemLitros.set(null); this.origemOleo.set(null);
    this.statusUltimoFiltroAr.set(null);
    this.intervaloEtiqueta.set(7000);
    this.modoCustomIntervalo.set(false);
    this.f = { km: null, oleo: '', litros: null, total: null,
               valor_filtro_oleo: null, valor_filtro_ar: null,
               cod_filtro_oleo: '', cod_filtro_ar: '',
               cod_filtro_cabine: '', cod_filtro_combustivel: '' };
  }
}
