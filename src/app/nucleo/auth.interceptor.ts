/* Põe o token em toda chamada e derruba a sessão quando o servidor recusa.
 *
 * O 401 tem que limpar a sessão local: sem isso o app fica mostrando a tela
 * cheia com dados velhos enquanto nenhuma chamada nova funciona. */
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token;

  // o login em si não leva token
  const ehLogin = req.url.includes('/api/auth/login');
  const pedido = token && !ehLogin
    ? req.clone({ setHeaders: { authorization: `Bearer ${token}` } })
    : req;

  return next(pedido).pipe(
    catchError(err => {
      if (err?.status === 401 && !ehLogin) {
        auth.limpar();
        router.navigate(['/entrar'], { queryParams: { expirou: 1 } });
      }
      return throwError(() => err);
    })
  );
};
