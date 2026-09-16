/**
 * A LIBERAÇÃO DE QUEM RODA — lida antes de qualquer `dotenv`.
 *
 * Script que apaga ou inventa dado (o seed de demonstração, por exemplo) exige
 * um "sim" explícito de quem está no teclado. Se esse "sim" pudesse vir do
 * `.env`, ele viraria configuração esquecida no disco — e o `.env` da máquina
 * de desenvolvimento aponta para o Supabase de PRODUÇÃO.
 *
 * Por isso este módulo copia `process.env` no instante em que é carregado, e
 * quem o usa precisa importá-lo ANTES de `dotenv/config` (os `import` do ES
 * rodam na ordem em que aparecem). É o mesmo combinado do `sync.py`, que lê
 * `ERP_SYNC_PY_LIBERADO` antes do `load_dotenv`.
 */
const AMBIENTE_DA_EXECUCAO: Readonly<Record<string, string | undefined>> = { ...process.env };

/** A variável veio do terminal desta execução com o valor "sim"? */
export function liberadoNoAmbiente(nome: string): boolean {
  return (AMBIENTE_DA_EXECUCAO[nome] ?? '').trim().toLowerCase() === 'sim';
}
