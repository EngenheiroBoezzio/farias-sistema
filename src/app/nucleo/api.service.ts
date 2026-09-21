/* Única porta de saída para a API.
 *
 * A URL vem do ConfigService a CADA chamada, não é guardada aqui: trocar o
 * endereço na tela de configuração passa a valer na hora, sem reiniciar. */
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ConfigService } from './config.service';

/** Erro já traduzido para algo que dá para mostrar na tela. */
export interface ErroApi {
  status: number;
  mensagem: string;
  detalhe?: string;
  /** o servidor devolve isto quando a ação precisa de confirmação explícita */
  confirmarCom?: string;
  corpo?: any;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private cfg = inject(ConfigService);

  private url(caminho: string): string {
    return this.cfg.apiUrl + (caminho.startsWith('/') ? caminho : '/' + caminho);
  }

  private params(q?: Record<string, any>): HttpParams {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(q || {}))
      if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return p;
  }

  get<T>(caminho: string, q?: Record<string, any>): Observable<T> {
    return this.http.get<T>(this.url(caminho), { params: this.params(q) })
      .pipe(catchError(e => this.traduzir(e)));
  }

  post<T>(caminho: string, corpo?: any, q?: Record<string, any>): Observable<T> {
    return this.http.post<T>(this.url(caminho), corpo ?? {}, { params: this.params(q) })
      .pipe(catchError(e => this.traduzir(e)));
  }

  patch<T>(caminho: string, corpo: any): Observable<T> {
    return this.http.patch<T>(this.url(caminho), corpo)
      .pipe(catchError(e => this.traduzir(e)));
  }

  put<T>(caminho: string, corpo: any): Observable<T> {
    return this.http.put<T>(this.url(caminho), corpo)
      .pipe(catchError(e => this.traduzir(e)));
  }

  delete<T>(caminho: string, q?: Record<string, any>): Observable<T> {
    return this.http.delete<T>(this.url(caminho), { params: this.params(q) })
      .pipe(catchError(e => this.traduzir(e)));
  }

  /* A API já devolve mensagem pronta para o usuário em `erro`. O que falta
     traduzir é quando ela nem foi alcançada — e aí o problema é de rede ou
     endereço, não do que o atendente digitou. */
  private traduzir(e: HttpErrorResponse) {
    const erro: ErroApi = {
      status: e.status,
      mensagem: 'Algo deu errado.',
      corpo: e.error
    };

    if (e.status === 0) {
      erro.mensagem = 'Não consegui falar com o servidor.';
      erro.detalhe = `Confira se o sistema está no ar em ${this.cfg.apiUrl}.`;
    } else if (e.status === 401) {
      /* No login, 401 é senha errada — não sessão expirada. Dizer "sua sessão
         expirou" para quem acabou de digitar a senha manda a pessoa procurar
         problema onde não tem. A API já devolve a frase certa. */
      erro.mensagem = e.url?.includes('/api/auth/login')
        ? (e.error?.erro || 'Usuário ou senha não conferem.')
        : 'Sua sessão expirou. Entre de novo.';
    } else if (e.status === 403) {
      erro.mensagem = e.error?.erro || 'Você não tem permissão para isso.';
    } else if (e.status === 429) {
      erro.mensagem = e.error?.erro || 'Muitas tentativas. Aguarde alguns minutos.';
    } else if (e.status === 409) {
      erro.mensagem = e.error?.erro || 'Isso precisa de confirmação.';
      erro.detalhe = e.error?.detalhe;
      erro.confirmarCom = e.error?.confirmar_com || e.error?.aceitar_com;
    } else if (e.error?.erro) {
      erro.mensagem = e.error.erro;
      erro.detalhe = e.error?.detalhe;
    } else if (e.status >= 500) {
      erro.mensagem = 'O servidor teve um problema. Tente de novo.';
    }

    return throwError(() => erro);
  }
}
