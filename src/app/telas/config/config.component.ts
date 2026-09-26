/* Configuração do app.
 *
 * É aqui que se aponta para o servidor. A URL fica gravada fora do bundle, o
 * que significa que trocar de máquina ou de endereço interno NÃO exige gerar
 * um instalador novo. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../nucleo/auth.service';
import { ConfigService, TamanhoFonte, TemaApp, FrequenciaAtualizacao, TipoGrafico } from '../../nucleo/config.service';
import { DadosService } from '../../nucleo/dados.service';
import { SinoComponent } from '../../partes/sino/sino.component';

import { UsuariosService, UsuarioSistema } from '../../nucleo/usuarios.service';
import { VERSAO } from '../../nucleo/versao';

export type SecaoConfig = 'perfil' | 'aparencia' | 'loja' | 'conexao' | 'atualizacoes' | 'usuarios';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [FormsModule, SinoComponent],
  templateUrl: './config.component.html'
})
export class ConfigComponent implements OnInit {
  auth = inject(AuthService);
  cfg = inject(ConfigService);
  private dados = inject(DadosService);
  private usuariosService = inject(UsuariosService);

  f = {
    apiUrl: '',
    nomeLoja: '',
    canalWhatsapp: '',
    tamanhoFonte: 'normal' as TamanhoFonte,
    tema: 'adaptativo' as TemaApp,
    frequenciaAtualizacao: 'semanal' as FrequenciaAtualizacao,
    tipoGrafico: 'linha' as TipoGrafico,
    menuFixado: false
  };

  /* Qual seção está aberta. A tela era um scroll de sete painéis empilhados;
     para trocar o tamanho da letra era preciso passar por perfil, senha e
     gráfico. Agora é uma de cada vez. */
  secao = signal<SecaoConfig>('perfil');

  testando = signal(false);
  salvando = signal(false);
  resultado = signal<{ ok: boolean; texto: string } | null>(null);
  salvo = signal<string | null>(null);
  versao = signal<string>('—');
  atualizacao = signal<string | null>(null);
  catalogo = signal<string | null>(null);

  // Perfil do Usuário
  nomeUsuario = '';
  salvandoPerfil = signal(false);
  salvoPerfil = signal<string | null>(null);

  // Gestão de Usuários Master
  usuarios = signal<UsuarioSistema[]>([]);
  carregandoUsuarios = signal(false);
  modalNovoUsuario = signal(false);
  usuarioParaAlterarSenha = signal<UsuarioSistema | null>(null);
  novaSenhaOperador = '';
  salvandoSenhaOperador = signal(false);

  // Formulário Minha Senha
  minhaSenha = { atual: '', nova: '', confirmacao: '' };
  salvandoMinhaSenha = signal(false);
  sucessoMinhaSenha = signal<string | null>(null);
  erroMinhaSenha = signal<string | null>(null);

  // Formulário Novo Usuário
  novoUsuario = { nome: '', usuario: '', senha: '', papel: 'atendente' as 'admin' | 'atendente' };
  salvandoNovoUsuario = signal(false);
  erroNovoUsuario = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const c = this.cfg.config();
    this.f = {
      apiUrl: c.apiUrl,
      nomeLoja: c.nomeLoja,
      canalWhatsapp: c.canalWhatsapp,
      tamanhoFonte: this.cfg.tamanhoFonte || c.tamanhoFonte || 'normal',
      tema: this.cfg.tema || c.tema || 'adaptativo',
      frequenciaAtualizacao: this.cfg.frequenciaAtualizacao || c.frequenciaAtualizacao || 'semanal',
      tipoGrafico: this.cfg.tipoGrafico || c.tipoGrafico || 'linha',
      menuFixado: this.cfg.menuFixado
    };
    this.nomeUsuario = this.auth.nomeExibicao();
    try {
      if (window.farias?.versao) this.versao.set(await window.farias.versao());
    } catch { /* fora do Electron não tem versão de instalador */ }
    /* Sem o Electron por perto, vale a do package.json gravada no build —
       melhor um número certo do que um travessão. */
    if (this.versao() === '—') this.versao.set(VERSAO);

    if (this.auth.ehAdmin()) {
      this.carregarUsuarios();
    }
  }

  carregarUsuarios(): void {
    this.carregandoUsuarios.set(true);
    this.usuariosService.listarUsuarios().subscribe({
      next: lista => {
        this.usuarios.set(lista);
        this.carregandoUsuarios.set(false);
      },
      error: () => this.carregandoUsuarios.set(false)
    });
  }

  alterarMinhaSenha(): void {
    this.erroMinhaSenha.set(null);
    this.sucessoMinhaSenha.set(null);

    if (!this.minhaSenha.nova || this.minhaSenha.nova.length < 4) {
      this.erroMinhaSenha.set('A nova senha deve ter pelo menos 4 caracteres.');
      return;
    }
    if (this.minhaSenha.nova !== this.minhaSenha.confirmacao) {
      this.erroMinhaSenha.set('A confirmação da nova senha não confere.');
      return;
    }

    this.salvandoMinhaSenha.set(true);
    this.usuariosService.trocarMinhaSenha(this.minhaSenha.atual, this.minhaSenha.nova).subscribe({
      next: res => {
        this.salvandoMinhaSenha.set(false);
        this.sucessoMinhaSenha.set(res.mensagem || 'Senha alterada com sucesso no banco de dados!');
        this.minhaSenha = { atual: '', nova: '', confirmacao: '' };
        setTimeout(() => this.sucessoMinhaSenha.set(null), 4000);
      },
      error: (e: any) => {
        this.salvandoMinhaSenha.set(false);
        this.erroMinhaSenha.set(e.mensagem || 'Não foi possível alterar a senha.');
      }
    });
  }

  abrirModalSenhaOperador(u: UsuarioSistema): void {
    this.usuarioParaAlterarSenha.set(u);
    this.novaSenhaOperador = '';
  }

  salvarSenhaOperador(): void {
    const u = this.usuarioParaAlterarSenha();
    if (!u) return;
    if (!this.novaSenhaOperador || this.novaSenhaOperador.length < 4) {
      alert('A senha deve ter no mínimo 4 caracteres.');
      return;
    }

    this.salvandoSenhaOperador.set(true);
    this.usuariosService.alterarSenhaUsuario(u.id, this.novaSenhaOperador).subscribe({
      next: () => {
        this.salvandoSenhaOperador.set(false);
        this.usuarioParaAlterarSenha.set(null);
        this.salvoPerfil.set(`Senha do operador ${u.nome} atualizada com sucesso!`);
        setTimeout(() => this.salvoPerfil.set(null), 4000);
      },
      error: () => this.salvandoSenhaOperador.set(false)
    });
  }

  salvarNovoUsuario(): void {
    this.erroNovoUsuario.set(null);
    if (!this.novoUsuario.nome.trim() || !this.novoUsuario.usuario.trim() || !this.novoUsuario.senha) {
      this.erroNovoUsuario.set('Preencha todos os campos obrigatórios.');
      return;
    }

    this.salvandoNovoUsuario.set(true);
    this.usuariosService.criarUsuario(this.novoUsuario).subscribe({
      next: res => {
        this.salvandoNovoUsuario.set(false);
        this.modalNovoUsuario.set(false);
        this.novoUsuario = { nome: '', usuario: '', senha: '', papel: 'atendente' };
        this.carregarUsuarios();
        this.salvoPerfil.set(`Usuário ${res.usuario.nome} cadastrado com sucesso!`);
        setTimeout(() => this.salvoPerfil.set(null), 4000);
      },
      error: (e: any) => {
        this.salvandoNovoUsuario.set(false);
        this.erroNovoUsuario.set(e.mensagem || 'Erro ao cadastrar usuário.');
      }
    });
  }

  excluirUsuario(u: UsuarioSistema): void {
    if (confirm(`Tem certeza que deseja remover o acesso de ${u.nome} (${u.usuario})?`)) {
      this.usuariosService.excluirUsuario(u.id).subscribe({
        next: () => {
          this.carregarUsuarios();
          this.salvoPerfil.set(`Acesso de ${u.nome} removido.`);
          setTimeout(() => this.salvoPerfil.set(null), 3000);
        },
        error: (e: any) => alert(e.mensagem || 'Não foi possível excluir o usuário.')
      });
    }
  }

  selecionarFonte(tf: TamanhoFonte): void {
    this.f.tamanhoFonte = tf;
    this.mudarAparencia();
  }

  /** Abre o seletor de arquivo e converte a imagem escolhida em base64 otimizado (256x256 max). */
  escolherFoto(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png, image/jpeg, image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const MAX = 256;
            const canvas = document.createElement('canvas');
            canvas.width = MAX;
            canvas.height = MAX;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Corte quadrado centralizado proporcional
            const minDim = Math.min(img.width, img.height);
            const sx = (img.width - minDim) / 2;
            const sy = (img.height - minDim) / 2;

            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, MAX, MAX);
            const base64 = canvas.toDataURL('image/jpeg', 0.85);

            this.auth.salvarFoto(base64);
            this.cfg.salvarFoto(base64);
            this.salvoPerfil.set('Foto de perfil atualizada!');
            setTimeout(() => this.salvoPerfil.set(null), 3500);
          } catch {
            // Fallback caso canvas falhe
            const bruto = reader.result as string;
            this.auth.salvarFoto(bruto);
            this.cfg.salvarFoto(bruto);
          }
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  removerFoto(): void {
    this.auth.salvarFoto(null);
    this.cfg.salvarFoto(null);
    this.salvoPerfil.set('Foto de perfil removida.');
    setTimeout(() => this.salvoPerfil.set(null), 3000);
  }

  salvarPerfil(): void {
    const nome = this.nomeUsuario.trim();
    if (!nome) return;
    this.salvandoPerfil.set(true);
    this.auth.atualizarPerfil({ nome });
    this.salvandoPerfil.set(false);
    this.salvoPerfil.set('Perfil e nome de exibição salvos com sucesso!');
    setTimeout(() => this.salvoPerfil.set(null), 4000);
  }

  selecionarTipoGrafico(tipo: TipoGrafico): void {
    this.f.tipoGrafico = tipo;
    this.mudarAparencia();
  }

  trocarTema(t: TemaApp): void {
    this.f.tema = t;
    this.mudarAparencia();
  }

  mudarAparencia(): void {
    this.cfg.salvar({
      tamanhoFonte: this.f.tamanhoFonte,
      tema: this.f.tema,
      tipoGrafico: this.f.tipoGrafico,
      menuFixado: this.f.menuFixado
    });
  }

  async testar(): Promise<void> {
    this.testando.set(true);
    this.resultado.set(null);
    const r = await this.cfg.testar(this.f.apiUrl);
    this.testando.set(false);
    this.resultado.set(r.ok
      ? { ok: true, texto: `Respondeu em ${r.ms} ms. O banco está no ar.` }
      : { ok: false, texto: r.erro || 'Não respondeu.' });
  }

  async salvar(): Promise<void> {
    this.salvando.set(true);
    this.salvo.set(null);
    const ok = await this.cfg.salvar(this.f);
    this.salvando.set(false);
    this.salvo.set(ok
      ? 'Salvo. Já vale para as próximas chamadas, sem reiniciar.'
      : 'Guardei só nesta sessão — não consegui gravar no disco.');
  }

  async verificarAtualizacao(): Promise<void> {
    this.atualizacao.set('Procurando…');
    try {
      if (!window.farias?.verificarAtualizacao) {
        this.atualizacao.set('A atualização automática só funciona no aplicativo instalado.');
        return;
      }
      const r = await window.farias.verificarAtualizacao();
      if (r.disponivel) {
        this.atualizacao.set(`Há uma versão nova (${r.versao}). Ela será baixada e instalada ao fechar o programa.`);
      } else if (r.motivo && r.motivo !== 'em desenvolvimento') {
        this.atualizacao.set(`Falha ao verificar: ${r.motivo}`);
      } else {
        this.atualizacao.set('Você já está na versão mais recente.');
      }
    } catch {
      this.atualizacao.set('Não consegui verificar agora. Tente mais tarde.');
    }
  }

  recarregarCatalogo(): void {
    this.catalogo.set('Recarregando…');
    this.dados.recarregarCatalogo().subscribe({
      next: r => this.catalogo.set(`Catálogo relido: ${r.linhas} aplicações em ${r.ms} ms.`),
      error: () => this.catalogo.set('Não consegui recarregar. Confira se o servidor está no ar.')
    });
  }
}
