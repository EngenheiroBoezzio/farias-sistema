/* Modal para lançamento e edição de despesas da oficina. */
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { CategoriaDespesa, Despesa, ROTULOS_CATEGORIAS, StatusDespesa } from '../../nucleo/financeiro.service';

@Component({
  selector: 'app-modal-despesa',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './modal-despesa.component.html'
})
export class ModalDespesaComponent implements OnInit {
  @Input() despesa?: Despesa | null = null;
  @Output() fechou = new EventEmitter<void>();
  @Output() salvou = new EventEmitter<Omit<Despesa, 'id' | 'criadaEm'>>();

  readonly rotulosCategorias = ROTULOS_CATEGORIAS;
  readonly categorias: CategoriaDespesa[] = ['fixa', 'pessoal', 'insumos', 'operacional', 'impostos', 'outros'];

  f = {
    descricao: '',
    valor: null as number | null,
    categoria: 'fixa' as CategoriaDespesa,
    dataVencimento: '',
    status: 'pago' as StatusDespesa,
    recorrente: false,
    obs: ''
  };

  atalhosRapidos = [
    { label: 'Aluguel Galpão', cat: 'fixa' as CategoriaDespesa, valor: 2800, rec: true },
    { label: 'Energia Elétrica', cat: 'fixa' as CategoriaDespesa, valor: 650, rec: true },
    { label: 'Água / Saneamento', cat: 'fixa' as CategoriaDespesa, valor: 180, rec: true },
    { label: 'Internet Fibra', cat: 'fixa' as CategoriaDespesa, valor: 149.90, rec: true },
    { label: 'Contabilidade', cat: 'fixa' as CategoriaDespesa, valor: 550, rec: true },
    { label: 'Tambor de Óleo (200L)', cat: 'insumos' as CategoriaDespesa, valor: 5800, rec: false },
    { label: 'Filtros Wega / Tecfil', cat: 'insumos' as CategoriaDespesa, valor: 2400, rec: false },
    { label: 'Salário / Folha', cat: 'pessoal' as CategoriaDespesa, valor: 2500, rec: true },
    { label: 'Taxa Máquina Cartão', cat: 'operacional' as CategoriaDespesa, valor: 350, rec: true }
  ];

  ngOnInit(): void {
    if (this.despesa) {
      this.f = {
        descricao: this.despesa.descricao,
        valor: this.despesa.valor,
        categoria: this.despesa.categoria,
        dataVencimento: this.despesa.dataVencimento,
        status: this.despesa.status,
        recorrente: this.despesa.recorrente,
        obs: this.despesa.obs || ''
      };
    } else {
      const hoje = new Date().toISOString().slice(0, 10);
      this.f.dataVencimento = hoje;
    }
  }

  aplicarAtalho(a: typeof this.atalhosRapidos[0]): void {
    this.f.descricao = a.label;
    this.f.categoria = a.cat;
    this.f.valor = a.valor;
    this.f.recorrente = a.rec;
  }

  salvar(): void {
    if (!this.f.descricao.trim() || this.f.valor == null || this.f.valor <= 0) {
      alert('Informe a descrição e um valor válido para a despesa.');
      return;
    }

    this.salvou.emit({
      descricao: this.f.descricao.trim(),
      valor: Number(this.f.valor),
      categoria: this.f.categoria,
      dataVencimento: this.f.dataVencimento || new Date().toISOString().slice(0, 10),
      status: this.f.status,
      recorrente: this.f.recorrente,
      obs: this.f.obs.trim() || undefined
    });
  }
}
