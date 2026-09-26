import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { DadosService } from '../../nucleo/dados.service';
import { Cliente, Painel } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { telefone, data, inteiro } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';

/* Quantos cabem numa página. Estava escrito 50 em dois lugares e o rodapé
   dizia "50 de 1284" sem dizer QUAIS 50. */
const POR_PAGINA = 50;

@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [FormsModule, RouterLink, SinoComponent],
  templateUrl: './clientes.component.html'
})
export class ClientesComponent implements OnInit {
  private dados = inject(DadosService);
  private digitou = new Subject<string>();

  busca = '';
  carregando = signal(true);
  erro = signal<ErroApi | null>(null);
  lista = signal<Cliente[]>([]);
  total = signal(0);
  pagina = signal(1);

  telefone = telefone; data = data; inteiro = inteiro;

  /* O resumo vem do mesmo endereço que alimenta o painel. Nenhum destes
     números é calculado aqui: "com telefone" e "vencido" já existem prontos,
     e repetir a conta no front seria uma segunda verdade para manter. */
  resumo = signal<Painel['resumo'] | null>(null);

  primeiroDaPagina = computed(() =>
    this.total() === 0 ? 0 : (this.pagina() - 1) * POR_PAGINA + 1);
  ultimoDaPagina = computed(() =>
    Math.min(this.pagina() * POR_PAGINA, this.total()));
  totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.total() / POR_PAGINA)));

  percentual(parte: number, todo: number): string {
    if (!todo) return '0%';
    return Math.round(parte / todo * 100) + '%';
  }

  ngOnInit(): void {
    this.dados.painel().subscribe({
      next: p => this.resumo.set(p.resumo),
      error: () => { /* a faixa some e a lista continua funcionando */ }
    });

    // espera a pessoa parar de digitar: sem isto sai uma chamada por tecla
    this.digitou.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => { this.pagina.set(1); this.buscar(); });
    this.buscar();
  }

  aoDigitar(v: string): void { this.busca = v; this.digitou.next(v); }

  buscar(): void {
    this.carregando.set(true); this.erro.set(null);
    this.dados.clientes({ busca: this.busca.trim() || undefined,
                          pagina: this.pagina(), limite: POR_PAGINA }).subscribe({
      next: r => { this.lista.set(r.clientes); this.total.set(r.total); this.carregando.set(false); },
      error: (e: ErroApi) => { this.erro.set(e); this.carregando.set(false); }
    });
  }

  qtdVeiculos(c: Cliente): number {
    return typeof c.veiculos === 'number' ? c.veiculos : (c.veiculos?.length ?? 0);
  }

  proxima(): void { this.pagina.update(p => p + 1); this.buscar(); }
  anterior(): void { this.pagina.update(p => Math.max(1, p - 1)); this.buscar(); }

  abrirWhatsapp(tel: string | null | undefined, nome?: string): void {
    if (!tel) return;
    const numLimpo = String(tel).replace(/\D/g, '');
    const comDdd = numLimpo.startsWith('55') ? numLimpo : `55${numLimpo}`;
    const msg = nome
      ? `Olá ${nome}, tudo bem? Aqui é da Farias Troca de Óleo!`
      : 'Olá, tudo bem? Aqui é da Farias Troca de Óleo!';
    const url = `https://wa.me/${comDdd}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  }
}
