/* Catálogo técnico de Óleos e Filtros:
   Consulta técnica rápida de capacidade do cárter em litros,
   viscosidades recomendadas e códigos de filtros por modelo e motorização. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DadosService } from '../../nucleo/dados.service';
import { ItemCatalogoOleo, ItemCatalogoFiltro } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { litros } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';

export type AbaCatalogo = 'veiculo' | 'oleos' | 'filtros';

@Component({
  selector: 'app-catalogo',
  standalone: true,
  imports: [RouterLink, FormsModule, SinoComponent],
  templateUrl: './catalogo.component.html'
})
export class CatalogoComponent implements OnInit {
  private dados = inject(DadosService);
  private router = inject(Router);

  abaAtiva = signal<AbaCatalogo>('veiculo');
  carregando = signal(false);
  erro = signal<ErroApi | null>(null);

  // Totais do acervo
  totalOleos = signal(0);
  totalFiltros = signal(0);
  marcas = signal<string[]>([]);

  // Aba 1: Consulta Rápida por Modelo
  termoVeiculo = signal('');
  buscandoVeiculo = signal(false);
  resultadoVeiculo = signal<any | null>(null);
  modelosPopulares = [
    'Onix', 'Gol', 'HB20', 'Corolla', 'Civic', 'Ka', 'Compass',
    'Palio', 'Fox', 'Cruze', 'Renegade', 'Creta', 'Prisma', 'Fiesta'
  ];

  // Aba 2: Lista de Óleos e Cárter
  buscaOleo = signal('');
  marcaOleo = signal('');
  paginaOleo = signal(1);
  oleos = signal<ItemCatalogoOleo[]>([]);
  totalOleosFiltrados = signal(0);

  // Aba 3: Lista de Filtros Wega
  buscaFiltro = signal('');
  marcaFiltro = signal('');
  paginaFiltro = signal(1);
  filtros = signal<ItemCatalogoFiltro[]>([]);
  totalFiltrosFiltrados = signal(0);

  // Inteligência Artificial (Google Gemini)
  iaDisponivel = signal(false);
  consultandoIaOleo = signal(false);
  resultadoIaOleo = signal<any | null>(null);
  erroIaOleo = signal<string | null>(null);

  litros = litros;
  Math = Math;

  ngOnInit(): void {
    this.carregarResumo();
    this.buscarOleos();
    this.buscarFiltros();
    this.conferirIa();
  }

  conferirIa(): void {
    this.dados.iaStatus().subscribe({
      next: r => this.iaDisponivel.set(r.configurado),
      error: () => this.iaDisponivel.set(false)
    });
  }

  selecionarAba(aba: AbaCatalogo): void {
    this.abaAtiva.set(aba);
  }

  carregarResumo(): void {
    this.dados.catalogoResumo().subscribe({
      next: r => {
        this.totalOleos.set(r.totalOleos);
        this.totalFiltros.set(r.totalFiltros);
      },
      error: () => {}
    });
    this.dados.catalogoMarcas().subscribe({
      next: r => this.marcas.set(r.marcas || []),
      error: () => {}
    });
  }

  // --- Aba 1: Consulta por Modelo ---
  consultarVeiculo(modeloParam?: string): void {
    const termo = (modeloParam ?? this.termoVeiculo()).trim();
    if (!termo) return;
    if (modeloParam) this.termoVeiculo.set(modeloParam);

    this.buscandoVeiculo.set(true);
    this.erro.set(null);
    this.resultadoIaOleo.set(null);
    this.erroIaOleo.set(null);

    this.dados.consultarPorModelo({ modelo: termo }).subscribe({
      next: res => {
        this.resultadoVeiculo.set(res);
        this.buscandoVeiculo.set(false);
      },
      error: (e: ErroApi) => {
        this.erro.set(e);
        this.buscandoVeiculo.set(false);
      }
    });
  }

  consultarCapacidadeIa(veiculoParam?: any): void {
    const v = veiculoParam || this.resultadoVeiculo()?.veiculo || { modelo: this.termoVeiculo() };
    this.consultandoIaOleo.set(true);
    this.erroIaOleo.set(null);

    this.dados.iaConsultarCapacidadeOleo({
      modelo: v.modelo || this.termoVeiculo(),
      marca: v.marca,
      motor: v.cilindrada || v.motor,
      ano: v.ano
    }).subscribe({
      next: res => {
        this.resultadoIaOleo.set(res.ia);
        this.consultandoIaOleo.set(false);
        // Enriquece o resultado atual se estiver sem litros
        const atual = this.resultadoVeiculo();
        if (atual?.oleo && (!atual.oleo.litros || atual.oleo.litros === 0)) {
          atual.oleo.litros = res.ia.litros;
          if (!atual.oleo.recomendado) {
            atual.oleo.recomendado = { texto: res.ia.viscosidade_principal, fonte: 'Google Gemini IA' };
          }
          this.resultadoVeiculo.set({ ...atual });
        }
      },
      error: (e: ErroApi) => {
        this.erroIaOleo.set(e.mensagem || 'Não foi possível consultar a IA no momento.');
        this.consultandoIaOleo.set(false);
      }
    });
  }

  iniciarOrdemCom(modelo: string, litrosQtd?: number | null, oleoVisc?: string | null): void {
    const qp: Record<string, any> = { modelo };
    if (litrosQtd) qp['litros'] = litrosQtd;
    if (oleoVisc) qp['oleo'] = oleoVisc;
    this.router.navigate(['/ordem'], { queryParams: qp });
  }

  // --- Aba 2: Óleos ---
  buscarOleos(): void {
    this.carregando.set(true);
    this.dados.catalogoOleos({
      busca: this.buscaOleo(),
      marca: this.marcaOleo(),
      pagina: this.paginaOleo(),
      limite: 25
    }).subscribe({
      next: r => {
        this.oleos.set(r.itens);
        this.totalOleosFiltrados.set(r.total);
        this.carregando.set(false);
      },
      error: (e: ErroApi) => {
        this.erro.set(e);
        this.carregando.set(false);
      }
    });
  }

  filtrarOleo(): void {
    this.paginaOleo.set(1);
    this.buscarOleos();
  }

  proximaOleo(): void {
    this.paginaOleo.update(p => p + 1);
    this.buscarOleos();
  }

  anteriorOleo(): void {
    this.paginaOleo.update(p => Math.max(1, p - 1));
    this.buscarOleos();
  }

  // --- Aba 3: Filtros ---
  buscarFiltros(): void {
    this.carregando.set(true);
    this.dados.catalogoFiltros({
      busca: this.buscaFiltro(),
      marca: this.marcaFiltro(),
      pagina: this.paginaFiltro(),
      limite: 25
    }).subscribe({
      next: r => {
        this.filtros.set(r.itens);
        this.totalFiltrosFiltrados.set(r.total);
        this.carregando.set(false);
      },
      error: (e: ErroApi) => {
        this.erro.set(e);
        this.carregando.set(false);
      }
    });
  }

  filtrarFiltro(): void {
    this.paginaFiltro.set(1);
    this.buscarFiltros();
  }

  proximaFiltro(): void {
    this.paginaFiltro.update(p => p + 1);
    this.buscarFiltros();
  }

  anteriorFiltro(): void {
    this.paginaFiltro.update(p => Math.max(1, p - 1));
    this.buscarFiltros();
  }
}
