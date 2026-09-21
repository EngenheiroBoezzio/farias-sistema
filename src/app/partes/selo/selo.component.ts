/* O selo de confirmação: anel que fecha em volta da logo da Farias.
   Aparece quando algo foi gravado de verdade — não é decoração, é a resposta
   do sistema ao atendente de que a ordem entrou. */
import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-selo',
  standalone: true,
  templateUrl: './selo.component.html'
})
export class SeloComponent {
  titulo = input.required<string>();
  linha = input<string>('');
  valor = input<string>('');
  meta = input<string>('');
  /** ms até sumir sozinho; 0 deixa aberto até clicarem */
  duracao = input<number>(2600);

  fechou = output<void>();

  private timer?: any;

  ngOnInit(): void {
    if (this.duracao() > 0)
      this.timer = setTimeout(() => this.fechar(), this.duracao());
  }
  ngOnDestroy(): void { clearTimeout(this.timer); }

  fechar(): void { clearTimeout(this.timer); this.fechou.emit(); }
}
