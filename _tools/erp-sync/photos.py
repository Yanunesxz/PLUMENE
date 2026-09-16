#!/usr/bin/env python3
"""
Ingestão de fotos de produto — pasta MARKETING → Supabase Storage
Corpo Sensual B2B

As fotos vêm prontas, uma por produto, nomeadas pelo código:
  \\192.168.0.2\\Comercial\\MARKETING\\FOTOS CATALOGO INVERNO 2026_CORPO SENSUAL\\0140.jpg

Este script é ONE-TIME (roda numa máquina com acesso à rede):
  1. redimensiona a foto para web (~1000px, JPEG)
  2. sobe para o bucket público do Supabase Storage
  3. grava products.image_url apontando para a CDN do Supabase

>>> Depois disso o app NÃO depende mais do 192.168.0.2: as imagens são servidas
    pela CDN do Supabase. O compartilhamento de rede só é lido durante a ingestão.

Uso:
  python photos.py                      # sobe tudo da pasta padrão (CS Inverno)
  python photos.py --dir "<pasta>"      # outra pasta (ex.: Plumene)
  python photos.py --dry-run            # só mapeia código→produto, não sobe nada (livre)
  python photos.py --limit 5            # testa com poucas fotos

TRAVAS (fase 0 da integração com o Control) — este script GRAVA no catálogo
(cria o bucket e escreve products.image_url), então vale a mesma regra do
sync.py:
  - sem ERP_SYNC_PY_LIBERADO=sim no ambiente DA EXECUÇÃO (nunca o .env), recusa
    com código 2;
  - e só roda com companies.canal_catalogo = 'firebird' na empresa COMPANY_ID
    (migração 048). Com o catálogo vindo do Control pela API, regravar a foto
    por aqui seria um segundo escritor no mesmo fluxo. Sem a coluna, ou sem
    conseguir ler, recusa.
  - --dry-run continua livre: ele só mapeia arquivo → produto.

Variáveis de ambiente (.env — mesmas do sync.py):
  SUPABASE_URL          = https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  = eyJ...
  COMPANY_ID            = uuid-da-empresa
  PHOTOS_DIR            = (opcional) caminho da pasta de fotos
  STORAGE_BUCKET        = (opcional) nome do bucket (default: product-images)

Dependências:
  pip install pillow httpx python-dotenv
"""
import os, sys, re, time, logging, argparse, io
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("erp-photos")

SCRIPT_DIR = Path(__file__).parent

# Lido ANTES do load_dotenv de propósito: a liberação de quem grava tem de vir
# do terminal de quem roda, não de uma linha esquecida num .env.
LIBERACAO_ENV = "ERP_SYNC_PY_LIBERADO"
LIBERADO = os.environ.get(LIBERACAO_ENV, "").strip().lower() == "sim"

try:
    from dotenv import load_dotenv
    load_dotenv(SCRIPT_DIR / ".env")
    load_dotenv(SCRIPT_DIR / "../../apps/api/.env")
except ImportError:
    log.warning("python-dotenv não instalado — usando variáveis de ambiente do sistema")

try:
    import httpx
except ImportError:
    log.error("httpx não instalado. Execute: pip install httpx")
    sys.exit(1)

try:
    from PIL import Image, ImageOps
except ImportError:
    log.error("Pillow não instalado. Execute: pip install pillow")
    sys.exit(1)

# ─── config ───────────────────────────────────────────────────────────────────
SUPABASE_URL  = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY  = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
COMPANY_ID    = os.environ.get("COMPANY_ID", "")
BUCKET        = os.environ.get("STORAGE_BUCKET", "product-images")
DEFAULT_DIR   = os.environ.get(
    "PHOTOS_DIR",
    r"\\192.168.0.2\Comercial\MARKETING\FOTOS CATALOGO INVERNO 2026_CORPO SENSUAL",
)
IMAGE_MAX_DIM = int(os.environ.get("IMAGE_MAX_DIM", "1000"))
IMAGE_QUALITY = int(os.environ.get("IMAGE_QUALITY", "82"))

# Só arquivos cujo nome é EXATAMENTE um código numérico (ex.: 0140.jpg).
# Ignora alternativas/multi-produto com hífen (0260-1.jpg, 0162-0160.jpg) e a
# subpasta CONCEITO — essas podem virar galeria depois.
CODE_FILE_RE = re.compile(r"^(\d+)\.(jpe?g|png)$", re.IGNORECASE)

JSON_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def norm_code(code: str) -> str:
    """Normaliza p/ casar apesar de zero-padding (0015 ↔ 15)."""
    return code.lstrip("0") or "0"


# ─── travas ───────────────────────────────────────────────────────────────────
def ler_canal_catalogo() -> tuple[str | None, str]:
    """(canal, motivo) de companies.canal_catalogo da COMPANY_ID.

    Uma leitura GET ?select=canal_catalogo&id=eq.<COMPANY_ID>. canal None = não
    deu para saber (coluna ausente, empresa sem linha, erro de rede), e quem
    chama recusa.
    """
    url = f"{SUPABASE_URL}/rest/v1/companies?select=canal_catalogo&id=eq.{COMPANY_ID}"
    try:
        r = httpx.get(url, headers=JSON_HEADERS, timeout=30)
    except Exception as e:  # rede, DNS, timeout
        return None, f"falha ao ler o canal ({type(e).__name__})"
    if r.status_code != 200:
        texto = r.text[:300]
        if "42703" in texto or "PGRST204" in texto or "does not exist" in texto:
            return None, "a coluna companies.canal_catalogo não existe (migração 048 não aplicada)"
        return None, f"falha ao ler o canal [{r.status_code}]"
    try:
        linhas = r.json()
    except ValueError:
        return None, "resposta ilegível ao ler o canal"
    if not isinstance(linhas, list) or not linhas:
        return None, "empresa COMPANY_ID não encontrada em companies"
    return linhas[0].get("canal_catalogo"), "ok"


def conferir_travas() -> None:
    """Sai com código 2 antes de tocar no bucket ou no catálogo."""
    if not LIBERADO:
        log.error(
            f"este script grava no catálogo e está travado: rode com {LIBERACAO_ENV}=sim no ambiente "
            "desta execução (o .env não conta). Veja o README antes."
        )
        sys.exit(2)
    canal, motivo = ler_canal_catalogo()
    if canal != "firebird":
        detalhe = f"canal_catalogo='{canal}'" if canal is not None else motivo
        log.error(
            f"recusado: {detalhe}. As fotos só entram por aqui com canal_catalogo='firebird' nesta "
            "empresa; com 'api' o catálogo vem do Control e regravar image_url seria um segundo escritor."
        )
        sys.exit(2)


# ─── Supabase ─────────────────────────────────────────────────────────────────
def ensure_bucket():
    """Cria o bucket público se ainda não existir (idempotente)."""
    url = f"{SUPABASE_URL}/storage/v1/bucket"
    r = httpx.post(
        url, headers=JSON_HEADERS, timeout=30,
        json={"id": BUCKET, "name": BUCKET, "public": True,
              "file_size_limit": "10MB", "allowed_mime_types": ["image/jpeg"]},
    )
    if r.status_code in (200, 201):
        log.info(f"Bucket '{BUCKET}' criado (público).")
    elif r.status_code in (400, 409) and "exist" in r.text.lower():
        log.info(f"Bucket '{BUCKET}' já existe.")
    else:
        log.warning(f"ensure_bucket inesperado [{r.status_code}]: {r.text[:200]}")


def fetch_products() -> dict:
    """Mapa { código normalizado → product_id } dos produtos da empresa."""
    url = f"{SUPABASE_URL}/rest/v1/products?select=id,erp_id,sku&company_id=eq.{COMPANY_ID}"
    r = httpx.get(url, headers=JSON_HEADERS, timeout=60)
    r.raise_for_status()
    out = {}
    for p in r.json():
        for key in (p.get("erp_id"), p.get("sku")):
            if key:
                out[norm_code(str(key))] = p["id"]
    return out


def upload_image(path: str, jpeg_bytes: bytes) -> str:
    """Sobe (upsert) e devolve a URL pública."""
    object_path = f"{COMPANY_ID}/{path}"
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{object_path}"
    r = httpx.post(
        url, content=jpeg_bytes, timeout=120,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "image/jpeg",
            "x-upsert": "true",
            "cache-control": "max-age=31536000",
        },
    )
    if r.status_code not in (200, 201):
        raise RuntimeError(f"upload {object_path} falhou [{r.status_code}]: {r.text[:200]}")
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{object_path}"


def set_image_url(product_id: str, image_url: str):
    url = f"{SUPABASE_URL}/rest/v1/products?id=eq.{product_id}"
    r = httpx.patch(
        url, headers={**JSON_HEADERS, "Prefer": "return=minimal"}, timeout=30,
        json={"image_url": image_url, "updated_at": now_iso()},
    )
    if r.status_code not in (200, 204):
        raise RuntimeError(f"patch products falhou [{r.status_code}]: {r.text[:200]}")


# ─── imagem ───────────────────────────────────────────────────────────────────
def resize_jpeg(src: Path) -> bytes:
    """Abre, corrige orientação EXIF, redimensiona e devolve JPEG otimizado."""
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode != "RGB":
            im = im.convert("RGB")
        im.thumbnail((IMAGE_MAX_DIM, IMAGE_MAX_DIM), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=IMAGE_QUALITY, optimize=True, progressive=True)
        return buf.getvalue()


# ─── main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Ingestão de fotos → Supabase Storage")
    parser.add_argument("--dir", default=DEFAULT_DIR, help="Pasta com as fotos")
    parser.add_argument("--dry-run", action="store_true", help="Mapeia, mas não sobe nem grava")
    parser.add_argument("--limit", type=int, default=0, help="Processa no máx. N fotos (teste)")
    args = parser.parse_args()

    if not args.dry_run and (not SUPABASE_URL or not SUPABASE_KEY or not COMPANY_ID):
        log.error("SUPABASE_URL, SUPABASE_SERVICE_KEY e COMPANY_ID são obrigatórios (exceto --dry-run)")
        sys.exit(1)

    # Trava antes de qualquer escrita (o --dry-run não escreve nada e passa).
    if not args.dry_run:
        conferir_travas()

    folder = Path(args.dir)
    if not folder.is_dir():
        log.error(f"Pasta não encontrada: {folder}")
        sys.exit(1)

    files = sorted(p for p in folder.iterdir() if p.is_file() and CODE_FILE_RE.match(p.name))
    skipped = [p.name for p in folder.iterdir() if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg", ".png") and not CODE_FILE_RE.match(p.name)]
    log.info(f"Pasta: {folder}")
    log.info(f"Fotos código-único: {len(files)} | ignoradas (hífen/alt/multi): {len(skipped)}")

    products = {} if args.dry_run else fetch_products()
    if not args.dry_run:
        log.info(f"Produtos no Supabase: {len(products)}")
        ensure_bucket()

    if args.limit:
        files = files[:args.limit]

    matched = unmatched = uploaded = 0
    t0 = time.time()
    for f in files:
        code = CODE_FILE_RE.match(f.name).group(1)
        pid = products.get(norm_code(code)) if not args.dry_run else None

        if args.dry_run:
            log.info(f"  {f.name}  →  produto {code}")
            matched += 1
            continue

        if not pid:
            log.warning(f"  {f.name}: sem produto correspondente (código {code}) — pulando")
            unmatched += 1
            continue

        try:
            jpeg = resize_jpeg(f)
            public_url = upload_image(f"{code}.jpg", jpeg)
            set_image_url(pid, public_url)
            uploaded += 1
            matched += 1
            log.info(f"  {f.name}: {len(jpeg)//1024} KB → {public_url}")
        except Exception as e:  # noqa: BLE001
            log.error(f"  {f.name}: ERRO — {e}")

    elapsed = time.time() - t0
    log.info("─" * 60)
    if args.dry_run:
        log.info(f"DRY-RUN: {matched} fotos mapeáveis por código. Nada foi enviado.")
    else:
        log.info(f"Concluído em {elapsed:.1f}s | enviadas: {uploaded} | sem produto: {unmatched}")
        if unmatched:
            log.info("Códigos sem produto provavelmente significam que o sync do ERP ainda não rodou.")


if __name__ == "__main__":
    main()
