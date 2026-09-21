import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { DadosService } from '../../nucleo/dados.service';
import { Cliente } from '../../nucleo/tipos';
import { ErroApi } from '../../nucleo/api.service';
import { telefone, data } from '../../nucleo/formato';
import { SinoComponent } from '../../partes/sino/sino.component';

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

  telefone = telefone; data = data;

  ngOnInit(): void {
    // espera a pessoa parar de digitar: sem isto sai uma chamada por tecla
    this.digitou.pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => { this.pagina.set(1); this.buscar(); });
    this.buscar();
  }

  aoDigitar(v: string): void { this.busca = v; this.digitou.next(v); }

  buscar(): void {
    this.carregando.set(true); this.erro.set(null);
    this.dados.clientes({ busca: this.busca.trim() || undefined,
                          pagina: this.pagina(), limite: 50 }).subscribe({
      next: r => { this.lista.set(r.clientes); this.total.set(r.total); this.carregando.set(false); },
      error: (e: ErroApi) => { this.erro.set(e); this.carregando.set(false); }
    });
  }

  qtdVeiculos(c: Cliente): number {
    return typeof c.veiculos === 'number' ? c.veiculos : (c.veiculos?.length ?? 0);
  }

  proxima(): void { this.pagina.update(p => p + 1); this.buscar(); }
  anterior(): void { this.pagina.update(p => Math.max(1, p - 1)); this.buscar(); }
}
