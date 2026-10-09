/* Editar os dados de um cliente: nome, telefone, aceita aviso, nascimento e
   observação. Os carros NÃO entram aqui — cada carro tem a própria ficha.

   Só manda para a API o que MUDOU. Isso importa por causa do telefone: mandar
   o telefone marca ele como "confirmado" (tel_inferido = 0), então reenviar
   o mesmo número sem a pessoa ter olhado apagaria o aviso "DDD deduzido". */
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DadosService } from '../../nucleo/dados.service';
import { ErroApi } from '../../nucleo/api.service';
import { Cliente } from '../../nucleo/tipos';
import { telefone as fTelefone } from '../../nucleo/formato';
import { AuthService } from '../../nucleo/auth.service';

@Component({
  selector: 'app-modal-cliente',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './modal-cliente.component.html'
})
export class ModalClienteComponent implements OnInit {
  private dados = inject(DadosService);
  readonly ehAdmin = inject(AuthService).ehAdmin;

  clienteId = input.required<number>();
  clienteInicial = input<Cliente | null>(null);
  fechou = output<void>();
  salvou = output<Cliente>();
  excluiu = output<{ id: number; nome: string }>();

  carregando = signal(true);
  enviando = signal(false);
  erro = signal<ErroApi | null>(null);
  /* Sobe 1 a cada erro: troca a chave do bloco e reinicia a animação de
     "tremer", mesmo quando o erro se repete. */
  tremer = signal(0);
  telInferido = signal(false);

  f = { nome: '', telefone: '', aceita_aviso: true, nascimento: '', obs: '' };
  private original = { ...this.f };

  ngOnInit(): void {
    const ini = this.clienteInicial();
    if (ini) {
      this.f = {
        nome: ini.nome || '',
        telefone: ini.telefone ? fTelefone(ini.telefone) : '',
        aceita_aviso: ini.aceita_aviso !== undefined ? !!ini.aceita_aviso : true,
        nascimento: ini.nascimento ? String(ini.nascimento).slice(0, 10) : '',
        obs: ini.obs || ''
      };
      this.original = { ...this.f };
      this.telInferido.set(!!ini.tel_inferido);
      this.carregando.set(false);
    }

    this.dados.cliente(this.clienteId()).subscribe({
      next: r => {
        const c = r.cliente;
        this.f = {
          nome: c.nome || this.f.nome,
          telefone: c.telefone ? fTelefone(c.telefone) : this.f.telefone,
          aceita_aviso: c.aceita_aviso !== undefined ? !!c.aceita_aviso : this.f.aceita_aviso,
          nascimento: c.nascimento ? String(c.nascimento).slice(0, 10) : this.f.nascimento,
          obs: c.obs ?? this.f.obs
        };
        this.original = { ...this.f };
        this.telInferido.set(!!c.tel_inferido);
        this.carregando.set(false);
      },
      error: (e: ErroApi) => {
        if (!ini) {
          this.erro.set(e);
          this.carregando.set(false);
        }
      }
    });
  }

  private falhar(mensagem: string): void {
    this.erro.set({ status: 0, mensagem });
    this.tremer.update(n => n + 1);
  }

  salvar(): void {
    if (this.enviando() || this.carregando()) return;
    this.erro.set(null);

    const nome = this.f.nome.trim();
    if (nome.length < 2) { this.falhar('Informe o nome do cliente.'); return; }

    const corpo: Record<string, unknown> = {};
    if (nome !== this.original.nome.trim()) corpo['nome'] = nome;

    const telMudou = this.f.telefone.replace(/\D/g, '') !== this.original.telefone.replace(/\D/g, '');
    /* DDD deduzido + a pessoa abriu e salvou = olhou o número: confirma. */
    if (telMudou || (this.telInferido() && this.f.telefone.trim()))
      corpo['telefone'] = this.f.telefone.trim() || null;

    if (this.f.aceita_aviso !== this.original.aceita_aviso)
      corpo['aceita_aviso'] = this.f.aceita_aviso ? 1 : 0;
    if (this.f.nascimento !== this.original.nascimento)
      corpo['nascimento'] = this.f.nascimento || null;
    if (this.f.obs.trim() !== this.original.obs.trim())
      corpo['obs'] = this.f.obs.trim() || null;

    if (!Object.keys(corpo).length) { this.fechou.emit(); return; }

    this.enviando.set(true);
    this.dados.editarCliente(this.clienteId(), corpo as Partial<Cliente>).subscribe({
      next: r => { this.enviando.set(false); this.salvou.emit(r.cliente); },
      error: (e: ErroApi) => {
        this.enviando.set(false);
        this.erro.set(e);
        this.tremer.update(n => n + 1);
      }
    });
  }

  /* ---------- excluir (só admin; a API também confere) ----------
     Dois passos, sem o confirm() do navegador: o 1º pedido volta 409 com o
     que vai junto ("apaga 2 veículos e 14 ordens"), e só o 2º apaga. */
  confirmandoExclusao = signal<string | null>(null);

  pedirExclusao(): void {
    if (this.enviando()) return;
    this.erro.set(null);
    this.enviando.set(true);
    this.dados.excluirCliente(this.clienteId(), false).subscribe({
      /* Sem 409 (servidor antigo?) não apaga nada sem confirmação: pede mesmo assim. */
      next: () => { this.enviando.set(false); this.confirmandoExclusao.set('Esta ação não pode ser desfeita.'); },
      error: (e: ErroApi) => {
        this.enviando.set(false);
        if (e.status === 409) this.confirmandoExclusao.set(e.detalhe || 'Esta ação não pode ser desfeita.');
        else { this.erro.set(e); this.tremer.update(n => n + 1); }
      }
    });
  }

  confirmarExclusao(): void {
    if (this.enviando()) return;
    this.enviando.set(true);
    this.dados.excluirCliente(this.clienteId(), true).subscribe({
      next: () => {
        this.enviando.set(false);
        this.excluiu.emit({ id: this.clienteId(), nome: this.original.nome || this.f.nome });
      },
      error: (e: ErroApi) => {
        this.enviando.set(false);
        this.confirmandoExclusao.set(null);
        this.erro.set(e); this.tremer.update(n => n + 1);
      }
    });
  }

  fechar(): void { if (!this.enviando()) this.fechou.emit(); }
}
