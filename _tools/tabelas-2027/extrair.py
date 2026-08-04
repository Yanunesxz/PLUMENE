"""
Extrai as tabelas de preço 2027 dos PDFs oficiais (TABELA PRECO 01/02/03 - 2027).

O PDF tem uma linha por faixa de tamanho: a faixa normal (PP AO GG, P AO GG,
2-4-6-8 anos...) e a faixa maior (EG, XG, 48-50-52-54), com preços diferentes.
O sistema guarda UM preço por produto por tabela — gravamos o da faixa normal,
que é o que aparece no catálogo. O preço maior fica registrado no JSON para
conferência.

Uso:  python extrair.py            (gera tabelas-2027.json ao lado)
"""

import json
import re
from pathlib import Path

import fitz  # PyMuPDF

AQUI = Path(__file__).parent
ORIGEM = Path.home() / "Downloads"
FAIXAS_MAIORES = {"EG", "XG", "48-50-52-54"}

# 4 linhas por item: código, descrição, faixa de tamanho, preço.
COD = re.compile(r"^\d{4}$")
PRECO = re.compile(r"^R\$ ?([\d.]+),(\d\d)$")


def ler(pdf: Path) -> list[dict]:
    texto = "".join(p.get_text() for p in fitz.open(pdf))
    linhas = [l.strip() for l in texto.split("\n")]

    itens: list[dict] = []
    i = 0
    while i < len(linhas) - 3:
        preco = PRECO.match(linhas[i + 3])
        if COD.match(linhas[i]) and preco:
            itens.append(
                {
                    "sku": linhas[i],
                    "nome": linhas[i + 1],
                    "tamanho": linhas[i + 2],
                    "preco": float(preco.group(1).replace(".", "") + "." + preco.group(2)),
                }
            )
            i += 4
        else:
            i += 1
    return itens


def consolidar(itens: list[dict]) -> dict:
    """Um registro por SKU: preço da faixa normal + preço da faixa maior."""
    por_sku: dict[str, dict] = {}
    for it in itens:
        reg = por_sku.setdefault(
            it["sku"], {"sku": it["sku"], "nome": it["nome"], "preco": None, "preco_maior": None}
        )
        if it["tamanho"] in FAIXAS_MAIORES:
            reg["preco_maior"] = it["preco"]
        else:
            reg["preco"] = it["preco"]
    # SKU que só aparece na faixa maior: esse preço vira o preço do produto.
    for reg in por_sku.values():
        if reg["preco"] is None:
            reg["preco"] = reg["preco_maior"]
    return por_sku


def main() -> None:
    saida = {}
    for n in ("01", "02", "03"):
        itens = ler(ORIGEM / f"TABELA PRECO {n} - 2027.pdf")
        por_sku = consolidar(itens)
        saida[n] = por_sku
        maiores = sum(1 for r in por_sku.values() if r["preco_maior"] is not None)
        print(f"tabela {n}: {len(itens)} linhas · {len(por_sku)} SKUs · {maiores} com faixa maior")

    # Os 3 PDFs precisam cobrir exatamente os mesmos SKUs.
    conjuntos = [set(s) for s in saida.values()]
    if conjuntos[0] != conjuntos[1] or conjuntos[1] != conjuntos[2]:
        raise SystemExit("PDFs divergem nos SKUs — conferir antes de carregar")

    (AQUI / "tabelas-2027.json").write_text(
        json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print("ok -> tabelas-2027.json")


if __name__ == "__main__":
    main()
