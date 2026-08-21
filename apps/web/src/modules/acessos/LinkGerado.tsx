import { useState } from 'react';
import { Check, Copy, MessageCircle, X } from 'lucide-react';
import { Button } from '../../components/interface/Button.js';
import { MARCA } from '../../lib/marca.js';

interface LinkGeradoProps {
  url: string;
  expiraEm: string;
  /** Convite cria conta; vitrine só mostra o catálogo por um tempo. */
  tipo: 'convite' | 'vitrine';
  /** Nome da loja — usado na mensagem do convite. */
  cliente?: string | undefined;
  /** WhatsApp do cadastro: abre a conversa já no contato certo. */
  whatsapp?: string | undefined;
  /** Horas de validade da vitrine, para a mensagem dizer o prazo. */
  horas?: number | undefined;
  onFechar: () => void;
}

/**
 * Quanto falta, em texto curto.
 *
 * Arredonda em vez de truncar: o link acabou de ser criado, então faltam
 * 5h59min para um de 6h — e "vale por 5 horas" logo depois de escolher 6h
 * parece defeito.
 */
function faltam(ate: string): string {
  const ms = new Date(ate).getTime() - Date.now();
  if (ms <= 0) return 'expirado';
  if (ms >= 86400_000) {
    const dias = Math.round(ms / 86400_000);
    return `${dias} dia${dias > 1 ? 's' : ''}`;
  }
  if (ms >= 3600_000) {
    const horas = Math.round(ms / 3600_000);
    return `${horas} hora${horas > 1 ? 's' : ''}`;
  }
  return `${Math.max(1, Math.round(ms / 60_000))} minutos`;
}

/**
 * Nome utilizável numa saudação.
 *
 * A razão social vem do ERP com o CNPJ na frente — "28.566.837 LUIS RICARDO
 * BUSCARIOLI". Mandar "Oi, 28.566.837 LUIS RICARDO..." no WhatsApp da loja é
 * pior do que não chamar pelo nome. Tira o prefixo numérico e, se não sobrar
 * nada apresentável, devolve nada: a mensagem fica só "Oi!".
 */
function nomeParaSaudacao(nome: string | undefined): string | null {
  if (!nome) return null;
  const limpo = nome.replace(/^[\d.\-/\s]+/, '').trim();
  if (limpo.length < 2) return null;
  // Primeiro nome basta; razão social inteira em caixa alta soa a cobrança.
  const primeiro = limpo.split(/\s+/)[0] ?? '';
  return primeiro.length >= 2
    ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
    : null;
}

/**
 * O que aparece DEPOIS de gerar o link.
 *
 * Existe porque o link só é devolvido uma vez pela API: se o representante
 * perder, tem que gerar outro. Antes ele ia direto para a área de transferência
 * e sumia — e cópia falha com frequência em celular fora de HTTPS. Agora fica na
 * tela, visível e selecionável, até ele mandar.
 *
 * A ação principal é o WhatsApp, não o "copiar": o trabalho do representante não
 * termina na área de transferência, termina na conversa com a loja.
 */
export function LinkGerado({
  url,
  expiraEm,
  tipo,
  cliente,
  whatsapp,
  horas,
  onFechar,
}: LinkGeradoProps) {
  const [copiado, setCopiado] = useState(false);

  const saudacao = nomeParaSaudacao(cliente);
  const mensagem =
    tipo === 'convite'
      ? `Oi${saudacao ? `, ${saudacao}` : ''}! Criei seu acesso ao catálogo da ${MARCA.nome}. ` +
        `É só abrir o link e cadastrar sua senha:\n\n${url}\n\n` +
        `Depois disso você monta o pedido quando quiser, direto por aí.`
      : `Oi! Segue o catálogo da ${MARCA.nome}:\n\n${url}\n\n` +
        `O link fica disponível por ${horas ?? 24} horas.`;

  // Sem número, o WhatsApp abre a lista de contatos para escolher.
  const digitos = whatsapp?.replace(/\D/g, '') ?? '';
  const numero = digitos.length >= 10 ? `55${digitos}` : '';
  const linkWhats = `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Cópia bloqueada (contexto sem HTTPS, permissão negada): seleciona o
      // texto para o representante copiar à mão. O link continua na tela.
      const campo = document.getElementById('link-gerado') as HTMLInputElement | null;
      campo?.select();
    }
  };

  return (
    <div className="mb-5 rounded-xl border border-primary/30 bg-primary-soft p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary-soft-foreground">
            {tipo === 'convite' ? 'Convite criado' : 'Link criado'}
            {cliente ? ` para ${cliente}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-primary-soft-foreground/80">
            Vale por {faltam(expiraEm)}. Este link não aparece de novo — mande agora.
          </p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary-soft-foreground/70 hover:bg-primary/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Visível e selecionável: se a cópia automática falhar, dá para pegar à mão. */}
      <input
        id="link-gerado"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="mb-3 w-full truncate rounded-lg border border-primary/20 bg-card px-3 py-2 font-mono text-xs text-foreground"
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={linkWhats}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <MessageCircle className="h-4 w-4" strokeWidth={2.5} />
          {numero ? 'Enviar no WhatsApp' : 'Escolher contato'}
        </a>
        <Button variant="outline" onClick={() => void copiar()} className="sm:w-40">
          {copiado ? (
            <>
              <Check className="h-4 w-4" strokeWidth={2.5} />
              Copiado
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" strokeWidth={2.5} />
              Copiar link
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
