# -*- coding: utf-8 -*-
"""
Extrai o bloco CORES / ESTAMPAS de cada referencia dos catalogos, ref por ref.

Diferencas para a primeira versao:
  * a geometria vem da camada VETORIAL e da lista de IMAGENS da pagina (centro,
    raio, ordem) — nao de adivinhar a posicao a partir do numero embaixo;
  * uma opcao de cor pode ter 1 ou 2 bolinhas (blusa + calca). O agrupamento e
    por ENCOSTAMENTO em x: bolinhas da mesma opcao se sobrepoem, opcoes vizinhas
    tem folga;
  * a cor sai de um quadradinho DESLOCADO para a esquerda do centro, porque o
    centro da bolinha de tras fica coberto pela da frente;
  * a fronteira entre dois blocos e a numeracao REINICIAR (01 02 | 01 02 03);
  * o casamento referencia <-> bloco e por CONTAGEM, nao por distancia.
"""
import json
import re
import sys

import fitz

REF = re.compile(r"^\d{4}$")
NUM = re.compile(r"^\d{1,2}$")

DPI = 200
ESCALA = DPI / 72.0
BANDA_Y = 790          # o bloco de cores vive no rodape da pagina
GAP_OPCAO = -5.0       # bolinhas da mesma opcao se SOBREPOEM; vizinhas so encostam
GAP_BLOCO = 30.0       # folga que separa dois blocos, quando nao ha numeracao


def quase_quadrado(r):
    return 18 < r.width < 40 and 18 < r.height < 40 and abs(r.width - r.height) < 2.5


def circulos_da_pagina(pagina):
    """Bolinhas do rodape. Vetoriais e as que sao imagem (tecido texturizado)."""
    achados = []

    for i, d in enumerate(pagina.get_drawings()):
        r = d["rect"]
        # Sem preenchimento e o anel branco entre as duas bolinhas, nao e cor.
        if r.y0 < BANDA_Y or not quase_quadrado(r) or d.get("fill") is None:
            continue
        achados.append({"z": i, "rect": r, "fill": d["fill"], "img": False})

    for im in pagina.get_image_info():
        r = fitz.Rect(im["bbox"])
        if r.y0 < BANDA_Y or not quase_quadrado(r):
            continue
        achados.append({"z": 1000 + len(achados), "rect": r, "fill": None, "img": True})

    # Uma bolinha de imagem costuma vir por cima de um retangulo de fundo com a
    # mesma caixa. Fica so a imagem — o fill ali e um verde de placeholder.
    vetoriais = [a for a in achados if not a["img"]]
    imagens = [a for a in achados if a["img"]]
    sobrando = [
        a for a in vetoriais
        if not any(abs(a["rect"].x0 - b["rect"].x0) < 3 and abs(a["rect"].y0 - b["rect"].y0) < 3
                   for b in imagens)
    ]
    achados = sobrando + imagens

    # O anel branco tem o mesmo centro da bolinha da frente. Descartar por
    # tamanho perderia o branco de verdade (1043 tem uma bolinha branca).
    fora = set()
    for a in achados:
        if a["fill"] != (1.0, 1.0, 1.0):
            continue
        ca = ((a["rect"].x0 + a["rect"].x1) / 2, (a["rect"].y0 + a["rect"].y1) / 2)
        for b in achados:
            if b is a or b["fill"] == (1.0, 1.0, 1.0):
                continue
            cb = ((b["rect"].x0 + b["rect"].x1) / 2, (b["rect"].y0 + b["rect"].y1) / 2)
            if abs(ca[0] - cb[0]) < 1.5 and abs(ca[1] - cb[1]) < 1.5:
                fora.add(a["z"])
    achados = [a for a in achados if a["z"] not in fora]

    saida = []
    for a in achados:
        r = a["rect"]
        saida.append({
            "z": a["z"], "img": a["img"], "fill": a["fill"],
            "x0": r.x0, "x1": r.x1, "y0": r.y0, "y1": r.y1,
            "cx": (r.x0 + r.x1) / 2, "cy": (r.y0 + r.y1) / 2,
        })
    return sorted(saida, key=lambda c: c["x0"])


def cor_da_bolinha(pix, c, limite_x=None):
    """
    Media do DISCO inteiro, nao de um quadradinho no centro: em bolinha de
    estampa (floral, listra) um quadradinho cai dentro de uma flor e devolve a
    cor da flor, nao a da peca.

    `limite_x` corta a parte que a bolinha da frente cobre — o centro da de tras
    fica escondido, e amostrar ali devolvia a media das duas.
    Devolve tambem o desvio, que denuncia estampa.
    """
    raio = (c["x1"] - c["x0"]) / 2 * 0.88
    cx, cy = c["cx"], c["cy"]
    amostras = []
    passo = max(1, int(ESCALA / 3))
    x_ini = int((cx - raio) * ESCALA)
    x_fim = int(min(cx + raio, limite_x if limite_x is not None else 1e9) * ESCALA)
    for i in range(max(0, x_ini), min(pix.width, x_fim), passo):
        dx = i / ESCALA - cx
        dy_max = (raio * raio - dx * dx) ** 0.5 if abs(dx) < raio else 0
        j0 = int((cy - dy_max) * ESCALA)
        j1 = int((cy + dy_max) * ESCALA)
        for j in range(max(0, j0), min(pix.height, j1), passo):
            amostras.append(pix.pixel(i, j)[:3])
    if not amostras:
        return None, 0.0
    n = len(amostras)
    med = [sum(a[k] for a in amostras) / n for k in range(3)]
    desvio = max(
        (sum((a[k] - med[k]) ** 2 for a in amostras) / n) ** 0.5 for k in range(3)
    )
    return "#%02X%02X%02X" % tuple(int(round(v)) for v in med), desvio


def agrupar(itens, folga, x0, x1):
    grupos = []
    for it in sorted(itens, key=x0):
        if grupos and x0(it) - max(x1(g) for g in grupos[-1]) <= folga:
            grupos[-1].append(it)
        else:
            grupos.append([it])
    return grupos


def extrair_pagina(pagina, origem):
    circulos = circulos_da_pagina(pagina)
    if not circulos:
        return []

    palavras = pagina.get_text("words")
    rotulos = [
        {"txt": w[4].strip().upper(), "cx": (w[0] + w[2]) / 2, "cy": (w[1] + w[3]) / 2,
         "x0": w[0], "x1": w[2]}
        for w in palavras if w[1] > BANDA_Y - 20
    ]

    # Bolinha-selo: tem VARIADAS ou UNICA escrito DENTRO dela.
    for c in circulos:
        c["selo"] = None
        for r in rotulos:
            if not ("VARIAD" in r["txt"] or "NICA" in r["txt"]):
                continue
            if c["x0"] - 2 < r["cx"] < c["x1"] + 2 and c["y0"] - 2 < r["cy"] < c["y1"] + 2:
                c["selo"] = "variadas" if "VARIAD" in r["txt"] else "unica"

    pix = pagina.get_pixmap(dpi=DPI)

    # ── opcoes: bolinhas encostadas sao a MESMA opcao (blusa + calca) ─────────
    opcoes = []
    for grupo in agrupar(circulos, GAP_OPCAO, lambda c: c["x0"], lambda c: c["x1"]):
        # a da frente e a da direita — vale para vetor e para imagem
        frente = max(grupo, key=lambda c: c["x0"])
        bolinhas = []
        for c in grupo:
            # a de tras so aparece ate onde a da frente comeca (menos o anel)
            corte = None if c is frente else frente["x0"] - 1.5
            hexa, desvio = cor_da_bolinha(pix, c, corte)
            bolinhas.append({
                "hex": hexa, "estampa": desvio > 16, "frente": c is frente,
                "selo": c["selo"], "badge": bool(c["selo"]),
            })
        opcoes.append({
            "x0": min(c["x0"] for c in grupo),
            "x1": max(c["x1"] for c in grupo),
            "y1": max(c["y1"] for c in grupo),
            "selo": next((c["selo"] for c in grupo if c["selo"]), None),
            "bolinhas": bolinhas,
            "codigo": None,
        })

    # numero de cada opcao (01, 02 ...): fica logo abaixo, dentro da faixa em x
    numeros = [r for r in rotulos if NUM.match(r["txt"])]
    for o in opcoes:
        # O numero fica ABAIXO da bolinha. Sem essa trava, a faixa de tamanho
        # ("48 AO 54", "10 AO 16"), que tambem e numero de dois digitos e mora
        # logo acima, virava codigo de cor.
        perto = [
            n for n in numeros
            if o["x0"] - 4 < n["cx"] < o["x1"] + 4 and o["y1"] < n["cy"] < o["y1"] + 25
        ]
        if perto:
            o["codigo"] = perto[0]["txt"].zfill(2)

    # ── blocos: a numeracao REINICIAR e a fronteira ──────────────────────────
    blocos = []
    for o in opcoes:
        novo = not blocos
        if not novo:
            ant = blocos[-1][-1]
            # Compara com a ultima opcao NUMERADA do bloco: o selo VARIADAS fecha
            # o bloco sem numero, e comparar com ele perdia o reinicio da conta.
            ultimo_num = next(
                (x["codigo"] for x in reversed(blocos[-1]) if x["codigo"]), None
            )
            if o["codigo"] and ultimo_num:
                novo = int(o["codigo"]) <= int(ultimo_num)
            else:
                novo = o["x0"] - ant["x1"] > GAP_BLOCO
        # o selo fecha o bloco: nunca comeca um
        if novo and o["selo"] and blocos:
            novo = o["x0"] - blocos[-1][-1]["x1"] > GAP_BLOCO
        (blocos.append([o]) if novo else blocos[-1].append(o))

    blocos = [{"cx": (b[0]["x0"] + b[-1]["x1"]) / 2, "opcoes": b} for b in blocos]

    # rotulo UNICA escrito ABAIXO da bolinha, e nao dentro (verao p.72)
    for b in blocos:
        if len(b["opcoes"]) == 1 and not b["opcoes"][0]["selo"]:
            o = b["opcoes"][0]
            if any("NICA" in r["txt"] and o["x0"] - 20 < r["cx"] < o["x1"] + 20
                   for r in rotulos):
                o["selo"] = "unica"

    # ── referencias da pagina ────────────────────────────────────────────────
    refs = []
    for w in palavras:
        if not REF.match(w[4].strip()):
            continue
        vizinhas = [
            v for v in palavras
            if abs(v[1] - w[1]) < 4 and v[0] > w[2] and v[0] - w[2] < 90
        ]
        nome = " ".join(v[4] for v in sorted(vizinhas, key=lambda v: v[0])).strip()
        if nome and nome == nome.upper() and any(ch.isalpha() for ch in nome):
            refs.append({"sku": w[4].strip(), "nome": nome, "cx": w[0] + 20})
    refs.sort(key=lambda r: r["cx"])
    if not refs:
        return []

    # ── casamento ref <-> bloco ──────────────────────────────────────────────
    if len(blocos) == len(refs):
        pares = list(zip(refs, sorted(blocos, key=lambda b: b["cx"])))
        confianca = "pareado"
    elif len(blocos) == 1:
        pares = [(r, blocos[0]) for r in refs]
        confianca = "compartilhado"
    else:
        pares = [(r, min(blocos, key=lambda b: abs(b["cx"] - r["cx"]))) for r in refs]
        confianca = "REVISAR"

    saida = []
    for r, b in pares:
        cores = []
        for i, o in enumerate(b["opcoes"]):
            frente = next((x for x in o["bolinhas"] if x["frente"]), o["bolinhas"][0])
            atras = [x for x in o["bolinhas"] if not x["frente"]]
            # A bolinha-selo (VARIADAS / UNICA escrito dentro) e um cinza
            # decorativo: nao e a cor da peca, e nao tem numero no catalogo.
            selo_dentro = any(x["badge"] for x in o["bolinhas"])
            cores.append({
                "codigo": o["codigo"] or ("VAR" if selo_dentro else str(i + 1).zfill(2)),
                "hex": None if selo_dentro else frente["hex"],
                "badge": selo_dentro,
                "hex_par": None if selo_dentro else (atras[0]["hex"] if atras else None),
                # separado por bolinha: numa opcao "liso + estampa" e o LISO que
                # batiza a cor, e para saber qual e qual isso nao pode vir junto
                "estampa": frente["estampa"],
                "estampa_par": atras[0]["estampa"] if atras else None,
                "selo": o["selo"],
                "ordem": i,
            })
        saida.append({
            "sku": r["sku"], "nome": r["nome"], "cores": cores,
            "origem": origem, "confianca": confianca,
        })
    return saida


def main(caminhos):
    """
    A ORDEM dos PDFs na linha de comando manda: o primeiro e o catalogo mais
    novo. Uma referencia repetida nos dois (o 1034, o 0719, o 0852...) muda de
    cor de uma colecao para a outra, e quem vale e a colecao vigente.
    """
    saida = {}
    conflitos = []
    for caminho in caminhos:
        doc = fitz.open(caminho)
        arq = caminho.replace("\\", "/").split("/")[-1]
        for i, pagina in enumerate(doc):
            for item in extrair_pagina(pagina, f"{arq} p.{i+1}"):
                antigo = saida.get(item["sku"])
                if antigo is None:
                    saida[item["sku"]] = item
                elif [c["hex"] for c in antigo["cores"]] != [c["hex"] for c in item["cores"]]:
                    conflitos.append((item["sku"], antigo["origem"], item["origem"]))
        print(f"lido: {arq}", file=sys.stderr)
    for sku, fica, sai in conflitos:
        print(f"  repetida: {sku} — vale {fica}, ignorado {sai}", file=sys.stderr)
    print(f"referencias: {len(saida)}  repetidas: {len(conflitos)}", file=sys.stderr)
    print(json.dumps(saida, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    # No Windows o stdout sai em cp1252 e o JSON com acento nasce corrompido.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
