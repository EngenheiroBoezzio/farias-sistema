/* O canal do WhatsApp da oficina: ideias de publicação e histórico.
 *
 * Duas decisões que valem explicação.
 *
 * 1. As ideias saem dos NÚMEROS DA CASA, não de um gerador de frase pronta.
 *    Cada ideia carrega em `base` de onde veio o número que ela cita, e as
 *    que não citam número nenhum vêm marcadas como `modelo`. Isso não é
 *    escrúpulo de programador: quem publica assina o que escreveu, e um
 *    número inventado num canal com 300 clientes é o tipo de erro que só
 *    aparece quando alguém responde perguntando.
 *
 * 2. O histórico mora NESTE COMPUTADOR, não no servidor. A tabela de
 *    publicações ainda não existe na API (item B do DESIGN.md). Até existir,
 *    a tela diz isso com todas as letras em vez de fingir que sabe o que foi
 *    publicado do celular da Raíssa. Quando a rota chegar, só a origem muda:
 *    a tela já conversa por este serviço.
 */
import { Injectable, inject, signal } from '@angular/core';
import { DadosService } from './dados.service';
import { ConfigService } from './config.service';
import { Painel } from './tipos';
import { firstValueFrom } from 'rxjs';

export type FonteIdeia = 'numero' | 'modelo';

export interface Ideia {
  id: string;
  titulo: string;
  /** por que publicar isto agora */
  porque: string;
  /** de onde veio o número — ou 'modelo', quando não cita nenhum */
  fonte: FonteIdeia;
  base: string;
  texto: string;
}

export interface Publicacao {
  id: string;
  quando: string;      // ISO
  texto: string;
  deIdeia?: string;    // título da ideia que originou, quando houve
}

const CHAVE_HIST = 'farias.comunidade.publicacoes';
const LIMITE_HIST = 60;

@Injectable({ providedIn: 'root' })
export class ComunidadeService {
  private dados = inject(DadosService);
  private cfg = inject(ConfigService);

  /** Histórico local, já em memória para a tela reagir sem reler o disco. */
  private _historico = signal<Publicacao[]>(this.lerHistorico());
  readonly historico = this._historico.asReadonly();

  get canal(): string { return this.cfg.canalWhatsapp; }
  get temCanal(): boolean { return /^https?:\/\//i.test(this.canal); }

  /** Dias desde a última publicação REGISTRADA AQUI. null se nunca houve. */
  diasDesdeUltima(): number | null {
    const u = this._historico()[0];
    if (!u) return null;
    const ms = Date.now() - new Date(u.quando).getTime();
    return Math.max(0, Math.floor(ms / 86_400_000));
  }

  /* ---------- histórico ---------- */

  private lerHistorico(): Publicacao[] {
    try {
      const cru = localStorage.getItem(CHAVE_HIST);
      if (!cru) return [];
      const arr = JSON.parse(cru);
      return Array.isArray(arr) ? arr.filter(p => p && p.texto && p.quando) : [];
    } catch { return []; }
  }

  registrar(texto: string, deIdeia?: string): void {
    const p: Publicacao = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      quando: new Date().toISOString(),
      texto: texto.trim(),
      deIdeia
    };
    const novo = [p, ...this._historico()].slice(0, LIMITE_HIST);
    this._historico.set(novo);
    try { localStorage.setItem(CHAVE_HIST, JSON.stringify(novo)); } catch { /* disco cheio */ }
  }

  remover(id: string): void {
    const novo = this._historico().filter(p => p.id !== id);
    this._historico.set(novo);
    try { localStorage.setItem(CHAVE_HIST, JSON.stringify(novo)); } catch { /* segue */ }
  }

  /* ---------- ideias ---------- */

  /** Lê o painel e a fila de vencidos e monta as sugestões do dia. */
  async ideias(): Promise<Ideia[]> {
    const painel = await firstValueFrom(this.dados.painel());
    let vencidos = painel.resumo?.vencido ?? 0;
    /* O painel já traz a contagem; a fila só é consultada se ele não trouxer,
       para não pedir 25 linhas que ninguém vai ler. */
    if (!Number.isFinite(vencidos)) vencidos = 0;
    return this.montar(painel, vencidos);
  }

  private montar(p: Painel, vencidos: number): Ideia[] {
    const loja = this.cfg.nomeLoja || 'Farias Troca de Óleo';
    const out: Ideia[] = [];

    /* 1. Chamado geral de revisão — só faz sentido se há carros vencidos.
          O texto NÃO cita o número: quantos clientes estão atrasados é
          assunto interno da oficina, não manchete de canal. */
    if (vencidos > 0) {
      out.push({
        id: 'vencidos',
        titulo: 'Chamar quem está atrasado',
        porque: `${vencidos} ${vencidos === 1 ? 'carro está' : 'carros estão'} com a troca vencida na base. `
              + 'Um recado no canal alcança quem não atende telefone.',
        fonte: 'numero',
        base: `${vencidos} em situação vencida no painel de hoje`,
        texto:
`🔧 Faz tempo que seu carro não passa aqui?

Se a última troca já passou dos 5 mil km — ou de 6 meses — o óleo já perdeu boa parte da proteção, mesmo que o carro esteja rodando normal.

Passa aqui que a gente confere o nível e te diz na hora se precisa trocar. A conferida não custa nada.

${loja}`
      });
    }

    /* 2. O óleo que mais sai. Número real, vindo do ranking do painel. */
    const oleo = (p.oleos || []).filter(o => o.nome && o.n > 0)[0];
    if (oleo) {
      out.push({
        id: 'oleo',
        titulo: `O óleo da casa: ${oleo.nome}`,
        porque: 'É o óleo que mais sai daqui. Mostrar o que se usa passa confiança '
              + 'e evita a pergunta "vocês têm o do meu carro?".',
        fonte: 'numero',
        base: `${oleo.nome} lidera o ranking de óleos do painel (${oleo.n} usos)`,
        texto:
`🛢️ Trabalhamos com ${oleo.nome}

É o óleo que mais usamos aqui na oficina, e tem para praticamente todos os carros que passam pela nossa porta.

Não sabe qual é o do seu? Manda a placa que a gente confere.

${loja}`
      });
    }

    /* 3. Movimento do mês. Sai do último ponto da série do painel. */
    const ultimo = (p.serie || [])[(p.serie || []).length - 1];
    if (ultimo && ultimo.n > 0) {
      out.push({
        id: 'movimento',
        titulo: `${ultimo.n} ${ultimo.n === 1 ? 'troca' : 'trocas'} este mês`,
        porque: 'Movimento é prova social. Publique se estiver confortável em '
              + 'mostrar o número — ele é real e sai do seu próprio painel.',
        fonte: 'numero',
        base: `série mensal do painel, mês ${ultimo.mes}`,
        texto:
`Obrigado por mais um mês 🙏

Foram ${ultimo.n} ${ultimo.n === 1 ? 'carro atendido' : 'carros atendidos'} aqui, cada um com o óleo e o filtro certos para ele.

Quem ainda não passou, a gente espera. Quem já passou, obrigado pela confiança.

${loja}`
      });
    }

    /* 4 a 6. Modelos. Não citam número nenhum — e vêm marcados assim,
       para ninguém achar que a oficina mediu o que não mediu. */
    out.push({
      id: 'filtro-cabine',
      titulo: 'O filtro que todo mundo esquece',
      porque: 'O filtro de cabine é o mais esquecido e o mais fácil de vender '
            + 'no balcão, porque o cliente sente a diferença no mesmo dia.',
      fonte: 'modelo',
      base: 'texto modelo — não usa número nenhum',
      texto:
`😷 O filtro que quase ninguém lembra

O filtro de cabine (o do ar-condicionado) é o que limpa o ar que VOCÊ respira dentro do carro. Quando ele satura, aparece cheiro de mofo, o ar sai fraco e o vidro embaça mais.

Na próxima troca de óleo, pede para a gente dar uma olhada nele. É rápido.

${loja}`
    });

    out.push({
      id: 'quando-trocar',
      titulo: 'Quando trocar, afinal',
      porque: 'A dúvida mais comum do balcão. Responder no canal economiza '
            + 'explicação repetida e traz gente para a porta.',
      fonte: 'modelo',
      base: 'texto modelo — não usa número nenhum',
      texto:
`❓ "Mas quando eu tenho que trocar o óleo?"

Vale o que vier primeiro:
• a quilometragem do adesivo no vidro
• ou 6 meses, mesmo que o carro tenha rodado pouco

Carro parado também envelhece óleo: a umidade entra e ele perde a proteção sem rodar um quilômetro.

Na dúvida, passa aqui que a gente olha.

${loja}`
    });

    out.push({
      id: 'recado',
      titulo: 'Recado da oficina',
      porque: 'Horário diferente, feriado, promoção, aviso de férias. '
            + 'Comece por aqui e escreva o seu.',
      fonte: 'modelo',
      base: 'em branco — para escrever do zero',
      texto: `📣 \n\n\n${loja}`
    });

    return out;
  }
}
