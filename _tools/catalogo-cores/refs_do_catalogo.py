# -*- coding: utf-8 -*-
"""
Lista as referencias (SKU de 4 digitos) presentes nos catalogos.

Serve para responder "quais produtos existem neste catalogo", que e uma pergunta
diferente de "quais cores cada um tem": a segunda depende de casar a referencia
com o bloco de bolinhas, e nem toda pagina casa. Esta aqui e so texto, entao
pega tudo.

Uso: python refs_do_catalogo.py cat1.pdf cat2.pdf > refs.json
"""
import json
import re
import sys

import pdfplumber

REF = re.compile(r"^\d{4}$")


def main(caminhos):
    refs = {}
    for caminho in caminhos:
        nome = caminho.split("\\")[-1].split("/")[-1]
        with pdfplumber.open(caminho) as pdf:
            for i, pagina in enumerate(pdf.pages):
                for w in pagina.extract_words():
                    t = w["text"].strip()
                    if REF.match(t):
                        refs.setdefault(t, f"{nome} p.{i+1}")
        print(f"lido: {nome}", file=sys.stderr)
    print(json.dumps(refs, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
