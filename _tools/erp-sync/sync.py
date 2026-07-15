#!/usr/bin/env python3
"""
ERP Sync — Firebird 2.5 → Supabase
Corpo Sensual B2B

Uso:
  python sync.py --mode full            # tudo
  python sync.py --mode stock           # só estoque
  python sync.py --mode customers       # só clientes
  python sync.py --mode prices          # só preços

Variáveis de ambiente (.env):
  FIREBIRD_DB_PATH    = C:\\caminho\\para\\DBCORPO-002.FDB
  SUPABASE_URL        = https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY = eyJ...
  COMPANY_ID          = uuid-da-empresa
  FIREBIRD_PASSWORD   = masterkey

Dependências:
  pip install fdb python-dotenv httpx
"""
import os, sys, json, time, logging, argparse
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

# ─── setup ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("erp-sync")

SCRIPT_DIR = Path(__file__).parent
# Procura as DLLs do Firebird: primeiro ao lado do script (pacote instalado
# na fábrica), depois no repositório (_tools/firebird-reader).
_fbembed_candidates = [
    SCRIPT_DIR / "fbembed25_x64",
    SCRIPT_DIR.parent / "firebird-reader" / "fbembed25_x64",
]
FBEMBED_DIR = next((p for p in _fbembed_candidates if p.exists()), _fbembed_candidates[-1])

# Adiciona DLLs ao PATH antes de importar fdb
os.environ["PATH"] = str(FBEMBED_DIR) + ";" + os.environ.get("PATH", "")

try:
    from dotenv import load_dotenv
    load_dotenv(SCRIPT_DIR / ".env")
    load_dotenv(SCRIPT_DIR / "../../apps/api/.env")
except ImportError:
    log.warning("python-dotenv não instalado — usando variáveis de ambiente do sistema")

try:
    import fdb
except ImportError:
    log.error("fdb não instalado. Execute: pip install fdb")
    sys.exit(1)

try:
    import httpx
except ImportError:
    log.error("httpx não instalado. Execute: pip install httpx")
    sys.exit(1)

# ─── config ───────────────────────────────────────────────────────────────────
DB_PATH        = os.environ.get("FIREBIRD_DB_PATH", r"C:\Users\Yan\Downloads\DBCORPO-002.FDB")
# Se FIREBIRD_HOST estiver definido (ex.: localhost), conecta via servidor
# Firebird (TCP 3050) em vez de abrir o arquivo direto com fbembed.
# Obrigatório quando o ERP está rodando e mantém o .FDB aberto.
FB_HOST        = os.environ.get("FIREBIRD_HOST", "").strip()
FB_PORT        = int(os.environ.get("FIREBIRD_PORT", "3050"))
FB_USER        = os.environ.get("FIREBIRD_USER", "SYSDBA")
FB_PASSWORD    = os.environ.get("FIREBIRD_PASSWORD", "masterkey")

# ── Envio de pedidos (Supabase → ERP) ─────────────────────────────────────────
# Numeração igual à do ERP: prefixo da série (SX = pedidos de representante)
# + GEN_PEDIDO_UNIVERSAL, a sequência ÚNICA compartilhada por todas as séries
# (CS/SX/ML... interleiam o mesmo contador; conferido no banco real).
ERP_ORDER_PREFIX    = os.environ.get("ERP_ORDER_PREFIX", "SX")
ERP_ORDER_GENERATOR = os.environ.get("ERP_ORDER_GENERATOR", "GEN_PEDIDO_UNIVERSAL")
# Situação com que o pedido entra no ERP (LIBERADO = segue fluxo normal)
ERP_ORDER_SITUACAO  = os.environ.get("ERP_ORDER_SITUACAO", "LIBERADO")
# Status no Supabase que libera o envio ao ERP
ERP_PUSH_STATUS     = os.environ.get("ERP_PUSH_STATUS", "approved")
SUPABASE_URL   = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY   = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
COMPANY_ID     = os.environ.get("COMPANY_ID", "")
CHUNK_SIZE     = 500

if not SUPABASE_URL or not SUPABASE_KEY:
    log.error("SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios")
    sys.exit(1)

# ─── Firebird connection ───────────────────────────────────────────────────────
def get_fb_connection():
    kwargs = dict(
        user=FB_USER,
        password=FB_PASSWORD,
        fb_library_name=str(FBEMBED_DIR / "fbembed.dll"),
    )
    if FB_HOST:
        # Via servidor Firebird (TCP) — modo correto na fábrica, onde o ERP
        # mantém o arquivo aberto. fbembed.dll também funciona como client.
        return fdb.connect(host=FB_HOST, port=FB_PORT, database=DB_PATH, **kwargs)
    # Acesso embedded direto ao arquivo — só para cópias offline do banco.
    return fdb.connect(dsn=DB_PATH, **kwargs)

# ─── Supabase client ──────────────────────────────────────────────────────────
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

def supabase_upsert(table: str, rows: list, on_conflict: str | None = None) -> dict:
    """Upsert em lotes de CHUNK_SIZE.

    `on_conflict` = colunas da chave única (ex.: 'company_id,sku'). Sem isso o
    PostgREST usa a PK; em re-execução isso causa 409 (duplicate key) quando a
    linha não tem id. Passe a chave natural da tabela para o merge funcionar.
    """
    total = 0
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i:i+CHUNK_SIZE]
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        if on_conflict:
            url += f"?on_conflict={on_conflict}"
        r = httpx.post(url, headers={**HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"}, json=chunk, timeout=30)
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"Supabase upsert {table} falhou [{r.status_code}]: {r.text[:300]}")
        total += len(chunk)
    return {"records": total}

def supabase_select(table: str, columns: str = "*", filters: dict | None = None) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={columns}"
    if filters:
        for k, v in filters.items():
            url += f"&{k}=eq.{v}"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()

def supabase_patch_by_ids(table: str, ids: list, body: dict) -> int:
    """PATCH em lote dos registros cujo id está na lista (em chunks)."""
    total = 0
    for i in range(0, len(ids), CHUNK_SIZE):
        chunk = ids[i:i+CHUNK_SIZE]
        url = f"{SUPABASE_URL}/rest/v1/{table}?id=in.({','.join(chunk)})"
        r = httpx.patch(url, headers={**HEADERS, "Prefer": "return=minimal"}, json=body, timeout=30)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"Supabase patch {table} falhou [{r.status_code}]: {r.text[:300]}")
        total += len(chunk)
    return total

# ─── Helpers ──────────────────────────────────────────────────────────────────
def trim(v):
    return v.strip() if isinstance(v, str) else v

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def get_price(row: dict, col: int):
    return row.get(f"PRECO{col}")

# ─── Sync: Tabelas de Preço ────────────────────────────────────────────────────
def sync_price_tables(cur) -> int:
    log.info("Sincronizando tabelas de preço...")
    cur.execute("""
        SELECT TRIM(TABELA_PRECO), TRIM(DESCRICAO),
               TRIM(DESCRICAO_COLUNA1), TRIM(DESCRICAO_COLUNA2),
               TRIM(DESCRICAO_COLUNA3), TRIM(DESCRICAO_COLUNA4),
               TRIM(DESCRICAO_COLUNA5), TRIM(DESCRICAO_COLUNA6), ATIVO
        FROM TABELA_PRECO WHERE ATIVO = 'S'
    """)
    rows = []
    for r in cur.fetchall():
        rows.append({
            "company_id": COMPANY_ID,
            "erp_code": r[0],
            "name": r[1] or r[0],
            "price_column": 1,
            "col_descriptions": json.dumps({1: r[2], 2: r[3], 3: r[4], 4: r[5], 5: r[6], 6: r[7]}),
            "updated_at": now_iso(),
        })
    result = supabase_upsert("price_tables", rows, on_conflict="company_id,erp_code")
    log.info(f"  Tabelas de preço: {result['records']} registros")
    return result["records"]

# ─── Sync: Produtos + Variantes ───────────────────────────────────────────────
def sync_products(cur) -> tuple[int, int]:
    log.info("Sincronizando produtos e variantes...")
    # Cores sortidas: agrega por (PRODUTO, TAMANHO), somando o estoque de todas as cores.
    cur.execute("""
        SELECT
            p.PRODUTO, p.TAMANHO, MAX(TRIM(p.DESCRICAO)), MAX(p.ATIVO),
            MAX(TRIM(p.COLECAO)), MAX(TRIM(p.MARCA)),
            MAX(TRIM(p.GRUPO_PRODUTO)),
            COALESCE(SUM(e.ESTOQUE_PRATELEIRA), 0),
            COALESCE(SUM(e.ESTOQUE_PEDIDO), 0)
        FROM PRODUTO p
        LEFT JOIN ESTOQUE_PRODUTO e ON e.PRODUTO = p.PRODUTO
            AND e.TAMANHO = p.TAMANHO
        WHERE p.ATIVO = 'S'
        GROUP BY p.PRODUTO, p.TAMANHO
        ORDER BY p.PRODUTO, p.TAMANHO
    """)

    products_seen = {}
    variants = []

    for row in cur.fetchall():
        produto, tamanho, descricao, ativo = row[0], row[1], row[2], row[3]
        colecao, marca, grupo = row[4], row[5], row[6]
        estoque_prat, estoque_ped = row[7], row[8]

        sku = trim(produto)
        if sku not in products_seen:
            # image_url é omitido de propósito: vem dos catálogos PDF. O upsert
            # merge-duplicates preserva o valor existente quando a coluna não vai no payload.
            products_seen[sku] = {
                "company_id": COMPANY_ID,
                "erp_id": sku,
                "sku": sku,
                "name": trim(descricao) or sku,
                "description": None,
                "collection": trim(colecao),
                "brand": trim(marca),
                "group_name": trim(grupo),
                "active": ativo == 'S',
                "updated_at": now_iso(),
            }

        # Uma variante por (produto, tamanho) — estoque já somado entre as cores.
        erp_sku = f"{sku}|{trim(tamanho)}"
        variants.append({
            "company_id": COMPANY_ID,
            "erp_sku": erp_sku,
            "size": trim(tamanho),
            "stock_quantity": estoque_prat or 0,
            "stock_committed": estoque_ped or 0,
            "active": ativo == 'S',
            "updated_at": now_iso(),
        })

    product_list = list(products_seen.values())
    r1 = supabase_upsert("products", product_list, on_conflict="company_id,sku")
    log.info(f"  Produtos: {r1['records']} registros")

    # Busca IDs dos produtos inseridos para vincular variantes
    db_products = supabase_select("products", "id,erp_id", {"company_id": COMPANY_ID})
    pid_map = {p["erp_id"]: p["id"] for p in db_products if p.get("erp_id")}

    # Desativa no app os produtos que não estão mais ATIVO='S' no ERP. O upsert
    # acima só trouxe os ativos; sem isso, refs desligadas no ERP continuariam
    # aparecendo no catálogo e na busca de "adicionar produto".
    active_skus = set(products_seen.keys())
    stale_ids = [p["id"] for p in db_products if p.get("erp_id") and p["erp_id"] not in active_skus]
    if stale_ids:
        n = supabase_patch_by_ids("products", stale_ids, {"active": False, "updated_at": now_iso()})
        log.info(f"  Desativados (ref desligada no ERP): {n}")

    variant_rows = []
    for v in variants:
        sku = v["erp_sku"].split("|")[0]
        pid = pid_map.get(sku)
        if pid:
            variant_rows.append({**v, "product_id": pid})

    r2 = supabase_upsert("product_variants", variant_rows, on_conflict="company_id,erp_sku")
    log.info(f"  Variantes: {r2['records']} registros")

    return r1["records"], r2["records"]

# ─── Sync: Preços ─────────────────────────────────────────────────────────────
def sync_prices(cur) -> int:
    log.info("Sincronizando preços...")
    cur.execute("""
        SELECT TRIM(itp.TABELA_PRECO), TRIM(itp.PRODUTO), TRIM(itp.TAMANHO),
               itp.PRECO1, itp.PRECO2, itp.PRECO3,
               itp.PRECO4, itp.PRECO5, itp.PRECO6,
               itp.PERC_DESCONTO, itp.PRECO_ORIGINAL
        FROM ITENS_TABELA_PRECO itp
        JOIN TABELA_PRECO tp ON TRIM(tp.TABELA_PRECO) = TRIM(itp.TABELA_PRECO)
        WHERE tp.ATIVO = 'S'
        ORDER BY itp.TABELA_PRECO, itp.PRODUTO
    """)

    db_tables  = supabase_select("price_tables", "id,erp_code,price_column", {"company_id": COMPANY_ID})
    db_products = supabase_select("products", "id,erp_id", {"company_id": COMPANY_ID})

    table_map   = {t["erp_code"]: t for t in db_tables if t.get("erp_code")}
    product_map = {p["erp_id"]: p["id"] for p in db_products if p.get("erp_id")}

    price_rows = []
    for row in cur.fetchall():
        tabela, produto, tamanho = row[0], row[1], row[2]
        precos = {1: row[3], 2: row[4], 3: row[5], 4: row[6], 5: row[7], 6: row[8]}

        t = table_map.get(tabela)
        pid = product_map.get(produto)
        if not t or not pid:
            continue

        col = t.get("price_column") or 1
        price = precos.get(col) or precos.get(1)
        if not price or price <= 0:
            continue

        price_rows.append({
            "company_id": COMPANY_ID,
            "product_id": pid,
            "price_table_id": t["id"],
            "price": float(price),
            "updated_at": now_iso(),
        })

    result = supabase_upsert("product_prices", price_rows, on_conflict="product_id,price_table_id")
    log.info(f"  Preços: {result['records']} registros")
    return result["records"]

# ─── Reconciliação de produtos ativos ──────────────────────────────────────────
def reconcile_active(cur) -> None:
    """Sincroniza só o flag `active` dos produtos com o ERP, sem re-upsertar.

    Desativa no app os produtos que não estão mais ATIVO='S' no ERP (refs
    desligadas que continuavam aparecendo no catálogo / na busca) e reativa
    os que voltaram. Leitura no Firebird + PATCH pontual no Supabase.
    """
    log.info("Reconciliando produtos ativos com o ERP...")
    cur.execute("SELECT DISTINCT TRIM(PRODUTO) FROM PRODUTO WHERE ATIVO = 'S'")
    active = {r[0] for r in cur.fetchall()}
    log.info(f"  Ativos no ERP: {len(active)}")

    app = supabase_select("products", "id,erp_id,active", {"company_id": COMPANY_ID})
    to_off = [p["id"] for p in app if p.get("erp_id") and p["erp_id"] not in active and p.get("active")]
    to_on = [p["id"] for p in app if p.get("erp_id") and p["erp_id"] in active and not p.get("active")]

    if to_off:
        supabase_patch_by_ids("products", to_off, {"active": False, "updated_at": now_iso()})
    if to_on:
        supabase_patch_by_ids("products", to_on, {"active": True, "updated_at": now_iso()})
    log.info(f"  Desativados (ref desligada): {len(to_off)} | Reativados: {len(to_on)}")


# ─── Auditoria: Preços (somente leitura) ───────────────────────────────────────
def audit_prices(cur) -> None:
    """Classifica por que produtos ativos ficam sem preço. Não escreve nada.

    Hoje o sync_prices só usa PRECO1 (price_column é gravado fixo = 1). Esta
    auditoria mostra quantos SKUs têm preço APENAS em PRECO2..6 (que o sync
    ignora) vs quantos não têm preço nenhum no ERP.
    """
    log.info("AUDITORIA de preços (somente leitura)...")

    cur.execute("SELECT DISTINCT TRIM(PRODUTO) FROM PRODUTO WHERE ATIVO = 'S'")
    active = {r[0] for r in cur.fetchall()}
    log.info(f"  Produtos ativos (códigos distintos): {len(active)}")

    cur.execute("""
        SELECT TRIM(itp.PRODUTO),
               itp.PRECO1, itp.PRECO2, itp.PRECO3, itp.PRECO4, itp.PRECO5, itp.PRECO6
        FROM ITENS_TABELA_PRECO itp
        JOIN TABELA_PRECO tp ON TRIM(tp.TABELA_PRECO) = TRIM(itp.TABELA_PRECO)
        WHERE tp.ATIVO = 'S'
    """)
    has_item, has_preco1, has_other = set(), set(), set()
    for r in cur.fetchall():
        code, precos = r[0], [r[1], r[2], r[3], r[4], r[5], r[6]]
        has_item.add(code)
        if precos[0] and precos[0] > 0:
            has_preco1.add(code)
        elif any(p and p > 0 for p in precos[1:]):
            has_other.add(code)

    no_item = active - has_item
    only_other = (active & has_other) - has_preco1
    priced_ok = active & has_preco1

    log.info(f"  COM preço em PRECO1 (o sync usa hoje):     {len(priced_ok)}")
    log.info(f"  COM preço só em PRECO2..6 (sync IGNORA):   {len(only_other)}")
    log.info(f"  SEM nenhum item de preço no ERP:           {len(no_item)}")
    if only_other:
        log.info(f"    -> recuperáveis lendo a coluna certa. Ex.: {sorted(only_other)[:15]}")
    if no_item:
        log.info(f"    -> precisam de preço no ERP. Ex.: {sorted(no_item)[:15]}")


# ─── Sync: Clientes ───────────────────────────────────────────────────────────
def sync_customers(cur) -> int:
    log.info("Sincronizando clientes...")
    cur.execute("""
        SELECT
            TRIM(c.CLIENTE), TRIM(c.RAZAO_SOCIAL), TRIM(c.NOME_FANTASIA),
            TRIM(c.CNPJ_CPF), TRIM(c.REPRESENTANTE), TRIM(c.TABELA_PRECO),
            c.BLOQUEADO, c.LIMITE_CREDITO,
            TRIM(c.WHATSAPP1), TRIM(c.EMAIL), c.ATIVO, c.DATA_UPDATE
        FROM CLIENTE c WHERE c.ATIVO = 'S'
        ORDER BY c.RAZAO_SOCIAL
    """)

    db_tables = supabase_select("price_tables", "id,erp_code", {"company_id": COMPANY_ID})
    table_map = {t["erp_code"]: t["id"] for t in db_tables if t.get("erp_code")}

    rows = []
    for r in cur.fetchall():
        cliente, razao, fantasia, cnpj = r[0], r[1], r[2], r[3]
        rep, tabela, bloqueado, limite = r[4], r[5], r[6], r[7]
        whatsapp, email, ativo, dt_upd = r[8], r[9], r[10], r[11]

        updated = dt_upd.isoformat() if dt_upd else now_iso()
        rows.append({
            "company_id": COMPANY_ID,
            "erp_id": trim(cliente),
            "name": trim(razao) or trim(cliente) or "",
            "trade_name": trim(fantasia),
            "cnpj": trim(cnpj),
            "rep_erp_id": trim(rep),
            "price_table_id": table_map.get(trim(tabela)),
            "blocked": trim(bloqueado) == 'S',
            "block_reason": None,
            "credit_limit": float(limite) if limite else None,
            "whatsapp": trim(whatsapp),
            "email": trim(email),
            "updated_at": updated,
        })

    result = supabase_upsert("customers", rows, on_conflict="company_id,erp_id")
    log.info(f"  Clientes: {result['records']} registros")
    return result["records"]

# ─── Push: Pedidos (Supabase → ERP) ───────────────────────────────────────────
# Direção inversa das demais: lê pedidos aprovados no Supabase e INSERE no
# Firebird (PEDIDO + ITENS_PEDIDO). Única operação de escrita no ERP.
#
# Idempotência: grava os 10 primeiros hex do UUID do pedido em
# PEDIDO.IDPEDIDO_EXTERNO (VARCHAR(10)) e confere antes de inserir — se a
# confirmação ao Supabase falhar, a próxima rodada reaproveita o nº já gerado
# em vez de duplicar.

def _external_id(order_uuid: str) -> str:
    return order_uuid.replace("-", "")[:10]

def _ensure_generator(con) -> None:
    """Garante que o generator da série de pedidos do app existe."""
    if not all(c.isalnum() or c == "_" for c in ERP_ORDER_GENERATOR):
        raise ValueError(f"Nome de generator inválido: {ERP_ORDER_GENERATOR}")
    cur = con.cursor()
    cur.execute(
        "SELECT 1 FROM RDB$GENERATORS WHERE TRIM(RDB$GENERATOR_NAME) = ?",
        (ERP_ORDER_GENERATOR,),
    )
    if cur.fetchone():
        return
    log.warning(f"Generator {ERP_ORDER_GENERATOR} não existe — criando (série nova de pedidos do app)")
    con.execute_immediate(f"CREATE GENERATOR {ERP_ORDER_GENERATOR}")
    con.commit()

def fetch_pending_orders() -> list:
    """Pedidos aprovados e ainda sem número do ERP, com cliente e itens embutidos."""
    url = (
        f"{SUPABASE_URL}/rest/v1/orders?select="
        "id,total,notes,created_at,"
        "customers(erp_id,rep_erp_id,price_table_id),"
        "order_items(quantity,unit_price,total,"
        "product_variants(erp_sku,size),products(erp_id,sku))"
        f"&company_id=eq.{COMPANY_ID}&status=eq.{ERP_PUSH_STATUS}&erp_order_id=is.null"
        "&order=created_at.asc"
    )
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()

class OrderMappingError(Exception):
    """Erro permanente de mapeamento — não adianta re-tentar sem correção."""

def _map_order_items(order: dict) -> list[tuple]:
    """(PRODUTO, TAMANHO, QUANTIDADE, PRECO_UNITARIO, TOTAL) por item."""
    items = order.get("order_items") or []
    if not items:
        raise OrderMappingError("pedido sem itens")
    mapped = []
    for it in items:
        variant = it.get("product_variants")
        if variant and variant.get("erp_sku") and "|" in variant["erp_sku"]:
            produto, tamanho = variant["erp_sku"].split("|", 1)
        else:
            product = it.get("products") or {}
            produto = product.get("erp_id")
            tamanho = (variant or {}).get("size")
            if not produto or not tamanho:
                raise OrderMappingError(f"item sem vínculo com o ERP (variante/produto ausente): {it}")
        qty = int(it.get("quantity") or 0)
        if qty <= 0:
            raise OrderMappingError(f"item com quantidade inválida: {produto} {tamanho}")
        # Decimal (não float) para o Firebird não truncar centavos (128.70 → 128.69)
        unit = Decimal(str(it.get("unit_price") or 0)).quantize(Decimal("0.01"))
        total = Decimal(str(it.get("total") or 0)).quantize(Decimal("0.01")) or unit * qty
        mapped.append((produto.strip(), tamanho.strip(), qty, unit, total))
    return mapped

def _insert_order_into_erp(con, order: dict, table_map: dict) -> str:
    """Insere PEDIDO + ITENS_PEDIDO numa transação. Retorna o nº gerado."""
    cur = con.cursor()
    ext_id = _external_id(order["id"])

    # Já entrou numa rodada anterior? (confirmação ao Supabase pode ter falhado)
    cur.execute("SELECT PEDIDO FROM PEDIDO WHERE IDPEDIDO_EXTERNO = ?", (ext_id,))
    existing = cur.fetchone()
    if existing:
        log.info(f"  Pedido {order['id'][:8]} já estava no ERP como {existing[0]} — só confirmando")
        return existing[0].strip()

    customer = order.get("customers") or {}
    cliente = (customer.get("erp_id") or "").strip()
    representante = (customer.get("rep_erp_id") or "").strip()
    if not cliente:
        raise OrderMappingError("cliente sem código do ERP (erp_id)")
    if not representante:
        raise OrderMappingError(f"cliente {cliente} sem representante no ERP (rep_erp_id)")

    pt = table_map.get(customer.get("price_table_id"))
    if not pt or not pt.get("erp_code"):
        raise OrderMappingError(f"cliente {cliente} sem tabela de preço mapeada no ERP")
    tabela_preco = pt["erp_code"].strip()
    coluna = int(pt.get("price_column") or 1)

    items = _map_order_items(order)
    valor_produtos = sum(t for *_, t in items)
    total = Decimal(str(order.get("total"))) if order.get("total") else valor_produtos
    pecas = sum(q for _, _, q, _, _ in items)

    cur.execute(f"SELECT GEN_ID({ERP_ORDER_GENERATOR}, 1) FROM RDB$DATABASE")
    seq = cur.fetchone()[0]
    pedido_num = f"{ERP_ORDER_PREFIX}{seq}"
    if len(pedido_num) > 10:
        raise OrderMappingError(f"número de pedido excede 10 caracteres: {pedido_num}")

    hoje = datetime.now().date()
    obs = (order.get("notes") or "Pedido via app de representantes")[:100]

    cur.execute(
        """
        INSERT INTO PEDIDO (
            PEDIDO, CLIENTE, REPRESENTANTE, DATA_INCLUSAO, DATA_EMISSAO,
            VALOR_PEDIDO, VALOR_PRODUTOS, VALOR_DESCONTO, VALOR_FRETE,
            STATUS, SITUACAO, ATIVO, BAIXOU_ESTOQUE,
            TABELA_PRECO, COLUNA_TABELA_PRECO, PECAS,
            IDPEDIDO_EXTERNO, OBSERVACAO_ANOTACOES
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'A', ?, 'S', 'N', ?, ?, ?, ?, ?)
        """,
        (pedido_num, cliente, representante, hoje, hoje,
         total, valor_produtos, ERP_ORDER_SITUACAO,
         tabela_preco, coluna, pecas, ext_id, obs),
    )

    for i, (produto, tamanho, qty, unit, item_total) in enumerate(items, start=1):
        cur.execute(
            """
            INSERT INTO ITENS_PEDIDO (
                PEDIDO, INCREMENTO, PRODUTO, TAMANHO, COR,
                QUANTIDADE, QTDE_PEDIDO, PRECO_UNITARIO, PRETO_TOTAL, BAIXOU_ESTOQUE
            ) VALUES (?, ?, ?, ?, '00001', ?, ?, ?, ?, 'N')
            """,
            (pedido_num, i, produto, tamanho, qty, qty, unit, item_total),
        )

    con.commit()
    return pedido_num

def push_orders(con) -> int:
    """Envia pedidos aprovados do Supabase para o ERP. Retorna qtde enviada."""
    orders = fetch_pending_orders()
    if not orders:
        log.info("Nenhum pedido aprovado aguardando envio ao ERP")
        return 0

    log.info(f"{len(orders)} pedido(s) para enviar ao ERP")
    _ensure_generator(con)

    db_tables = supabase_select("price_tables", "id,erp_code,price_column", {"company_id": COMPANY_ID})
    table_map = {t["id"]: t for t in db_tables}

    sent = 0
    for order in orders:
        oid = order["id"]
        try:
            pedido_num = _insert_order_into_erp(con, order, table_map)
            supabase_patch_by_ids("orders", [oid], {
                "status": "sent_erp",
                "erp_order_id": pedido_num,
                "synced_at": now_iso(),
            })
            log.info(f"  Pedido {oid[:8]} → ERP {pedido_num} OK")
            sent += 1
        except OrderMappingError as e:
            con.rollback()
            log.error(f"  Pedido {oid[:8]} com erro de cadastro (não será re-tentado): {e}")
            supabase_patch_by_ids("orders", [oid], {"status": "error_erp", "synced_at": now_iso()})
        except Exception as e:
            con.rollback()
            log.error(f"  Pedido {oid[:8]} falhou (vai re-tentar na próxima rodada): {e}")
    return sent

# ─── Sync: Estoque ────────────────────────────────────────────────────────────
def sync_stock(cur) -> int:
    log.info("Sincronizando estoque...")
    cur.execute("""
        SELECT TRIM(e.PRODUTO), TRIM(e.TAMANHO),
               COALESCE(SUM(e.ESTOQUE_PRATELEIRA), 0),
               COALESCE(SUM(e.ESTOQUE_PEDIDO), 0)
        FROM ESTOQUE_PRODUTO e
        JOIN PRODUTO p ON p.PRODUTO = e.PRODUTO AND p.TAMANHO = e.TAMANHO AND p.ATIVO = 'S'
        GROUP BY e.PRODUTO, e.TAMANHO
    """)

    db_variants = supabase_select("product_variants", "id,erp_sku", {"company_id": COMPANY_ID})
    variant_map = {v["erp_sku"]: v["id"] for v in db_variants if v.get("erp_sku")}

    updates = []
    for r in cur.fetchall():
        erp_sku = f"{r[0]}|{r[1]}"
        vid = variant_map.get(erp_sku)
        if vid:
            updates.append({
                "id": vid,
                "stock_quantity": r[2],
                "stock_committed": r[3],
                "updated_at": now_iso(),
            })

    result = supabase_upsert("product_variants", updates)
    log.info(f"  Estoque: {result['records']} variantes atualizadas")
    return result["records"]

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="ERP Sync — Firebird → Supabase")
    parser.add_argument("--mode", choices=["full", "stock", "customers", "prices", "products", "reconcile", "prices-audit", "test", "push-orders"],
                        default="full", help="Modo de sincronização")
    args = parser.parse_args()

    if not COMPANY_ID:
        log.error("COMPANY_ID não definido")
        sys.exit(1)

    log.info(f"Iniciando sync modo={args.mode} | Empresa: {COMPANY_ID}")
    log.info(f"Banco: {DB_PATH}")

    t0 = time.time()
    con = get_fb_connection()
    cur = con.cursor()
    log.info("Conectado ao Firebird!")

    try:
        if args.mode == "full":
            sync_price_tables(cur)
            sync_products(cur)
            sync_prices(cur)
            sync_customers(cur)
        elif args.mode == "stock":
            sync_stock(cur)
        elif args.mode == "customers":
            sync_customers(cur)
        elif args.mode == "prices":
            sync_prices(cur)
        elif args.mode == "products":
            sync_products(cur)
        elif args.mode == "reconcile":
            reconcile_active(cur)
        elif args.mode == "prices-audit":
            audit_prices(cur)
        elif args.mode == "push-orders":
            push_orders(con)
        elif args.mode == "test":
            cur.execute("SELECT COUNT(*) FROM PRODUTO WHERE ATIVO = 'S'")
            n = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM CLIENTE WHERE ATIVO = 'S'")
            c = cur.fetchone()[0]
            log.info(f"CONEXAO OK — {n} produtos ativos, {c} clientes ativos no ERP")
    finally:
        cur.close()
        con.close()

    elapsed = time.time() - t0
    log.info(f"Sync concluído em {elapsed:.1f}s")

if __name__ == "__main__":
    main()
