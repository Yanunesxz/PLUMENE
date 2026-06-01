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
from pathlib import Path

# ─── setup ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("erp-sync")

SCRIPT_DIR = Path(__file__).parent
FBEMBED_DIR = SCRIPT_DIR.parent / "firebird-reader" / "fbembed25_x64"

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
FB_PASSWORD    = os.environ.get("FIREBIRD_PASSWORD", "masterkey")
SUPABASE_URL   = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY   = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
COMPANY_ID     = os.environ.get("COMPANY_ID", "")
CHUNK_SIZE     = 500

if not SUPABASE_URL or not SUPABASE_KEY:
    log.error("SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios")
    sys.exit(1)

# ─── Firebird connection ───────────────────────────────────────────────────────
def get_fb_connection():
    return fdb.connect(
        dsn=DB_PATH,
        user="SYSDBA",
        password=FB_PASSWORD,
        fb_library_name=str(FBEMBED_DIR / "fbembed.dll"),
    )

# ─── Supabase client ──────────────────────────────────────────────────────────
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

def supabase_upsert(table: str, rows: list) -> dict:
    """Upsert em lotes de CHUNK_SIZE."""
    total = 0
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i:i+CHUNK_SIZE]
        url = f"{SUPABASE_URL}/rest/v1/{table}"
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
    result = supabase_upsert("price_tables", rows)
    log.info(f"  Tabelas de preço: {result['records']} registros")
    return result["records"]

# ─── Sync: Produtos + Variantes ───────────────────────────────────────────────
def sync_products(cur) -> tuple[int, int]:
    log.info("Sincronizando produtos e variantes...")
    cur.execute("""
        SELECT
            p.PRODUTO, p.TAMANHO, TRIM(p.DESCRICAO), p.ATIVO,
            TRIM(p.COLECAO), TRIM(p.CATALOGO), TRIM(p.MARCA),
            TRIM(p.GRUPO_PRODUTO),
            TRIM(pc.COR),
            TRIM(c.DESCRICAO),
            TRIM(c.COR_HEXADECIMAL),
            COALESCE(e.ESTOQUE_PRATELEIRA, 0),
            COALESCE(e.ESTOQUE_PEDIDO, 0),
            TRIM(e.CODIGO_BARRAS)
        FROM PRODUTO p
        JOIN PRODUTO_CORES pc ON pc.PRODUTO = p.PRODUTO AND pc.ATIVO = 'S'
        LEFT JOIN COR c ON TRIM(c.COR) = TRIM(pc.COR)
        LEFT JOIN ESTOQUE_PRODUTO e ON e.PRODUTO = p.PRODUTO
            AND e.TAMANHO = p.TAMANHO AND TRIM(e.COR) = TRIM(pc.COR)
        WHERE p.ATIVO = 'S'
        ORDER BY p.PRODUTO, p.TAMANHO, pc.COR
    """)

    products_seen = {}
    variants = []

    for row in cur.fetchall():
        produto, tamanho, descricao, ativo = row[0], row[1], row[2], row[3]
        colecao, catalogo, marca, grupo = row[4], row[5], row[6], row[7]
        cor, cor_desc, cor_hex = trim(row[8]), trim(row[9]), trim(row[10])
        estoque_prat, estoque_ped = row[11], row[12]
        cod_barras = trim(row[13])

        sku = trim(produto)
        if sku not in products_seen:
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

        erp_sku = f"{sku}|{trim(tamanho)}|{trim(cor)}"
        variants.append({
            "company_id": COMPANY_ID,
            "erp_sku": erp_sku,
            "size": trim(tamanho),
            "color": trim(cor) or "",
            "color_description": cor_desc,
            "color_hex": cor_hex,
            "stock_quantity": estoque_prat or 0,
            "stock_committed": estoque_ped or 0,
            "barcode": cod_barras,
            "active": ativo == 'S',
            "updated_at": now_iso(),
        })

    product_list = list(products_seen.values())
    r1 = supabase_upsert("products", product_list)
    log.info(f"  Produtos: {r1['records']} registros")

    # Busca IDs dos produtos inseridos para vincular variantes
    db_products = supabase_select("products", "id,erp_id", {"company_id": COMPANY_ID})
    pid_map = {p["erp_id"]: p["id"] for p in db_products if p.get("erp_id")}

    variant_rows = []
    for v in variants:
        sku = v["erp_sku"].split("|")[0]
        pid = pid_map.get(sku)
        if pid:
            variant_rows.append({**v, "product_id": pid})

    r2 = supabase_upsert("product_variants", variant_rows)
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

    result = supabase_upsert("product_prices", price_rows)
    log.info(f"  Preços: {result['records']} registros")
    return result["records"]

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

    result = supabase_upsert("customers", rows)
    log.info(f"  Clientes: {result['records']} registros")
    return result["records"]

# ─── Sync: Estoque ────────────────────────────────────────────────────────────
def sync_stock(cur) -> int:
    log.info("Sincronizando estoque...")
    cur.execute("""
        SELECT TRIM(e.PRODUTO), TRIM(e.TAMANHO), TRIM(e.COR),
               COALESCE(e.ESTOQUE_PRATELEIRA, 0),
               COALESCE(e.ESTOQUE_PEDIDO, 0),
               TRIM(e.CODIGO_BARRAS)
        FROM ESTOQUE_PRODUTO e
        JOIN PRODUTO p ON p.PRODUTO = e.PRODUTO AND p.TAMANHO = e.TAMANHO AND p.ATIVO = 'S'
    """)

    db_variants = supabase_select("product_variants", "id,erp_sku", {"company_id": COMPANY_ID})
    variant_map = {v["erp_sku"]: v["id"] for v in db_variants if v.get("erp_sku")}

    updates = []
    for r in cur.fetchall():
        erp_sku = f"{r[0]}|{r[1]}|{r[2]}"
        vid = variant_map.get(erp_sku)
        if vid:
            updates.append({
                "id": vid,
                "stock_quantity": r[3],
                "stock_committed": r[4],
                "barcode": r[5],
                "updated_at": now_iso(),
            })

    result = supabase_upsert("product_variants", updates)
    log.info(f"  Estoque: {result['records']} variantes atualizadas")
    return result["records"]

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="ERP Sync — Firebird → Supabase")
    parser.add_argument("--mode", choices=["full", "stock", "customers", "prices"],
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
    finally:
        cur.close()
        con.close()

    elapsed = time.time() - t0
    log.info(f"Sync concluído em {elapsed:.1f}s")

if __name__ == "__main__":
    main()
