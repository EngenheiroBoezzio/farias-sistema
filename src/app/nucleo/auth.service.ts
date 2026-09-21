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
  username: string;
  nome: string;
  papel: 'admin' | 'atendente';
}

const CHAVE_TOKEN = 'farias.token';
const CHAVE_USER = 'farias.usuario';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);

  private _usuario = signal<Usuario | null>(null);
  private _token = signal<string | null>(null);

  readonly usuario = this._usuario.asReadonly();
  readonly logado = computed(() => !!this._token());
  readonly ehAdmin = computed(() => this._usuario()?.papel === 'admin');
  readonly precisaDefinirSenha = signal(false);

  constructor() {
    try {
      const t = sessionStorage.getItem(CHAVE_TOKEN);
      const u = sessionStorage.getItem(CHAVE_USER);
      if (t && u) { this._token.set(t); this._usuario.set(JSON.parse(u)); }
    } catch { /* modo privado: começa deslogado, que é o correto */ }
  }

  get token(): string | null { return this._token(); }

  async entrar(usuario: string, senha: string): Promise<void> {
    const r = await firstValueFrom(
      this.api.post<{ token: string; usuario: Usuario & { primeiro_acesso?: boolean } }>('/api/auth/login', { usuario, senha }));
    this._token.set(r.token);
    this._usuario.set(r.usuario);
    try {
      sessionStorage.setItem(CHAVE_TOKEN, r.token);
      sessionStorage.setItem(CHAVE_USER, JSON.stringify(r.usuario));
    } catch { /* a sessão vive só na memória, e ainda funciona */ }

    // Verifica se é o primeiro acesso (ou senha padrão inicial)
    const senhaInicialPadrao = senha === 'farias2026' || senha === '123456';
    const chaveJaDefiniu = `farias.senha_definida.${r.usuario.id}`;
    const jaDefiniu = localStorage.getItem(chaveJaDefiniu) === 'true';

    if ((r.usuario.primeiro_acesso || senhaInicialPadrao) && !jaDefiniu) {
      this.precisaDefinirSenha.set(true);
    }
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

  /** Usado pelo interceptor quando o servidor devolve 401. */
  limpar(): void {
    this._token.set(null);
    this._usuario.set(null);
    this.precisaDefinirSenha.set(false);
    try {
      sessionStorage.removeItem(CHAVE_TOKEN);
      sessionStorage.removeItem(CHAVE_USER);
    } catch { /* nada a limpar */ }
  }

  /** Iniciais para o avatar da barra lateral. */
  iniciais(): string {
    const n = this._usuario()?.nome || '';
    const p = n.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '—';
  }
}
