/**
 * "A última mão foi a do Control?" — a pergunta que impede o eco da
 * sincronização nas duas mãos (decisão 7 de 16/09/2026).
 *
 * O Control MANDA clientes (POST /clientes, POST /retrato) e PUXA o que mudou
 * no app (GET /clientes?desde=). Sem um filtro, tudo que ele acabou de gravar
 * voltaria no GET seguinte — o retrato diário devolveria a carteira inteira. O
 * filtro é `customers.erp_updated_at` (049): o carimbo de quando o Control
 * gravou o cadastro pela última vez.
 *
 * Por que há uma FOLGA (revisão de 16/09/2026): a trigger da 013
 * (`tocar_updated_at`) grava `updated_at = NOW()` com a hora do BANCO, no
 * início da transação do UPDATE. O carimbo é a hora da API, tomada logo antes
 * de mandar esse mesmo UPDATE. Então, numa gravação do Control, `updated_at`
 * sempre sai alguns milissegundos (sob carga, algum segundo) DEPOIS do
 * carimbo — e a comparação seca `updated_at <= erp_updated_at` dava "o app
 * mexeu" em toda gravação do Control. Até FOLGA_DO_RELOGIO_MS depois do
 * carimbo, a mão ainda é a do Control.
 *
 * O preço da folga: uma edição do app feita MENOS de 5 s depois de o Control
 * gravar o mesmo cliente não volta no GET. É janela de segundos por cliente;
 * a solução sem relógio (uma coluna gravada só pelos caminhos do app, ou o
 * carimbo com now() numa RPC) precisa de migração nova. A edição do CADASTRO
 * pela tela (051, 17/09/2026) já escapa desse preço: o cliente com edição
 * pendente em customer_changes sai no GET mesmo dentro da folga, e o POST não
 * carimba enquanto ela está pendente (partner.sync.service.ts).
 *
 * O carimbo só é gravado quando a última mão JÁ era a do Control (ou nunca
 * houve carimbo): se o app mexeu depois e o Control ainda não puxou, carimbar
 * agora esconderia do GET a mudança do app que o Control nunca viu.
 */

/** Quanto depois do carimbo do Control a mão ainda é dele (a trigger grava com a hora do banco). */
export const FOLGA_DO_RELOGIO_MS = 5_000;

const instante = (v: unknown): number => (typeof v === 'string' && v.trim() ? Date.parse(v) : Number.NaN);

/**
 * O Control foi o último a mexer neste cliente? `false` sem carimbo (o Control
 * nunca gravou) ou com data ilegível — na dúvida, o cliente sai no GET, que é
 * o lado inofensivo (reenviar é `sem_mudanca`).
 */
export function ultimaMaoFoiDoControl(updatedAt: unknown, carimboDoControl: unknown): boolean {
  const carimbo = instante(carimboDoControl);
  const atualizado = instante(updatedAt);
  if (Number.isNaN(carimbo) || Number.isNaN(atualizado)) return false;
  return atualizado <= carimbo + FOLGA_DO_RELOGIO_MS;
}

/**
 * Pode carimbar esta gravação do Control? Sim quando não há carimbo (o Control
 * passa a conhecer o cadastro agora) ou quando a última mão já era a dele. Não
 * quando o app mexeu depois do último carimbo: a mudança do app ainda tem de
 * sair no GET.
 */
export function podeCarimbar(updatedAt: unknown, carimboDoControl: unknown): boolean {
  const carimbo = instante(carimboDoControl);
  if (Number.isNaN(carimbo)) return true;
  const atualizado = instante(updatedAt);
  if (Number.isNaN(atualizado)) return true;
  return atualizado <= carimbo + FOLGA_DO_RELOGIO_MS;
}
