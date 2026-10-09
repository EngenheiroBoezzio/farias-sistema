# -*- coding: utf-8 -*-
"""Extrai o catálogo Wega linha leve por COORDENADA.

O texto achatado perde a coluna: há linhas sem filtro de óleo em que o código
de combustível ficaria no lugar do óleo. Aqui cada palavra é atribuída à coluna
cujo intervalo de x a contém, que é a única leitura fiel da tabela.
"""
import json, re, sys, unicodedata
import pdfplumber

ARQ = sys.argv[1] if len(sys.argv) > 1 else 'wega-linha-leve.pdf'
SAIDA = sys.argv[2] if len(sys.argv) > 2 else 'catalogo_wega.json'

# rótulo do cabeçalho -> chave de saída, na ordem em que aparecem
COLUNAS = [
    ('Nome da Montadora',              'marca'),
    ('Nome do Modelo',                 'modelo'),
    ('Classificação do Modelo',        'versao'),
    ('Ano',                            'ano'),
    ('Filtro do Ar',                   'ar'),
    ('Filtro do Óleo',                 'oleo'),
    ('Filtro do Óleo Opcional',        'oleo_opc'),
    ('Filtro do Combustível',          'combustivel'),
    ('Filtro de Combustível Opcional', 'combustivel_opc'),
    ('Filtro de Cabine',               'cabine'),
    ('Filtro de Cabine com Carvão',    'cabine_carvao'),
    ('Posição',                        'posicao'),
]

# Um código Wega é letras + dígito (FAP5303, WO170, AKX1110/C, FAP9282-2).
# Sobras da arte da página (um "W" solto do rodapé) precisam cair fora:
# código inválido gravado no banco vira peça errada no balcão.
COD = re.compile(r'^[A-Z]{1,5}[0-9][A-Z0-9/.\-]*$')

def limpa(s):
    s = s.replace('‐', '-').replace('‑', '-').replace('‒', '-')
    s = s.replace('–', '-').replace('—', '-').replace(' ', ' ')
    return re.sub(r'\s+', ' ', s).strip()

def achar_colunas(palavras):
    """Devolve [(x0_inicio, chave)] lendo a linha de cabeçalho desta página."""
    alvo = [w for w in palavras if w['text'] == 'Montadora']
    if not alvo:
        return None, None
    ytop = alvo[0]['top']
    linha = sorted([w for w in palavras if abs(w['top'] - ytop) < 3], key=lambda w: w['x0'])
    texto = ' '.join(w['text'] for w in linha)
    # casa cada rótulo, em ordem, consumindo as palavras da linha
    inicios, i = [], 0
    for rotulo, chave in COLUNAS:
        toks = rotulo.split()
        if i + len(toks) > len(linha):
            return None, None
        achou = [w['text'] for w in linha[i:i + len(toks)]]
        if achou != toks:
            return None, None
        inicios.append((linha[i]['x0'], chave))
        i += len(toks)
    return inicios, ytop

def coluna_de(x, inicios):
    """Última coluna cujo início fica à esquerda da palavra (com folga de 4pt)."""
    chave = inicios[0][1]
    for x0, k in inicios:
        if x >= x0 - 4:
            chave = k
        else:
            break
    return chave

linhas, avisos = [], []
with pdfplumber.open(ARQ) as pdf:
    for npag, pag in enumerate(pdf.pages, 1):
        # O PDF traz cópias das páginas vizinhas jogadas para FORA do papel
        # (x chega a -1315). Sem recortar na área visível, essas sobras viram
        # linhas duplicadas e chegam a se misturar com a linha de verdade.
        visivel = pag.crop((0, 0, pag.width, pag.height))
        palavras = visivel.extract_words(use_text_flow=False, keep_blank_chars=False)
        if not palavras:
            continue
        inicios, ycab = achar_colunas(palavras)
        if not inicios:
            continue

        # agrupa por linha (mesmo "top", com tolerância)
        porlinha = {}
        for w in palavras:
            if w['top'] <= ycab + 3:
                continue
            chave = round(w['top'] / 3.0)
            porlinha.setdefault(chave, []).append(w)

        for _, ws in sorted(porlinha.items()):
            celulas = {k: [] for _, k in COLUNAS}
            for w in sorted(ws, key=lambda w: w['x0']):
                k = coluna_de(w['x0'], inicios)
                # "W" solto vem da arte da página e chega a grudar num código
                # de verdade ("FCI1306 W"): descartar o token, não a célula.
                if w['text'] == 'W' and k not in ('marca', 'modelo', 'versao', 'ano', 'posicao'):
                    continue
                celulas[k].append(w['text'])
            reg = {k: limpa(' '.join(v)) for k, v in celulas.items()}
            for _, k in COLUNAS:
                if k in ('marca', 'modelo', 'versao', 'ano', 'posicao'):
                    continue
                if reg[k] and not COD.match(reg[k]):
                    avisos.append((npag, k, reg[k], reg['marca'], reg['modelo']))
                    reg[k] = ''
            if not reg['marca'] or not reg['modelo']:
                continue
            if reg['marca'].startswith('CATÁLOGO'):
                continue
            reg['pagina'] = npag
            reg['linha_bruta'] = limpa(' '.join(w['text'] for w in sorted(ws, key=lambda w: w['x0'])))
            linhas.append(reg)

print(f'linhas extraidas: {len(linhas)}')
if avisos:
    print(f'valores descartados por nao parecerem codigo: {len(avisos)}')
    vistos = {}
    for pag, col, val, ma, mo in avisos:
        vistos.setdefault((col, val), 0)
        vistos[(col, val)] += 1
    for (col, val), n in sorted(vistos.items(), key=lambda x: -x[1])[:12]:
        print(f'   {col:18} {val!r} x{n}')
json.dump(linhas, open(SAIDA, 'w', encoding='utf-8'), ensure_ascii=False)
print(f'gravado em {SAIDA}')
