/* Consulta de placa: a tela mais usada do balcão.
 *
 * O sistema SUGERE e o atendente confirma — por isso toda sugestão mostra de
 * onde veio e com que confiança. Código de filtro errado é peça errada no
 * motor do cliente.
 *
 * A tela tem dois caminhos, e o segundo é o que a Farias mais vai usar:
 *   1. a placa está no cadastro (ou numa consulta guardada) -> responde tudo;
 *   2. a placa é desconhecida -> o atendente digita o MODELO e a resposta sai
 *      igual, pelo catálogo Wega mais o histórico da própria oficina.
 * O caminho 2 não custa nada e funciona sem internet, que é a razão de ele
 * existir: consulta de placa boa exige CNPJ, e a oficina não tem. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap, catchError, of } from 'rxjs';
import { DadosService } from '../../nucleo/dados.service';
import { ConsultaPlaca, PrecisaModelo, ModeloSugerido, Veiculo, Servico } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { data, dinheiro, km, litros, placa as fPlaca, telefone, rotuloSituacao, haQuanto, trocouFiltroAr } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';
import { SeloComponent } from '../../partes/selo/selo.component';
import { ModalServicoComponent } from '../../partes/modal-servico/modal-servico.component';
import { PlacaMercosulComponent } from '../../partes/placa-mercosul/placa-mercosul.component';

import { EtiquetaService } from '../../nucleo/etiqueta.service';

@Component({
  selector: 'app-placa',
  standalone: true,
  imports: [FormsModule, RouterLink, SinoComponent, SeloComponent, ModalServicoComponent, PlacaMercosulComponent],
  templateUrl: './placa.component.html'
})
export class PlacaComponent implements OnInit {
  private dados = inject(DadosService);
  private router = inject(Router);
  private rota = inject(ActivatedRoute);
  private etiquetaService = inject(EtiquetaService);

  entrada = '';

  /* Chegar aqui por /placa/IVT4A19 já consulta, sem digitar de novo.
     A rota existia nos links (o painel, a tabela de últimas ordens) mas não
     existia no roteador: caía no curinga ** e voltava para o painel. Ou seja,
     clicar numa placa na lista de últimas ordens não levava a lugar nenhum. */
  ngOnInit(): void {
    const daRota = this.rota.snapshot.paramMap.get('placa');
    if (daRota) {
      this.entrada = daRota;
      this.buscar();
    }
  }
  buscando = signal(false);
  erro = signal<ErroApi | null>(null);
  r = signal<ConsultaPlaca | null>(null);

  intervaloPlaca(d: ConsultaPlaca): number {
    return this.etiquetaService.obterIntervalo(
      d.cadastro?.cliente_id,
      d.placa,
      d.oleo?.preferida || d.historico?.[0]?.oleo
    );
  }

  proximaTrocaEtiqueta(d: ConsultaPlaca): { km: number; intervalo: number } | null {
    const ultimoKm = d.cadastro?.ultimo_km ?? d.historico?.[0]?.km;
    if (!ultimoKm) return null;
    const intervalo = this.intervaloPlaca(d);
    const prox = this.etiquetaService.calcularProximaTroca(ultimoKm, intervalo);
    return prox ? { km: prox, intervalo } : null;
  }

  /* Resultados quando a busca é por nome do cliente */
  resultadosBusca = signal<Veiculo[]>([]);
  buscouPorNome = signal(false);

  /* Edição de histórico */
  servicoParaEditar = signal<Servico | null>(null);
  selo = signal<string | null>(null);

  /* caminho 2: a placa não é conhecida e o balcão vai dizer o modelo */
  precisa = signal<PrecisaModelo | null>(null);
  modelo = '';
  anoModelo: number | null = null;
  sugestoes = signal<ModeloSugerido[]>([]);
  buscandoModelo = signal(false);

  data = data; dinheiro = dinheiro; km = km; litros = litros;
  fPlaca = fPlaca; telefone = telefone;
  rotuloSituacao = rotuloSituacao; haQuanto = haQuanto; trocouFiltroAr = trocouFiltroAr;

  /* Autocompletar do modelo. O switchMap é o ponto: sem ele, a resposta de
     "cor" chegando depois da de "corolla" sobrescreveria a lista certa pela
     errada — e quem digita rápido veria a lista piscar para trás. */
  private digitou = new Subject<string>();

  constructor() {
    this.digitou.pipe(
      debounceTime(180),
      distinctUntilChanged(),
      switchMap(termo => {
        if (termo.trim().length < 2) return of({ modelos: [] as ModeloSugerido[] });
        this.buscandoModelo.set(true);
        return this.dados.buscarModelos(termo).pipe(
          catchError(() => of({ modelos: [] as ModeloSugerido[] })));
      })
    ).subscribe(res => {
      this.buscandoModelo.set(false);
      this.sugestoes.set(res.modelos || []);
    });
  }

  /** Aceita "abc1d23", "ABC-1234" e devolve no formato da API. */
  private limpar(v: string): string {
    return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private zerar(): void {
    this.erro.set(null); this.precisa.set(null); this.r.set(null);
    this.sugestoes.set([]); this.modelo = ''; this.anoModelo = null;
    this.resultadosBusca.set([]); this.buscouPorNome.set(false);
  }

  buscar(): void {
    const raw = this.entrada.trim();
    if (!raw) return;
    this.zerar();

    const p = this.limpar(raw);
    const ehPlaca = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p);

    if (ehPlaca) {
      this.consultarPlacaDireta(p);
    } else {
      // Busca unificada por nome do cliente ou placa parcial
      this.buscarPorNome(raw);
    }
  }

  consultarPlacaDireta(placaLimpa: string): void {
    this.buscando.set(true);
    this.dados.consultarPlaca(placaLimpa).subscribe({
      next: res => {
        this.buscando.set(false);
        /* A API responde 200 nos dois casos. Quem decide qual tela aparece é
           este campo, não o código HTTP: carro novo na oficina não é falha. */
        if ((res as PrecisaModelo).precisa_modelo) {
          this.precisa.set(res as PrecisaModelo);
        } else {
          this.r.set(res as ConsultaPlaca);
        }
      },
      error: (e: ErroApi) => { this.buscando.set(false); this.erro.set(e); }
    });
  }

  buscarPorNome(termo: string): void {
    this.buscando.set(true);
    this.dados.veiculos({ busca: termo, limite: 25 }).subscribe({
      next: res => {
        this.buscando.set(false);
        const lista = res.veiculos || [];
        if (lista.length === 1) {
          // Apenas 1 veículo correspondente: abre direto a consulta
          this.entrada = lista[0].placa;
          this.consultarPlacaDireta(this.limpar(lista[0].placa));
        } else if (lista.length > 1) {
          this.resultadosBusca.set(lista);
          this.buscouPorNome.set(true);
        } else {
          // Se não encontrou veículos, tenta buscar se é cliente sem veículo
          this.dados.clientes({ busca: termo, limite: 10 }).subscribe({
            next: cliRes => {
              const clientes = cliRes.clientes || [];
              if (clientes.length > 0) {
                this.erro.set({
                  status: 404,
                  mensagem: `Cliente "${clientes[0].nome}" localizado, mas sem veículo cadastrado.`,
                  detalhe: 'Acesse o cadastro do cliente para adicionar um veículo com placa.'
                });
              } else {
                this.erro.set({
                  status: 404,
                  mensagem: 'Nenhum resultado encontrado.',
                  detalhe: 'Não encontramos veículos ou clientes com esse nome ou placa.'
                });
              }
            },
            error: () => {
              this.erro.set({
                status: 404,
                mensagem: 'Nenhum veículo encontrado.',
                detalhe: 'Tente digitar a placa completa ou outro nome de cliente.'
              });
            }
          });
        }
      },
      error: (e: ErroApi) => { this.buscando.set(false); this.erro.set(e); }
    });
  }

  selecionarVeiculo(v: Veiculo): void {
    this.entrada = v.placa;
    this.resultadosBusca.set([]);
    this.buscouPorNome.set(false);
    this.consultarPlacaDireta(this.limpar(v.placa));
  }

  aoDigitarModelo(v: string): void {
    this.modelo = v;
    this.digitou.next(v);
  }

  escolher(m: ModeloSugerido): void {
    this.modelo = m.modelo;
    this.sugestoes.set([]);
    this.consultarModelo();
  }

  consultarModelo(): void {
    const m = this.modelo.trim();
    if (!m) return;
    this.erro.set(null);
    this.buscando.set(true);
    this.sugestoes.set([]);
    this.dados.consultarPorModelo({ modelo: m, ano: this.anoModelo }).subscribe({
      next: res => {
        this.buscando.set(false);
        /* Mantém a placa digitada na resposta: o atendente está atendendo
           ESTE carro, e é essa placa que vai para a ordem de serviço. */
        const p = this.precisa()?.placa || null;
        this.r.set({ ...res, placa: p as any });
      },
      error: (e: ErroApi) => { this.buscando.set(false); this.erro.set(e); }
    });
  }

  /** Volta de "resultado por modelo" para o campo de modelo, sem perder a placa. */
  trocarModelo(): void {
    this.r.set(null);
    this.sugestoes.set([]);
  }

  /** Tom da faixa de confiança — a tela precisa mostrar quando é chute. */
  tomConfianca(c?: number | null): string {
    if (c == null) return 'p-mute';
    if (c >= 75) return 'p-pos';
    if (c >= 45) return 'p-warn';
    return 'p-crit';
  }

  tomForca(f?: string): string {
    return f === 'alta' ? 'p-pos' : f === 'media' ? 'p-warn' : 'p-crit';
  }

  /** Texto da faixa de anos que o histórico da casa olhou. */
  faixaCasa(janela: number | null, ano: number | null): string {
    if (!janela || !ano) return 'de todos os anos';
    return `de ${ano - janela} a ${ano + janela}`;
  }

  abrirFicha(): void {
    const id = this.r()?.cadastro?.id;
    if (id) this.router.navigate(['/veiculo', id]);
  }

  novaOrdem(): void {
    const d = this.r();
    const qp: Record<string, any> = {
      placa: d?.placa || this.precisa()?.placa || ''
    };
    if (d?.oleo?.litros) qp['litros'] = d.oleo.litros;
    if (d?.oleo?.preferida || d?.oleo?.viscosidades?.[0]) {
      qp['oleo'] = d.oleo.preferida || d.oleo.viscosidades?.[0];
    } else if (d?.oleo?.recomendado?.texto) {
      qp['oleo'] = d.oleo.recomendado.texto;
    }
    this.router.navigate(['/ordem'], { queryParams: qp });
  }

  abrirEdicao(s: Servico): void {
    this.servicoParaEditar.set(s);
  }

  aoSalvarServico(atualizado: Servico): void {
    const cur = this.r();
    if (cur) {
      const hist = (cur.historico || []).map(item => item.id === atualizado.id ? atualizado : item);
      let cadastro = cur.cadastro;
      if (hist.length && hist[0].id === atualizado.id && cadastro) {
        cadastro = {
          ...cadastro,
          ultimo_km: atualizado.km ?? cadastro.ultimo_km,
          ultima_troca: atualizado.data ?? cadastro.ultima_troca
        };
      }
      this.r.set({ ...cur, historico: hist, cadastro });
    }
    this.selo.set('Atendimento atualizado com sucesso');
  }

  /* Leva para o cadastro tudo o que a tela acabou de mostrar: modelo, ano e os
     quatro códigos de filtro. Ordem de serviço exige veículo cadastrado, então
     este é o caminho de verdade para um carro novo — e é justamente aqui que
     redigitar um código de peça de memória custaria caro. */
  cadastrarEsta(): void {
    const d = this.r();
    const qp: Record<string, string | number> = {
      placa: this.precisa()?.placa || d?.placa || ''
    };
    if (d?.veiculo.marca) qp['marca'] = d.veiculo.marca;
    if (d?.veiculo.modelo) qp['modelo'] = d.veiculo.modelo;
    if (d?.veiculo.cilindrada) qp['cilindrada'] = d.veiculo.cilindrada;
    if (d?.veiculo.ano) qp['ano'] = d.veiculo.ano;
    /* Só o que o catálogo deu com confiança: sugestão fraca não entra no
       cadastro pré-preenchida, para ninguém salvar sem olhar. */
    if ((d?.filtros.confianca ?? 0) >= 45 || d?.filtros.status === 'cadastrado') {
      for (const i of d?.filtros.itens || []) {
        if (i.codigo) qp['filtro_' + i.tipo] = i.codigo;
      }
    }
    this.router.navigate(['/clientes/novo'], { queryParams: qp });
  }
}
