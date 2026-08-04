# -*- coding: utf-8 -*-
"""
Extrai o bloco CORES / ESTAMPAS de cada referencia dos catalogos.

Estrategia:
  1. numeros de cor (01..NN) sao palavras logo abaixo das bolinhas;
  2. a cor de cada bolinha vem do PIXEL renderizado, nao da camada vetorial
     (as bolinhas tem circulos sobrepostos e a ordem de desenho engana);
  3. o rotulo VARIADAS fica ACIMA da bolinha a que se refere — casa por x;
  4. os produtos da pagina (ref de 4 digitos + nome em maiuscula) recebem o
     bloco daquela pagina.
"""
import json
import re
import sys
import pdfplumber

REF = re.compile(r"^\d{4}$")
NUM_COR = re.compile(r"^\d{2}$")


def media_cor(imagem, cx, cy, raio=4):
    """Cor media de um quadradinho no centro da bolinha."""
    px = imagem.load()
    larg, alt = imagem.size
    soma = [0, 0, 0]
    n = 0
    for x in range(max(0, cx - raio), min(larg, cx + raio)):
        for y in range(max(0, cy - raio), min(alt, cy + raio)):
            p = px[x, y]
            soma[0] += p[0]
            soma[1] += p[1]
            soma[2] += p[2]
            n += 1
    if n == 0:
        return None
    return "#%02X%02X%02X" % tuple(v // n for v in soma)


def agrupar_por_linha(itens, chave_y, tolerancia=12):
    """Agrupa por faixa de Y. Uma pagina pode ter mais de um bloco de cores."""
    linhas = []
    for it in sorted(itens, key=chave_y):
        y = chave_y(it)
        if linhas and abs(chave_y(linhas[-1][0]) - y) <= tolerancia:
            linhas[-1].append(it)
        else:
            linhas.append([it])
    return linhas


def extrair_pagina(pagina, resolucao=150):
    palavras = pagina.extract_words()

    bolinhas = [
        c for c in pagina.curves
        if 15 < (c["x1"] - c["x0"]) < 40 and 15 < (c["bottom"] - c["top"]) < 40
    ]

    # Em algumas paginas as bolinhas sao IMAGEM, nao desenho vetorial — ali
    # `curves` vem vazio. Nesses casos a numeracao no rodape denuncia o bloco:
    # a bolinha fica ~16pt acima do numero. Sem isto a pagina inteira se perdia.
    if not bolinhas:
        # Ancora no cabecalho "CORES / ESTAMPAS": so numero ABAIXO dele e cor.
        # Sem essa ancora, "01 AO 08" e "10 AO 16" (as faixas de TAMANHO, que
        # tambem sao dois digitos e ficam no rodape) entravam como se fossem cor.
        cabecalho = [w for w in palavras if w["text"].strip().upper() in {"CORES", "ESTAMPAS"}]
        if not cabecalho:
            return [], []
        y_cabecalho = min(w["top"] for w in cabecalho)

        numeros_rodape = [
            w for w in palavras
            if NUM_COR.match(w["text"].strip()) and w["top"] > y_cabecalho
        ]
        if len(numeros_rodape) < 2:
            return [], []
        y_num = min(w["top"] for w in numeros_rodape)
        bolinhas = [
            {"x0": w["x0"], "x1": w["x1"], "top": y_num - 29, "bottom": y_num - 3}
            for w in numeros_rodape
            if abs(w["top"] - y_num) < 6
        ]

    rotulos = [
        w for w in palavras
        if "VARIAD" in w["text"].upper()
        or "ÚNIC" in w["text"].upper()
        or "UNIC" in w["text"].upper()
    ]

    img = pagina.to_image(resolution=resolucao).original
    escala = resolucao / 72.0

    # Cada FILEIRA de bolinhas e um bloco separado. Sem isso, uma pagina com
    # dois blocos vira um produto com 7 cores (o 1004 PLUSH virou exatamente isso).
    blocos = []
    for fileira in agrupar_por_linha(bolinhas, lambda b: b["top"]):
        y_bolinha = min(b["top"] for b in fileira)
        numeros = sorted(
            (
                w for w in palavras
                if NUM_COR.match(w["text"].strip())
                and y_bolinha + 10 < w["top"] < y_bolinha + 45
            ),
            key=lambda w: w["x0"],
        )
        if not numeros:
            # Bloco SEM numeracao: uma bolinha so, rotulada ÚNICA ou VARIADAS.
            # E o layout mais comum das paginas com duas referencias lado a lado
            # (ex.: 1008 e 1009 dividindo a mesma bolinha). Exigir numero aqui
            # descartava a pagina inteira — 33 das 42 paginas sem cor eram isto.
            rotulo_perto = [
                r for r in rotulos
                if y_bolinha - 40 < r["top"] < y_bolinha + 50
            ]
            if not rotulo_perto:
                continue

            texto = " ".join(r["text"] for r in rotulo_perto).upper()
            eh_variada = "VARIAD" in texto
            for bolinha in fileira:
                cx_pt = (bolinha["x0"] + bolinha["x1"]) / 2
                hexa = media_cor(img, int(cx_pt * escala), int((y_bolinha + 13) * escala))
                blocos.append({
                    "y": y_bolinha,
                    "x_centro": cx_pt,
                    "cores": [{
                        "codigo": "01",
                        "hex": hexa,
                        "variadas": eh_variada,
                        "ordem": 0,
                        "unica": not eh_variada,
                    }],
                })
            continue

        # Dois blocos podem dividir a MESMA fileira, lado a lado (o 1004 PLUSH e
        # assim). O sinal de fronteira e a numeracao reiniciar: 01 02 03 | 01 02 03.
        grupos = []
        for num in numeros:
            valor = int(num["text"])
            if not grupos or valor <= int(grupos[-1][-1]["text"]):
                grupos.append([num])
            else:
                grupos[-1].append(num)

        for grupo in grupos:
            cores = []
            for i, num in enumerate(grupo):
                cx_pt = (num["x0"] + num["x1"]) / 2
                hexa = media_cor(img, int(cx_pt * escala), int((y_bolinha + 13) * escala))
                eh_variada = any(
                    abs(((r["x0"] + r["x1"]) / 2) - cx_pt) < 24
                    and "VARIAD" in r["text"].upper()
                    and y_bolinha - 30 < r["top"] < y_bolinha + 45
                    for r in rotulos
                )
                cores.append({
                    "codigo": num["text"].strip(),
                    "hex": hexa,
                    "variadas": eh_variada,
                    "ordem": i,
                })

            x_ini = min(n["x0"] for n in grupo)
            x_fim = max(n["x1"] for n in grupo)
            marcou_unica = any(
                ("UNIC" in r["text"].upper() or "ÚNIC" in r["text"].upper())
                and y_bolinha - 30 < r["top"] < y_bolinha + 45
                and x_ini - 30 < ((r["x0"] + r["x1"]) / 2) < x_fim + 30
                for r in rotulos
            )
            for c in cores:
                c["unica"] = marcou_unica or len(cores) == 1

            blocos.append({
                "y": y_bolinha,
                "x_centro": (x_ini + x_fim) / 2,
                "cores": cores,
            })

    if not blocos:
        return [], []

    # produtos da pagina: "0171" seguido de nome em maiuscula na mesma linha
    refs = []
    for w in palavras:
        if REF.match(w["text"].strip()):
            mesma_linha = [
                v for v in palavras
                if abs(v["top"] - w["top"]) < 4 and v["x0"] > w["x1"] and v["x0"] - w["x1"] < 90
            ]
            nome = " ".join(v["text"] for v in sorted(mesma_linha, key=lambda v: v["x0"]))
            if nome and nome.upper() == nome and any(ch.isalpha() for ch in nome):
                refs.append({
                    "sku": w["text"].strip(),
                    "nome": nome.strip(),
                    "x": w["x0"],
                    "y": w["top"],
                })

    # Cada produto pega o bloco ABAIXO dele e mais proximo horizontalmente — o
    # layout e foto, ref/nome/preco, bolinhas embaixo, em colunas.
    centro_ref = lambda r: r["x"] + 20  # noqa: E731 - a ref fica a esquerda do card
    for r in refs:
        abaixo = [b for b in blocos if b["y"] >= r["y"]] or blocos
        r["cores"] = min(
            abaixo,
            key=lambda b: (b["y"] - r["y"] if b["y"] >= r["y"] else 9999)
            + abs(b["x_centro"] - centro_ref(r)) * 0.5,
        )["cores"]

    return refs, blocos


def main(caminhos):
    saida = {}
    for caminho in caminhos:
        with pdfplumber.open(caminho) as pdf:
            for i, pagina in enumerate(pdf.pages):
                try:
                    refs, blocos = extrair_pagina(pagina)
                except Exception as e:  # pagina sem bloco, capa, etc.
                    print(f"  ! pagina {i+1}: {e}", file=sys.stderr)
                    continue
                if not refs or not blocos:
                    continue
                for r in refs:
                    saida.setdefault(r["sku"], {
                        "sku": r["sku"],
                        "nome": r["nome"],
                        "cores": r["cores"],
                        "origem": f"{caminho.split(chr(92))[-1]} p.{i+1}",
                    })
        print(f"lido: {caminho.split(chr(92))[-1]}", file=sys.stderr)

    print(json.dumps(saida, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
