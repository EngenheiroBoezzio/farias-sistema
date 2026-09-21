import { ApplicationConfig, APP_INITIALIZER, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import { LOCALE_ID } from '@angular/core';
import localePt from '@angular/common/locales/pt';

import { rotas } from './app.routes';
import { authInterceptor } from './nucleo/auth.interceptor';
import { ConfigService } from './nucleo/config.service';

registerLocaleData(localePt);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),

    /* withHashLocation é obrigatório no Electron: o app é carregado de
       file://, e sem hash o roteador quebra ao recarregar a janela. */
    provideRouter(rotas, withHashLocation()),

    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: LOCALE_ID, useValue: 'pt-BR' },

    /* O app não sobe antes de ler a configuração: senão a primeira chamada
       sairia para o endereço errado. */
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [ConfigService],
      useFactory: (cfg: ConfigService) => () => cfg.carregar()
    }
  ]
};
