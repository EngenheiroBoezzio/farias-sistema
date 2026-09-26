/* Modal para edição de uma ordem/serviço do histórico.
   Permite ao atendente corrigir ou preencher quilometragem faltante,
   óleo, litros, data ou valor sem precisar refazer o atendimento. */
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DadosService } from '../../nucleo/dados.service';
import { Servico } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { num } from '../../nucleo/formato';

@Component({
  selector: 'app-modal-servico',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './modal-servico.component.html'
})
export class ModalServicoComponent implements OnInit {
  private dados = inject(DadosService);

  servico = input<Servico | null>(null);
  fechou = output<void>();
  salvou = output<Servico>();

  gravando = signal(false);
  erro = signal<ErroApi | null>(null);

  f = {
    km: null as number | null,
    data: '',
    oleo: '',
    litros: null as number | null,
    total: null as number | null,
    trocou_filtro_ar: false,
    valor_filtro_ar: null as number | null,
    valor_filtro_oleo: null as number | null,
    cod_filtro_oleo: '',
    cod_filtro_ar: '',
    cod_filtro_cabine: '',
    cod_filtro_combustivel: ''
  };

  ngOnInit(): void {
    const s = this.servico();
    if (s) {
      this.f.km = s.km ?? null;
      this.f.data = s.data ? String(s.data).slice(0, 10) : '';
      this.f.oleo = s.oleo || '';
      this.f.litros = s.litros != null ? num(s.litros) : null;
      this.f.total = s.total != null ? num(s.total) : null;
      const trocouAr = num(s.valor_filtro_ar) > 0 || Boolean(s.cod_filtro_ar && s.cod_filtro_ar.trim());
      this.f.trocou_filtro_ar = trocouAr;
      this.f.valor_filtro_ar = s.valor_filtro_ar != null && num(s.valor_filtro_ar) > 0 ? num(s.valor_filtro_ar) : null;
      this.f.valor_filtro_oleo = s.valor_filtro_oleo != null ? num(s.valor_filtro_oleo) : null;
      this.f.cod_filtro_oleo = s.cod_filtro_oleo || '';
      this.f.cod_filtro_ar = s.cod_filtro_ar || '';
      this.f.cod_filtro_cabine = s.cod_filtro_cabine || '';
      this.f.cod_filtro_combustivel = s.cod_filtro_combustivel || '';
    }
  }

  fechar(): void {
    this.fechou.emit();
  }

  salvar(): void {
    const s = this.servico();
    if (!s || this.gravando()) return;

    this.erro.set(null);
    this.gravando.set(true);

    const corpo: any = {};
    if (this.f.km != null) corpo.km = Number(this.f.km);
    if (this.f.data) corpo.data = this.f.data;
    if (this.f.oleo.trim()) corpo.oleo = this.f.oleo.trim();
    if (this.f.litros != null) corpo.litros = Number(this.f.litros);
    if (this.f.total != null) corpo.total = Number(this.f.total);
    if (this.f.cod_filtro_oleo.trim()) corpo.cod_filtro_oleo = this.f.cod_filtro_oleo.trim().toUpperCase();

    // Filtro de Ar: registra se trocou e seu valor
    if (this.f.trocou_filtro_ar) {
      if (this.f.valor_filtro_ar != null) corpo.valor_filtro_ar = Number(this.f.valor_filtro_ar);
      if (this.f.cod_filtro_ar.trim()) corpo.cod_filtro_ar = this.f.cod_filtro_ar.trim().toUpperCase();
    } else {
      corpo.valor_filtro_ar = 0;
      corpo.cod_filtro_ar = '';
    }

    if (this.f.cod_filtro_cabine.trim()) corpo.cod_filtro_cabine = this.f.cod_filtro_cabine.trim().toUpperCase();
    if (this.f.cod_filtro_combustivel.trim()) corpo.cod_filtro_combustivel = this.f.cod_filtro_combustivel.trim().toUpperCase();

    this.dados.editarServico(s.id, corpo).subscribe({
      next: res => {
        this.gravando.set(false);
        const atualizado: Servico = {
          ...s,
          ...res.servico,
          km: this.f.km,
          data: this.f.data || s.data,
          oleo: this.f.oleo || s.oleo,
          litros: this.f.litros ?? s.litros,
          total: this.f.total ?? s.total,
          valor_filtro_ar: this.f.trocou_filtro_ar ? (this.f.valor_filtro_ar ?? (s.valor_filtro_ar || 0)) : 0,
          cod_filtro_ar: this.f.trocou_filtro_ar ? (this.f.cod_filtro_ar || s.cod_filtro_ar) : ''
        };
        this.salvou.emit(atualizado);
        this.fechar();
      },
      error: (e: ErroApi) => {
        this.gravando.set(false);
        this.erro.set(e);
      }
    });
  }
}
