import { useState, type ReactNode } from 'react';
import {
  Smartphone,
  Share,
  Plus,
  Check,
  MoreVertical,
  Download,
  CheckCircle2,
  Copy,
  MessageCircle,
  Monitor,
} from 'lucide-react';
import { useInstalarApp } from '../../hooks/useInstalarApp.js';
import { pedirInstalacao } from '../../lib/instalarApp.js';
import { Button } from './Button.js';
import { cn } from '../../lib/utils.js';

/**
 * Convite para deixar o sistema como aplicativo na tela inicial.
 *
 * Instalado, o app abre em tela cheia, entra no aparelho pelo ícone e guarda o
 * catálogo para funcionar sem internet — que é o motivo de existir, não um
 * detalhe: o representante trabalha em loja com sinal ruim.
 *
 * Chrome, Edge, Samsung Internet e Opera instalam com um toque. iPhone e
 * Firefox não têm essa API, então recebem o caminho do menu — um botão que não
 * faz nada seria pior do que nenhum botão.
 *
 * **O cartão nunca some.** Ele já sumiu duas vezes, por motivos diferentes, e
 * as duas foram vistas como "o botão foi tirado":
 *
 *   1. quando o navegador não mandava o convite (ícone reprovado, ou app já
 *      instalado naquele perfil — o Chrome não oferece duas vezes);
 *   2. quando o app já estava instalado NESTE aparelho, caso em que ele voltava
 *      `null` de propósito.
 *
 * O (1) virou tutorial pelo menu. O (2) virou este estado "instalado": some o
 * convite, fica o caminho para colocar o app nos OUTROS aparelhos — que é
 * justamente o que a pessoa procura quando abre o app do computador querendo o
 * ícone no celular. Um cartão que desaparece não ensina nada; ele só deixa a
 * impressão de que a função foi embora.
 */
export function CartaoInstalar() {
  const estado = useInstalarApp();
  const [painel, setPainel] = useState<'nenhum' | 'aqui' | 'outro'>('nenhum');
  const [instalando, setInstalando] = useState(false);

  const instalado = estado === 'instalado';
  const automatico = estado === 'pronto';

  const alternar = (qual: 'aqui' | 'outro') =>
    setPainel((atual) => (atual === qual ? 'nenhum' : qual));

  const instalar = async () => {
    setInstalando(true);
    try {
      await pedirInstalacao();
    } finally {
      setInstalando(false);
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        instalado ? 'border-border bg-card shadow-sm' : 'border-primary/30 bg-primary-soft',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
              instalado
                ? 'bg-positive-soft text-positive-soft-foreground'
                : 'bg-card text-primary-soft-foreground',
            )}
          >
            {instalado ? (
              <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
            ) : (
              <Smartphone className="h-5 w-5" strokeWidth={2} />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">
              {instalado ? 'Já está na sua tela inicial' : 'Deixe na tela inicial'}
            </p>
            <p className="text-xs text-muted-foreground">
              {instalado
                ? 'Neste aparelho, pronto. Dá para colocar no celular e no computador também.'
                : 'Abre como aplicativo, em tela cheia, e funciona sem internet.'}
            </p>
          </div>
        </div>

        {instalado ? (
          <Button size="md" variant="outline" className="shrink-0" onClick={() => alternar('outro')}>
            <Smartphone className="h-4 w-4" strokeWidth={2.5} />
            {painel === 'outro' ? 'Fechar' : 'Outro aparelho'}
          </Button>
        ) : automatico ? (
          <Button size="md" className="shrink-0" disabled={instalando} onClick={() => void instalar()}>
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            {instalando ? 'Instalando…' : 'Adicionar'}
          </Button>
        ) : (
          <Button size="md" variant="outline" className="shrink-0" onClick={() => alternar('aqui')}>
            {painel === 'aqui' ? 'Fechar' : 'Como fazer'}
          </Button>
        )}
      </div>

      {/*
        O atalho quase nunca é para o aparelho em que a pessoa está: ela abre no
        computador e quer o ícone no celular. Sem esta saída, a única forma era
        digitar o endereço na mão no outro aparelho.
      */}
      {instalado ? null : (
        <button
          type="button"
          onClick={() => alternar('outro')}
          className="mt-3 text-xs font-semibold text-primary-soft-foreground underline underline-offset-2"
        >
          {painel === 'outro' ? 'Fechar' : 'Quero em outro aparelho (celular, computador)'}
        </button>
      )}

      {/*
        `!instalado` cobre um caso curto mas real: a pessoa abre o tutorial,
        instala pelo menu do navegador e o `appinstalled` chega com o painel
        aberto. Sem isto o passo a passo ficaria embaixo de um cartão que acabou
        de dizer "já está instalado" — e sem botão para fechar, porque o "Como
        fazer" já não está mais na tela.
      */}
      {painel === 'aqui' && !instalado ? (
        <div className="mt-4 border-t border-primary/20 pt-3">
          {estado === 'manual-apple' ? (
            <PassosApple />
          ) : estado === 'manual-firefox' ? (
            <PassosFirefox />
          ) : (
            <PassosMenu />
          )}
        </div>
      ) : null}

      {painel === 'outro' ? (
        <div className={cn('mt-4 border-t pt-3', instalado ? 'border-border' : 'border-primary/20')}>
          <OutroAparelho />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Colocar o app num aparelho diferente deste.
 *
 * Aqui a detecção de navegador não vale nada — o destino é outro aparelho, que
 * pode ser qualquer coisa. Por isso os três caminhos aparecem juntos, curtos, em
 * vez de um só adivinhado errado.
 */
function OutroAparelho() {
  const [copiado, setCopiado] = useState(false);
  const endereco = typeof window === 'undefined' ? '' : window.location.origin;

  const mensagem =
    'Abra este endereço no aparelho onde você quer o aplicativo da Corpo Sensual, ' +
    'entre na sua conta e toque em «Deixe na tela inicial», na Minha área:\n\n' +
    endereco;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Cópia bloqueada (permissão negada, contexto sem HTTPS): seleciona o
      // texto para copiar à mão. O endereço continua na tela.
      (document.getElementById('endereco-do-app') as HTMLInputElement | null)?.select();
    }
  };

  return (
    <>
      <p className="text-sm text-foreground">
        Abra este endereço no outro aparelho e entre na sua conta. O convite aparece na{' '}
        <strong>Minha área</strong>.
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          id="endereco-do-app"
          aria-label="Endereço do sistema"
          readOnly
          value={endereco}
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
        />
        <Button size="md" variant="outline" className="shrink-0" onClick={() => void copiar()}>
          {copiado ? (
            <Check className="h-4 w-4" strokeWidth={2.5} />
          ) : (
            <Copy className="h-4 w-4" strokeWidth={2.5} />
          )}
          {copiado ? 'Copiado' : 'Copiar'}
        </Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <MessageCircle className="h-4 w-4" strokeWidth={2.5} />
          Mandar no WhatsApp
        </a>
      </div>

      <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
        <li className="flex items-start gap-2">
          <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>
            <strong className="text-foreground">Android:</strong> abra no Chrome — o botão
            «Adicionar» instala com um toque.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>
            <strong className="text-foreground">iPhone e iPad:</strong> abra no Safari, toque em
            Compartilhar e escolha «Adicionar à Tela de Início».
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>
            <strong className="text-foreground">Computador:</strong> no Chrome ou Edge, o botão
            «Adicionar» instala; ou use o ícone de instalar na barra de endereço.
          </span>
        </li>
      </ul>
    </>
  );
}

/**
 * iPhone e iPad.
 *
 * A Apple não expõe instalação para o site pedir — em nenhum navegador do iOS,
 * porque todos usam o motor do Safari. O caminho é o menu Compartilhar, e
 * descrever o ícone importa mais do que nomeá-lo: ninguém procura por "Share".
 */
function PassosApple() {
  return (
    <>
      <ol className="space-y-2 text-sm text-foreground">
        <Passo numero={1} icone={Share}>
          Toque em <strong>Compartilhar</strong> — o quadradinho com a seta para cima, na barra de
          baixo.
        </Passo>
        <Passo numero={2} icone={Plus}>
          Role a lista e escolha <strong>Adicionar à Tela de Início</strong>.
        </Passo>
        <Passo numero={3} icone={Check}>
          Confirme em <strong>Adicionar</strong>. O ícone aparece junto dos seus outros aplicativos.
        </Passo>
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Não achou a opção? Abra este mesmo endereço no <strong>Safari</strong> — no iPhone, só ele
        adiciona à tela de início.
      </p>
    </>
  );
}

/**
 * Chrome, Edge, Samsung e afins quando o convite não veio.
 *
 * O caso mais comum não é navegador incapaz, é app JÁ INSTALADO neste perfil —
 * o Chrome não oferece duas vezes. O texto assume isso sem acusar: descreve o
 * caminho do menu, que funciona nos dois casos.
 */
function PassosMenu() {
  return (
    <>
      <ol className="space-y-2 text-sm text-foreground">
        <Passo numero={1} icone={MoreVertical}>
          Toque nos <strong>três pontinhos</strong> do navegador, no canto.
        </Passo>
        <Passo numero={2} icone={Download}>
          Escolha <strong>Instalar aplicativo</strong> — em alguns aparelhos aparece como «Adicionar
          à tela inicial».
        </Passo>
        <Passo numero={3} icone={Check}>
          Confirme. O ícone aparece junto dos seus outros aplicativos.
        </Passo>
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Não achou? Provavelmente o app <strong>já está instalado</strong> neste aparelho — procure o
        ícone na tela inicial. O navegador não oferece a instalação duas vezes.
      </p>
    </>
  );
}

/** Firefox: instala pelo menu, mas não avisa o site que dá para instalar. */
function PassosFirefox() {
  return (
    <>
      <ol className="space-y-2 text-sm text-foreground">
        <Passo numero={1} icone={MoreVertical}>
          Toque nos <strong>três pontinhos</strong> do navegador.
        </Passo>
        <Passo numero={2} icone={Download}>
          Escolha <strong>Instalar</strong> (em algumas versões, «Adicionar à tela inicial»).
        </Passo>
        <Passo numero={3} icone={Check}>
          Confirme. O ícone aparece junto dos seus outros aplicativos.
        </Passo>
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        No <strong>Chrome</strong> a instalação é um toque só — se preferir, abra este endereço por
        lá.
      </p>
    </>
  );
}

function Passo({
  numero,
  icone: Icone,
  children,
}: {
  numero: number;
  icone: typeof Share;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-card text-[11px] font-bold text-primary-soft-foreground">
        {numero}
      </span>
      <span className="min-w-0 leading-snug">
        <Icone className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" strokeWidth={2} />
        {children}
      </span>
    </li>
  );
}
