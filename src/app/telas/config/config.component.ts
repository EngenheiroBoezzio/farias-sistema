/* Configuração do app.
 *
 * É aqui que se aponta para o servidor. A URL fica gravada fora do bundle, o
 * que significa que trocar de máquina ou de endereço interno NÃO exige gerar
 * um instalador novo. */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigService, TamanhoFonte, TemaApp, FrequenciaAtualizacao, TipoGrafico } from '../../nucleo/config.service';
import { DadosService } from '../../nucleo/dados.service';
import { SinoComponent } from '../../partes/sino/sino.component';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [FormsModule, SinoComponent],
  templateUrl: './config.component.html'
})
export class ConfigComponent implements OnInit {
  cfg = inject(ConfigService);
  private dados = inject(DadosService);

  f = {
    apiUrl: '',
    nomeLoja: '',
    canalWhatsapp: '',
    tamanhoFonte: 'normal' as TamanhoFonte,
    tema: 'adaptativo' as TemaApp,
    frequenciaAtualizacao: 'semanal' as FrequenciaAtualizacao,
    tipoGrafico: 'linha' as TipoGrafico
  };

  testando = signal(false);
  salvando = signal(false);
  resultado = signal<{ ok: boolean; texto: string } | null>(null);
  salvo = signal<string | null>(null);
  versao = signal<string>('—');
  atualizacao = signal<string | null>(null);
  catalogo = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const c = this.cfg.config();
    this.f = {
      apiUrl: c.apiUrl,
      nomeLoja: c.nomeLoja,
      canalWhatsapp: c.canalWhatsapp,
      tamanhoFonte: c.tamanhoFonte || 'normal',
      tema: c.tema || 'adaptativo',
      frequenciaAtualizacao: c.frequenciaAtualizacao || 'semanal',
      tipoGrafico: c.tipoGrafico || 'linha'
    };
    try {
      if (window.farias?.versao) this.versao.set(await window.farias.versao());
    } catch { /* fora do Electron não tem versão de instalador */ }
  }

  selecionarFonte(tf: TamanhoFonte): void {
    this.f.tamanhoFonte = tf;
    this.mudarAparencia();
  }

  selecionarTipoGrafico(tipo: TipoGrafico): void {
    this.f.tipoGrafico = tipo;
    this.mudarAparencia();
  }

  mudarAparencia(): void {
    this.cfg.salvar({
      tamanhoFonte: this.f.tamanhoFonte,
      tema: this.f.tema,
      tipoGrafico: this.f.tipoGrafico
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
