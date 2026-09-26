import { Routes } from '@angular/router';
import { guardaLogin, guardaAdmin } from './nucleo/auth.guard';

/* Tudo com loadComponent: o Electron carrega de file:// e o bundle inicial
   fica menor, então a janela abre antes de ler a tela inteira. */
export const rotas: Routes = [
  {
    path: 'entrar',
    title: 'Entrar — Farias',
    loadComponent: () => import('./telas/entrar/entrar.component').then(m => m.EntrarComponent)
  },
  {
    path: '',
    canActivate: [guardaLogin],
    loadComponent: () => import('./partes/moldura/moldura.component').then(m => m.MolduraComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'painel' },
      {
        path: 'painel', title: 'Painel — Farias',
        loadComponent: () => import('./telas/painel/painel.component').then(m => m.PainelComponent)
      },
      {
        path: 'financeiro', title: 'Financeiro — Farias',
        loadComponent: () => import('./telas/financeiro/financeiro.component').then(m => m.FinanceiroComponent)
      },
      {
        path: 'ordem', title: 'Nova ordem — Farias',
        loadComponent: () => import('./telas/ordem/ordem.component').then(m => m.OrdemComponent)
      },
      {
        path: 'clientes', title: 'Clientes — Farias',
        loadComponent: () => import('./telas/clientes/clientes.component').then(m => m.ClientesComponent)
      },
      {
        path: 'clientes/novo', title: 'Novo cliente — Farias',
        loadComponent: () => import('./telas/cliente-form/cliente-form.component').then(m => m.ClienteFormComponent)
      },
      {
        path: 'veiculo/:id', title: 'Ficha do veículo — Farias',
        loadComponent: () => import('./telas/ficha/ficha.component').then(m => m.FichaComponent)
      },
      {
        path: 'placa', title: 'Consulta de placa — Farias',
        loadComponent: () => import('./telas/placa/placa.component').then(m => m.PlacaComponent)
      },
      {
        /* Os links do painel e das tabelas apontam para cá com a placa junto
           (/placa/IVT4A19). Sem esta rota eles caíam no ** e voltavam para o
           painel — clicar numa placa não fazia nada. */
        path: 'placa/:placa', title: 'Consulta de placa — Farias',
        loadComponent: () => import('./telas/placa/placa.component').then(m => m.PlacaComponent)
      },
      {
        path: 'filtros', title: 'Fila de filtros — Farias',
        loadComponent: () => import('./telas/filtros/filtros.component').then(m => m.FiltrosComponent)
      },
      {
        path: 'vencidos', title: 'Vencidos — Farias',
        loadComponent: () => import('./telas/vencidos/vencidos.component').then(m => m.VencidosComponent)
      },
      {
        path: 'comunidade', title: 'Comunidade — Farias',
        loadComponent: () => import('./telas/comunidade/comunidade.component').then(m => m.ComunidadeComponent)
      },
      {
        path: 'configuracao', title: 'Configuração — Farias',
        loadComponent: () => import('./telas/config/config.component').then(m => m.ConfigComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
