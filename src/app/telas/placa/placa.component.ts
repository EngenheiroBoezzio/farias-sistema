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
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap, catchError, of } from 'rxjs';
import { DadosService } from '../../nucleo/dados.service';
import { ConsultaPlaca, PrecisaModelo, ModeloSugerido } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { data, dinheiro, km, litros, placa as fPlaca, telefone, rotuloSituacao, haQuanto } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';

@Component({
  selector: 'app-placa',
  standalone: true,
  imports: [FormsModule, RouterLink, SinoComponent],
  templateUrl: './placa.component.html'
})
export class PlacaComponent {
  private dados = inject(DadosService);
  private router = inject(Router);

  entrada = '';
  buscando = signal(false);
  erro = signal<ErroApi | null>(null);
  r = signal<ConsultaPlaca | null>(null);

  /* caminho 2: a placa não é conhecida e o balcão vai dizer o modelo */
  precisa = signal<PrecisaModelo | null>(null);
  modelo = '';
  anoModelo: number | null = null;
  sugestoes = signal<ModeloSugerido[]>([]);
  buscandoModelo = signal(false);

  data = data; dinheiro = dinheiro; km = km; litros = litros;
  fPlaca = fPlaca; telefone = telefone;
  rotuloSituacao = rotuloSituacao; haQuanto = haQuanto;

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
  }

  buscar(): void {
    const p = this.limpar(this.entrada);
    this.zerar();

    if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p)) {
      this.erro.set({ status: 400, mensagem: 'Placa inválida.',
                      detalhe: 'Use o formato ABC1D23 ou ABC1234.' });
      return;
    }

    this.buscando.set(true);
    this.dados.consultarPlaca(p).subscribe({
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
    this.router.navigate(['/ordem'],
      { queryParams: { placa: this.r()?.placa || this.precisa()?.placa } });
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
