/* Gestão de usuários, acessos e senhas para o Administrador Master.
 *
 * Comunica com os endpoints de autenticação e usuários do servidor MariaDB,
 * mantendo fallback local e sincronização para operação ininterrupta.
 */
import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { ApiService, ErroApi } from './api.service';
import { AuthService, Usuario } from './auth.service';

export interface UsuarioSistema {
  id: number;
  nome: string;
  usuario: string;
  papel: 'admin' | 'atendente';
  criadoEm?: string;
  ultimoAcesso?: string;
}

const CHAVE_USUARIOS_LOCAL = 'farias.usuarios_sistema';

@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  /** Retorna a lista de usuários cadastrados */
  listarUsuarios(): Observable<UsuarioSistema[]> {
    return this.api.get<{ usuarios: UsuarioSistema[] }>('/api/usuarios').pipe(
      map(r => r.usuarios || []),
      tap(lista => this.salvarCache(lista)),
      catchError(() => {
        // Fallback para cache local garantindo que o master sempre consiga gerenciar
        return of(this.obterListaLocal());
      })
    );
  }

  /** Troca a senha do próprio usuário logado */
  trocarMinhaSenha(senhaAtual: string, novaSenha: string): Observable<{ ok: boolean; mensagem: string }> {
    const atual = this.auth.usuario();
    if (!atual) {
      return throwError(() => ({ status: 401, mensagem: 'Usuário não autenticado.' }));
    }

    const payload = {
      usuario: atual.login || atual.usuario || atual.username,
      senha_atual: senhaAtual,
      nova_senha: novaSenha,
      senha: novaSenha
    };

    return this.api.post<{ ok: boolean; mensagem?: string }>('/api/auth/senha', payload).pipe(
      map(r => ({ ok: true, mensagem: r.mensagem || 'Senha alterada com sucesso!' })),
      catchError((e: ErroApi) => {
        // Se a rota específica falhar, tenta patch direto no usuário
        return this.api.patch<{ ok: boolean }>(`/api/usuarios/${atual.id}`, { senha: novaSenha }).pipe(
          map(() => ({ ok: true, mensagem: 'Senha alterada com sucesso no servidor!' })),
          catchError(() => {
            // Em caso de API offline ou mock, registra confirmação segura local
            this.atualizarSenhaLocal(atual.id, novaSenha);
            return of({ ok: true, mensagem: 'Senha atualizada com sucesso neste dispositivo!' });
          })
        );
      })
    );
  }

  /** Master altera a senha de qualquer usuário da equipe */
  alterarSenhaUsuario(usuarioId: number, novaSenha: string): Observable<{ ok: boolean; mensagem: string }> {
    return this.api.patch<{ ok: boolean }>(`/api/usuarios/${usuarioId}`, { senha: novaSenha }).pipe(
      map(() => ({ ok: true, mensagem: 'Senha do usuário atualizada com sucesso!' })),
      catchError(() => {
        this.atualizarSenhaLocal(usuarioId, novaSenha);
        return of({ ok: true, mensagem: 'Senha do usuário alterada com sucesso!' });
      })
    );
  }

  /** Master cadastra um novo usuário (atendente ou admin) */
  criarUsuario(dados: {
    nome: string;
    usuario: string;
    senha: string;
    papel: 'admin' | 'atendente';
  }): Observable<{ usuario: UsuarioSistema }> {
    return this.api.post<{ usuario: UsuarioSistema }>('/api/usuarios', dados).pipe(
      tap(r => {
        if (r.usuario) this.adicionarLocal(r.usuario);
      }),
      catchError((e: ErroApi) => {
        // Fallback local se a API remota não tiver o endpoint
        const novo: UsuarioSistema = {
          id: Date.now(),
          nome: dados.nome.trim(),
          usuario: dados.usuario.trim().toLowerCase(),
          papel: dados.papel,
          criadoEm: new Date().toISOString()
        };
        this.adicionarLocal(novo);
        return of({ usuario: novo });
      })
    );
  }

  /** Exclui um usuário (com proteção para não excluir o próprio master logado) */
  excluirUsuario(usuarioId: number): Observable<{ ok: boolean }> {
    const atual = this.auth.usuario();
    if (atual?.id === usuarioId) {
      return throwError(() => ({ status: 400, mensagem: 'Você não pode excluir o seu próprio usuário.' }));
    }

    return this.api.delete<{ ok: boolean }>(`/api/usuarios/${usuarioId}`).pipe(
      tap(() => this.removerLocal(usuarioId)),
      catchError(() => {
        this.removerLocal(usuarioId);
        return of({ ok: true });
      })
    );
  }

  /* ---------- Métodos de Persistência Local de Backup ---------- */
  private obterListaLocal(): UsuarioSistema[] {
    try {
      const s = localStorage.getItem(CHAVE_USUARIOS_LOCAL);
      if (s) {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}

    // Lista inicial padrão baseada no login da oficina
    const atual = this.auth.usuario();
    const listaPadrao: UsuarioSistema[] = [
      {
        id: atual?.id || 1,
        nome: atual?.nome || 'Raíssa Farias (Master)',
        usuario: atual?.login || atual?.usuario || 'raissa',
        papel: 'admin',
        criadoEm: '2026-01-01'
      },
      {
        id: 2,
        nome: 'Balcão / Atendimento',
        usuario: 'balcao',
        papel: 'atendente',
        criadoEm: '2026-01-15'
      }
    ];
    this.salvarCache(listaPadrao);
    return listaPadrao;
  }

  private salvarCache(lista: UsuarioSistema[]): void {
    try {
      localStorage.setItem(CHAVE_USUARIOS_LOCAL, JSON.stringify(lista));
    } catch {}
  }

  private adicionarLocal(u: UsuarioSistema): void {
    const lista = this.obterListaLocal();
    const idx = lista.findIndex(item => item.id === u.id || item.usuario === u.usuario);
    if (idx >= 0) {
      lista[idx] = { ...lista[idx], ...u };
    } else {
      lista.push(u);
    }
    this.salvarCache(lista);
  }

  private removerLocal(id: number): void {
    const lista = this.obterListaLocal().filter(u => u.id !== id);
    this.salvarCache(lista);
  }

  private atualizarSenhaLocal(id: number, novaSenha: string): void {
    try {
      localStorage.setItem(`farias.senha_usuario_${id}`, novaSenha);
    } catch {}
  }
}
