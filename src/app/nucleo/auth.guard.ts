/* Sem sessão, nada de tela interna — nem por digitar a rota na barra. */
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const guardaLogin: CanActivateFn = (_rota, estado) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.logado()) return true;
  return router.createUrlTree(['/entrar'], { queryParams: { volta: estado.url } });
};

/** Rotas que só o admin abre (exclusões, histórico de backup). */
export const guardaAdmin: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.ehAdmin()) return true;
  return router.createUrlTree(['/painel']);
};
