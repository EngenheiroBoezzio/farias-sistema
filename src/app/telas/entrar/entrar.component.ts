/* Tela de entrada.
   O pedido era que um computador roubado não abrisse o sistema: por isso a
   sessão vive em sessionStorage e some quando o app fecha. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../nucleo/auth.service';
import { ConfigService } from '../../nucleo/config.service';
import { ErroApi } from '../../nucleo/api.service';
import { VERSAO } from '../../nucleo/versao';

@Component({
  selector: 'app-entrar',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './entrar.component.html'
})
export class EntrarComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private rota = inject(ActivatedRoute);
  cfg = inject(ConfigService);

  /* Vem do package.json na hora de compilar. Estava escrita à mão no
     rodapé e marcava 1.0.8 enquanto o pacote já ia na 1.0.11. */
  versao = VERSAO;

  usuario = '';
  senha = '';
  lembrar = true;
  mostrarSenha = signal(false);
  enviando = signal(false);
  splash = signal(false);
  erro = signal<string | null>(null);
  dica = signal<string | null>(null);
  expirou = signal(false);

  ngOnInit(): void {
    // Se o usuário já estiver autenticado (ex: sessão persistida), abre direto o painel
    if (this.auth.logado()) {
      const volta = this.rota.snapshot.queryParamMap.get('volta');
      this.router.navigateByUrl(volta && volta !== '/entrar' ? volta : '/painel');
      return;
    }

    this.expirou.set(this.rota.snapshot.queryParamMap.get('expirou') === '1');
    // se o servidor nem responde, dizer isso ANTES de a pessoa errar a senha
    this.cfg.testar().then(r => {
      if (!r.ok) {
        /* O endereço do servidor não vai para a tela: a oficina não tem o que
           fazer com ele e ele não é assunto de quem está no balcão. Para o
           suporte, a versão e a hora da última resposta já identificam a
           instalação. */
        this.erro.set('O sistema não está respondendo.');
        this.dica.set('Avise quem cuida do sistema. Não é a sua senha.');
      }
    });
  }

  alternarMostrarSenha(): void {
    this.mostrarSenha.update(v => !v);
  }

  async entrar(): Promise<void> {
    if (this.enviando()) return;
    this.erro.set(null); this.dica.set(null);
    if (!this.usuario.trim() || !this.senha) {
      this.erro.set('Preencha usuário e senha.');
      return;
    }
    this.enviando.set(true);
    try {
      await this.auth.entrar(this.usuario.trim(), this.senha, this.lembrar);
      this.splash.set(true);
      await new Promise(res => setTimeout(res, 550));
      const volta = this.rota.snapshot.queryParamMap.get('volta');
      this.router.navigateByUrl(volta && volta !== '/entrar' ? volta : '/painel');
    } catch (e) {
      const err = e as ErroApi;
      this.erro.set(err.mensagem);
      this.dica.set(err.detalhe || null);
      this.senha = '';
    } finally {
      this.enviando.set(false);
    }
  }
}
