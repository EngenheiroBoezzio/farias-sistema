/* Adicionar um carro a um cliente que JÁ existe.
   Antes só dava para cadastrar carro junto com um cliente novo: quem trocava
   de carro ou trazia o carro da esposa virava um cliente duplicado.
   Os filtros ficam para a ficha do carro, como no resto do sistema. */
import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DadosService } from '../../nucleo/dados.service';
import { ErroApi } from '../../nucleo/api.service';
import { Veiculo } from '../../nucleo/tipos';
import { PlacaMercosulComponent } from '../placa-mercosul/placa-mercosul.component';

@Component({
  selector: 'app-modal-carro',
  standalone: true,
  imports: [FormsModule, PlacaMercosulComponent],
  templateUrl: './modal-carro.component.html'
})
export class ModalCarroComponent {
  private dados = inject(DadosService);

  clienteId = input.required<number>();
  clienteNome = input<string>('');
  fechou = output<void>();
  salvou = output<Veiculo>();

  enviando = signal(false);
  erro = signal<ErroApi | null>(null);
  tremer = signal(0);

  f = { placa: '', marca: '', modelo: '', ano: '', cilindrada: '' };

  placaLimpa(): string { return this.f.placa.toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  private falhar(e: ErroApi): void { this.erro.set(e); this.tremer.update(n => n + 1); }

  salvar(): void {
    if (this.enviando()) return;
    this.erro.set(null);
    const placa = this.placaLimpa();
    if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) {
      this.falhar({ status: 0, mensagem: 'Placa inválida. Use ABC1234 ou ABC1D23.' }); return;
    }
    const corpo: Record<string, unknown> = { cliente_id: this.clienteId(), placa };
    if (this.f.marca.trim()) corpo['marca'] = this.f.marca.trim();
    if (this.f.modelo.trim()) corpo['modelo'] = this.f.modelo.trim();
    if (String(this.f.ano).trim()) corpo['ano'] = String(this.f.ano).trim();
    if (this.f.cilindrada.trim()) corpo['cilindrada'] = this.f.cilindrada.trim();

    this.enviando.set(true);
    this.dados.criarVeiculo(corpo as any).subscribe({
      next: r => { this.enviando.set(false); this.salvou.emit(r.veiculo); },
      error: (e: ErroApi) => { this.enviando.set(false); this.falhar(e); }
    });
  }

  fechar(): void { if (!this.enviando()) this.fechou.emit(); }
}
