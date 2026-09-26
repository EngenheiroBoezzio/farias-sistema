/* Cadastro de cliente com o veículo na mesma tela.
   A API grava os dois numa transação: ou entram juntos, ou nenhum entra. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DadosService } from '../../nucleo/dados.service';
import { ErroApi } from '../../nucleo/api.service';
import { placa as fPlaca } from '../../nucleo/formato';
import { SeloComponent } from '../../partes/selo/selo.component';
import { PlacaMercosulComponent } from '../../partes/placa-mercosul/placa-mercosul.component';
import { EtiquetaService, INTERVALOS_COMUNS } from '../../nucleo/etiqueta.service';

@Component({
  selector: 'app-cliente-form',
  standalone: true,
  imports: [FormsModule, SeloComponent, PlacaMercosulComponent],
  templateUrl: './cliente-form.component.html'
})
export class ClienteFormComponent implements OnInit {
  private dados = inject(DadosService);
  private rota = inject(ActivatedRoute);
  private router = inject(Router);
  private etiquetaService = inject(EtiquetaService);

  enviando = signal(false);
  erro = signal<ErroApi | null>(null);
  duplicado = signal<string | null>(null);
  selo = signal<{ titulo: string; linha: string } | null>(null);
  comVeiculo = signal(true);

  readonly intervalosComuns = INTERVALOS_COMUNS;
  intervaloPreferido = signal<number>(7000);

  f = {
    nome: '', telefone: '', nascimento: '', aceita_aviso: true, obs: '',
    placa: '', marca: '', modelo: '', cilindrada: '', ano: null as number | null,
    filtro_oleo: '', filtro_ar: '', filtro_cabine: '', filtro_combustivel: ''
  };

  ngOnInit(): void {
    /* Vem da tela de consulta, que já descobriu o carro pelo modelo e mostrou
       os códigos ao atendente. Trazer tudo preenchido evita a pior fonte de
       erro que existe aqui: redigitar um código de filtro de memória. Todos
       os campos continuam editáveis — a sugestão não vira imposição. */
    const q = this.rota.snapshot.queryParamMap;
    const p = q.get('placa');
    if (p) { this.f.placa = p; this.comVeiculo.set(true); }
    for (const k of ['marca', 'modelo', 'cilindrada'] as const) {
      const v = q.get(k);
      if (v) this.f[k] = v;
    }
    const ano = q.get('ano');
    if (ano) this.f.ano = parseInt(ano, 10) || null;
    for (const k of ['filtro_oleo', 'filtro_ar', 'filtro_cabine', 'filtro_combustivel'] as const) {
      const v = q.get(k);
      if (v) this.f[k] = v;
    }
  }

  salvar(): void {
    if (this.enviando()) return;
    this.erro.set(null); this.duplicado.set(null);

    if (this.f.nome.trim().length < 2) {
      this.erro.set({ status: 400, mensagem: 'Informe o nome do cliente.',
                      detalhe: 'Precisa ter ao menos 2 letras.' });
      return;
    }

    const corpo: any = {
      nome: this.f.nome.trim(),
      aceita_aviso: this.f.aceita_aviso ? 1 : 0
    };
    if (this.f.telefone.trim()) corpo.telefone = this.f.telefone.trim();
    if (this.f.nascimento) corpo.nascimento = this.f.nascimento;
    if (this.f.obs.trim()) corpo.obs = this.f.obs.trim();

    if (this.comVeiculo() && this.f.placa.trim()) {
      const v: any = { placa: this.f.placa.toUpperCase().replace(/[^A-Z0-9]/g, '') };
      if (this.f.marca.trim()) v.marca = this.f.marca.trim();
      if (this.f.modelo.trim()) v.modelo = this.f.modelo.trim();
      if (this.f.cilindrada.trim()) v.cilindrada = this.f.cilindrada.trim();
      if (this.f.ano) v.ano = this.f.ano;
      for (const k of ['filtro_oleo', 'filtro_ar', 'filtro_cabine', 'filtro_combustivel'] as const)
        if ((this.f as any)[k].trim()) v[k] = (this.f as any)[k].trim().toUpperCase();
      corpo.veiculo = v;
    }

    this.enviando.set(true);
    this.dados.criarCliente(corpo).subscribe({
      next: r => {
        this.enviando.set(false);
        // a API não bloqueia telefone repetido, mas avisa — o balcão decide
        if (r.aviso) this.duplicado.set(r.aviso);
        if (r.cliente?.id) {
          this.etiquetaService.salvarIntervalo(
            this.intervaloPreferido(),
            r.cliente.id,
            r.veiculo?.placa || this.f.placa
          );
        }
        this.selo.set({
          titulo: 'Cliente cadastrado',
          linha: r.veiculo ? `${this.f.nome} · ${fPlaca(r.veiculo.placa)}` : this.f.nome
        });
      },
      error: (e: ErroApi) => { this.enviando.set(false); this.erro.set(e); }
    });
  }

  aoFechar(): void {
    this.selo.set(null);
    this.router.navigate(['/clientes']);
  }
}
