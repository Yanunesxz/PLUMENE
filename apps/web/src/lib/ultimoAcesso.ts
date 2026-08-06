/**
 * "Último acesso" em linguagem de gente.
 *
 * A pergunta que essa linha responde é "este login ainda serve?". Para isso,
 * "há 3 dias" vale mais que um carimbo com hora e minuto — e passado um mês a
 * data volta a ser mais útil, porque "há 47 dias" ninguém consegue situar.
 */
export function descreverUltimoAcesso(iso: string | null): string {
  if (!iso) return 'nunca entrou';

  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return 'nunca entrou';

  const minutos = Math.floor((Date.now() - quando.getTime()) / 60_000);
  if (minutos < 60) return 'agora há pouco';

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return horas === 1 ? 'há 1 hora' : `há ${horas} horas`;

  const dias = Math.floor(horas / 24);
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;

  return `em ${quando.toLocaleDateString('pt-BR')}`;
}
