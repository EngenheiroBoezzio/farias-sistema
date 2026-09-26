/* Componente Visual de Placa Mercosul Oficial Brasileira.
 *
 * Exibe a placa no formato oficial do Mercosul:
 * - Faixa azul superior com logo do Mercosul, texto "BRASIL" e bandeira do Brasil.
 * - Fundo branco com tipografia estampada em alto contraste.
 * - Suporta tamanhos 'xs', 'sm', 'md' e 'lg' e link opcional (routerLink).
 */
import { Component, Input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-placa-mercosul',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    @if (link) {
      <a [routerLink]="link" class="placa-mercosul" [class]="'pm-' + tamanho" [title]="'Ver placa ' + textoPlaca()">
        <span class="pm-topo">
          <!-- Logo Mercosul -->
          <svg class="pm-logo" viewBox="0 0 16 16" width="10" height="10" fill="none">
            <path d="M 2 13 C 2 7, 7 3, 14 3" stroke="#4ade80" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="7" cy="6" r="1.1" fill="#ffffff"/>
            <circle cx="9.2" cy="8" r="1.1" fill="#ffffff"/>
            <circle cx="6" cy="10" r="1.1" fill="#ffffff"/>
            <circle cx="10.2" cy="11.2" r="1.1" fill="#ffffff"/>
          </svg>

          <span class="pm-pais">BRASIL</span>

          <!-- Bandeira do Brasil Oficial SVG -->
          <svg class="pm-bandeira" viewBox="0 0 20 14" width="13" height="9">
            <rect width="20" height="14" fill="#009c3b" rx="1"/>
            <polygon points="10,1.5 18.5,7 10,12.5 1.5,7" fill="#ffdf00"/>
            <circle cx="10" cy="7" r="3.2" fill="#002776"/>
            <path d="M 7.2 7.6 Q 10 5.8 12.8 7.2" stroke="#ffffff" stroke-width="0.7" fill="none"/>
          </svg>
        </span>
        <span class="pm-codigo">{{ textoPlaca() }}</span>
      </a>
    } @else {
      <span class="placa-mercosul" [class]="'pm-' + tamanho">
        <span class="pm-topo">
          <!-- Logo Mercosul -->
          <svg class="pm-logo" viewBox="0 0 16 16" width="10" height="10" fill="none">
            <path d="M 2 13 C 2 7, 7 3, 14 3" stroke="#4ade80" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="7" cy="6" r="1.1" fill="#ffffff"/>
            <circle cx="9.2" cy="8" r="1.1" fill="#ffffff"/>
            <circle cx="6" cy="10" r="1.1" fill="#ffffff"/>
            <circle cx="10.2" cy="11.2" r="1.1" fill="#ffffff"/>
          </svg>

          <span class="pm-pais">BRASIL</span>

          <!-- Bandeira do Brasil Oficial SVG -->
          <svg class="pm-bandeira" viewBox="0 0 20 14" width="13" height="9">
            <rect width="20" height="14" fill="#009c3b" rx="1"/>
            <polygon points="10,1.5 18.5,7 10,12.5 1.5,7" fill="#ffdf00"/>
            <circle cx="10" cy="7" r="3.2" fill="#002776"/>
            <path d="M 7.2 7.6 Q 10 5.8 12.8 7.2" stroke="#ffffff" stroke-width="0.7" fill="none"/>
          </svg>
        </span>
        <span class="pm-codigo">{{ textoPlaca() }}</span>
      </span>
    }
  `
})
export class PlacaMercosulComponent {
  @Input({ required: true }) placa!: string | null | undefined;
  @Input() tamanho: 'xs' | 'sm' | 'md' | 'lg' = 'sm';
  @Input() link?: any[] | string;

  textoPlaca = computed(() => {
    const raw = String(this.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.length === 7) {
      // Exibe sem hífen ou com espaço fino típico da placa física Mercosul
      return raw;
    }
    return this.placa || '—';
  });
}
