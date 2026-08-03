import { useState, type ReactNode } from 'react';
import { Smartphone, Share, Plus, Check, MoreVertical, Download } from 'lucide-react';
import { useInstalarApp } from '../../hooks/useInstalarApp.js';
import { pedirInstalacao } from '../../lib/instalarApp.js';
import { Button } from './Button.js';

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
 * Some sozinho quando já está instalado: oferecer o que a pessoa já tem é ruído
 * permanente numa tela que ela abre todo dia.
 */
export function CartaoInstalar() {
  const estado = useInstalarApp();
  const [comoFazer, setComoFazer] = useState(false);
  const [instalando, setInstalando] = useState(false);

  if (estado === 'instalado' || estado === 'indisponivel') return null;

  const automatico = estado === 'pronto';

  const instalar = async () => {
    setInstalando(true);
    try {
      await pedirInstalacao();
    } finally {
      setInstalando(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary-soft p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-primary-soft-foreground">
            <Smartphone className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">Deixe na tela inicial</p>
            <p className="text-xs text-muted-foreground">
              Abre como aplicativo, em tela cheia, e funciona sem internet.
            </p>
          </div>
        </div>

        {automatico ? (
          <Button size="md" className="shrink-0" disabled={instalando} onClick={() => void instalar()}>
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            {instalando ? 'Instalando…' : 'Adicionar'}
          </Button>
        ) : (
          <Button size="md" variant="outline" className="shrink-0" onClick={() => setComoFazer((v) => !v)}>
            {comoFazer ? 'Fechar' : 'Como fazer'}
          </Button>
        )}
      </div>

      {comoFazer ? (
        <div className="mt-4 border-t border-primary/20 pt-3">
          {estado === 'manual-apple' ? <PassosApple /> : <PassosFirefox />}
        </div>
      ) : null}
    </div>
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
