# Le as TABELAS DE PRECO em PDF (Corpo Sensual) e gera o tabelas.json que o
# conferir-precos-tabela.mjs consome.
#
# Layout do PDF (texto extraido com pymupdf), um item por bloco:
#     0161 / Pijama Longo Moletinho Aberto Fem. / PP AO GG / R$ 92,90
# Item em OFERTA tem UMA linha a mais entre a faixa e o preco:
#     0118 / Short Doll Regata Infantil Fem. / 1-2-4-6-8 anos / OFERTA / R$ 14,90
# Um leitor de 4 linhas pula esses sem avisar — foi assim que 6 refs sumiram em
# 02/09/2026. Por isso o script PROVA no fim: toda linha "^\d{4}$" do PDF virou
# um item. Se a prova falhar, ele sai com erro e nao grava.
#
# A fonte do PDF troca 's' por '4' no texto (Preços -> Preço4); numeros saem
# inteiros.
#
# Uso: python ler-tabela-pdf.py saida.json "TABELA 1.pdf" "TABELA 2.pdf" "TABELA 3.pdf"
import json, re, sys
import pymupdf

REF = re.compile(r'^\d{4}$')
PRECO = re.compile(r'^R\$\s*([\d.,]+)$')

def ler(caminho):
    doc = pymupdf.open(caminho)
    linhas = [l.strip() for p in doc for l in p.get_text().split('\n') if l.strip()]
    itens, i = [], 0
    while i < len(linhas) - 3:
        if REF.match(linhas[i]):
            ref, desc, faixa = linhas[i], linhas[i + 1], linhas[i + 2]
            oferta = linhas[i + 3].strip().upper() == 'OFERTA'
            preco = linhas[i + 4] if oferta and i + 4 < len(linhas) else linhas[i + 3]
            m = PRECO.match(preco)
            if m:
                itens.append({'ref': ref, 'desc': desc, 'faixa': faixa, 'oferta': oferta,
                              'preco': float(m.group(1).replace('.', '').replace(',', '.'))})
                i += 5 if oferta else 4
                continue
        i += 1
    brutas = sum(1 for l in linhas if REF.match(l))
    return itens, brutas, linhas[:4]

if len(sys.argv) < 3:
    print('Uso: python ler-tabela-pdf.py saida.json tabela1.pdf [tabela2.pdf tabela3.pdf]')
    sys.exit(1)

saida_json, arquivos = sys.argv[1], sys.argv[2:]
saida, falhou = {}, False
for n, caminho in enumerate(arquivos, start=1):
    itens, brutas, cab = ler(caminho)
    saida[str(n)] = itens
    ok = brutas == len(itens)
    falhou |= not ok
    ofertas = sum(1 for i in itens if i['oferta'])
    print(f'tabela {n}: {len(itens)} itens, {len({i["ref"] for i in itens})} refs, {ofertas} em OFERTA | '
          f'prova {len(itens)}/{brutas} {"OK" if ok else "PERDEU LINHAS"} | {" / ".join(cab[:3])}')

if falhou:
    print('\nERRO: linhas de referencia nao capturadas — NADA gravado. Veja o layout do PDF.')
    sys.exit(2)
with open(saida_json, 'w', encoding='utf-8') as f:
    json.dump(saida, f, ensure_ascii=False, indent=1)
print(f'\ngravado {saida_json}')
