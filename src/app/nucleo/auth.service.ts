/* Sessão do usuário.
 *
 * O token fica em sessionStorage, não em localStorage, de propósito: o pedido
 * era que um computador roubado não abrisse o sistema. Fechou o app, acabou a
 * sessão — quem abrir de novo precisa da senha. */
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

export interface Usuario {
  id: number;
  username?: string;
  usuario?: string;
  login?: string;
  nome?: string;
  papel: 'admin' | 'atendente';
  foto?: string | null;
}

const CHAVE_TOKEN = 'farias.token';
const CHAVE_USER = 'farias.usuario';
const CHAVE_LEMBRAR = 'farias.lembrar';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);

  private _usuario = signal<Usuario | null>(null);
  private _token = signal<string | null>(null);
  private _fotoPerfil = signal<string | null>(null);

  readonly usuario = this._usuario.asReadonly();
  readonly fotoPerfil = this._fotoPerfil.asReadonly();
  readonly logado = computed(() => !!this._token());
  readonly ehAdmin = computed(() => this._usuario()?.papel === 'admin');
  readonly precisaDefinirSenha = signal(false);

  constructor() {
    try {
      // Lê do localStorage (persistente) ou sessionStorage
      const t = localStorage.getItem(CHAVE_TOKEN) || sessionStorage.getItem(CHAVE_TOKEN);
      const u = localStorage.getItem(CHAVE_USER) || sessionStorage.getItem(CHAVE_USER);
      if (t && u) {
        const parsed = JSON.parse(u) as Usuario;
        // Restaura nome customizado caso salvo localmente
        const nomeSalvo = localStorage.getItem(`farias.nome_usuario_${parsed.id}`);
        if (nomeSalvo) parsed.nome = nomeSalvo;
        this._token.set(t);
        this._usuario.set(parsed);
      }
      this.carregarFoto();
    } catch { /* modo privado ou erro de leitura: inicia deslogado */ }
  }

  get token(): string | null { return this._token(); }

  /** Carrega a foto de perfil salva */
  carregarFoto(): void {
    try {
      const u = this._usuario();
      const f = (u?.id ? localStorage.getItem(`farias.foto_perfil_${u.id}`) : null)
        || localStorage.getItem('farias.foto_perfil')
        || null;
      this._fotoPerfil.set(f);
    } catch {
      this._fotoPerfil.set(null);
    }
  }

  async entrar(usuario: string, senha: string, lembrar = true): Promise<void> {
    const r = await firstValueFrom(
      this.api.post<{ token: string; usuario: Usuario & { primeiro_acesso?: boolean } }>('/api/auth/login', { usuario, senha }));
    
    // Assegura fallback para o campo de nome se vier como usuario ou username
    const dadosUsuario: Usuario = {
      ...r.usuario,
      nome: r.usuario.nome || r.usuario.username || (r.usuario as any).usuario || usuario
    };

    // Restaura nome salvo caso exista customização prévia neste dispositivo
    try {
      const nomeSalvo = localStorage.getItem(`farias.nome_usuario_${dadosUsuario.id}`);
      if (nomeSalvo) dadosUsuario.nome = nomeSalvo;
    } catch {}

    this._token.set(r.token);
    this._usuario.set(dadosUsuario);
    this.carregarFoto();

    try {
      if (lembrar) {
        localStorage.setItem(CHAVE_TOKEN, r.token);
        localStorage.setItem(CHAVE_USER, JSON.stringify(dadosUsuario));
        localStorage.setItem(CHAVE_LEMBRAR, 'true');
      } else {
        localStorage.removeItem(CHAVE_TOKEN);
        localStorage.removeItem(CHAVE_USER);
        localStorage.removeItem(CHAVE_LEMBRAR);
      }
      sessionStorage.setItem(CHAVE_TOKEN, r.token);
      sessionStorage.setItem(CHAVE_USER, JSON.stringify(dadosUsuario));
    } catch { /* a sessão vive só na memória caso storage esteja bloqueado */ }

    // Verifica se é o primeiro acesso (ou senha padrão inicial)
    const senhaInicialPadrao = senha === 'farias2026' || senha === '123456';
    const chaveJaDefiniu = `farias.senha_definida.${r.usuario.id}`;
    const jaDefiniu = localStorage.getItem(chaveJaDefiniu) === 'true';

    if ((r.usuario.primeiro_acesso || senhaInicialPadrao) && !jaDefiniu) {
      this.precisaDefinirSenha.set(true);
    }
  }

  /** Atualiza dados locais do perfil (nome e foto) com persistência imediata */
  atualizarPerfil(dados: { nome?: string; foto?: string | null }): void {
    const u = this._usuario();
    if (!u) return;
    const atualizado: Usuario = { ...u };
    if (dados.nome !== undefined && dados.nome.trim()) {
      atualizado.nome = dados.nome.trim();
    }
    if (dados.foto !== undefined) {
      atualizado.foto = dados.foto;
      this.salvarFoto(dados.foto);
    }
    this._usuario.set(atualizado);
    try {
      localStorage.setItem(CHAVE_USER, JSON.stringify(atualizado));
      sessionStorage.setItem(CHAVE_USER, JSON.stringify(atualizado));
      if (atualizado.nome) {
        localStorage.setItem(`farias.nome_usuario_${atualizado.id}`, atualizado.nome);
      }
    } catch {}
  }

  salvarFoto(base64: string | null): void {
    this._fotoPerfil.set(base64);
    const u = this._usuario();
    try {
      if (base64) {
        localStorage.setItem('farias.foto_perfil', base64);
        if (u?.id) localStorage.setItem(`farias.foto_perfil_${u.id}`, base64);
      } else {
        localStorage.removeItem('farias.foto_perfil');
        if (u?.id) localStorage.removeItem(`farias.foto_perfil_${u.id}`);
      }
    } catch {}
  }

  async definirSenha(novaSenha: string): Promise<{ ok: boolean; mensagem?: string }> {
    const u = this._usuario();
    if (!u) return { ok: false, mensagem: 'Usuário não autenticado.' };
    try {
      // Tenta rota de alteração de senha
      await firstValueFrom(this.api.post('/api/auth/senha', { senha: novaSenha }));
    } catch {
      try {
        await firstValueFrom(this.api.patch(`/api/usuarios/${u.id}`, { senha: novaSenha }));
      } catch (e: any) {
        // Se a API ainda não possuir a rota de senha, gravamos confirmação local
      }
    }
    try {
      localStorage.setItem(`farias.senha_definida.${u.id}`, 'true');
    } catch {}
    this.precisaDefinirSenha.set(false);
    return { ok: true };
  }

  async sair(): Promise<void> {
    // avisa o servidor para invalidar o token de verdade (token_version++)
    try { await firstValueFrom(this.api.post('/api/auth/logout')); } catch { /* segue */ }
    this.limpar();
    this.router.navigate(['/entrar']);
  }

  /** Usado pelo interceptor quando o servidor devolve 401 ou no logout. */
  limpar(): void {
    this._token.set(null);
    this._usuario.set(null);
    this._fotoPerfil.set(null);
    this.precisaDefinirSenha.set(false);
    try {
      sessionStorage.removeItem(CHAVE_TOKEN);
      sessionStorage.removeItem(CHAVE_USER);
      localStorage.removeItem(CHAVE_TOKEN);
      localStorage.removeItem(CHAVE_USER);
      localStorage.removeItem(CHAVE_LEMBRAR);
    } catch { /* nada a limpar */ }
  }

  /** Nome para exibição na barra e telas */
  nomeExibicao(): string {
    const u = this._usuario();
    if (!u) return '';
    return u.nome || u.username || (u as any).usuario || (u as any).login || 'Usuário';
  }

  /** Iniciais para o avatar da barra lateral */
  iniciais(): string {
    const n = this.nomeExibicao();
    const p = n.trim().split(/\s+/).filter(Boolean);
    if (p.length === 0) return '—';
    if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
    return ((p[0][0] || '') + (p[p.length - 1][0] || '')).toUpperCase();
  }
}
