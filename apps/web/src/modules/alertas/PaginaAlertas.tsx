import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BellRing,
  ChevronRight,
  CircleCheck,
  Info,
  ArrowDownToLine,
  Smartphone,
} from 'lucide-react';
import { useAlertas } from '../../hooks/useAlertas.js';
import { useAvisosNoCelular } from '../../hooks/useAvisosNoCelular.js';
import { aplicarAtualizacao } from '../../lib/atualizarApp.js';
import { pedirInstalacao } from '../../lib/instalarApp.js';
import { Button } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { cn } from '../../lib/utils.js';
import type { Alerta, NivelDoAlerta } from '../../lib/alertas.js';

/**
 * A central de Alertas do representante — o que está pendente, em três
 * degraus, com o botão de resolver ALI (atualizar, ativar avisos, instalar).
 *
 * Abrir a tela marca atenção e normal como vistos (o número do menu esvazia);
 * urgente continua contando até a pessoa RESOLVER — regra do Yan.
 */

const SECOES: Array<{
  nivel: NivelDoAlerta;
  titulo: string;
  icone: typeof AlertTriangle;
  classes: { faixa: string; icone: string };
}> = [
  {
    nivel: 'urgente',
    titulo: 'Urgentes',
    icone: AlertTriangle,
    classes: { faixa: 'border-danger/40 bg-danger-soft', icone: 'text-danger-soft-foreground' },
  },
  {
    nivel: 'atencao',
    titulo: 'Precisam de atenção',
    icone: Info,
    classes: { faixa: 'border-warn/40 bg-warn-soft', icone: 'text-warn-soft-foreground' },
  },
  {
    nivel: 'normal',
    titulo: 'Para quando der',
    icone: BellRing,
    classes: { faixa: 'border-border bg-card', icone: 'text-muted-foreground' },
  },
];

export function PaginaAlertas() {
  const navigate = useNavigate();
  const { alertas, marcarVistos, carregando } = useAlertas();
  const push = useAvisosNoCelular();
  const [atualizando, setAtualizando] = useState(false);
  const [instalando, setInstalando] = useState(false);

  // Abrir a tela É o "já vi": atenção e normal saem do número do menu.
  // Urgente fica — só resolve quem age.
  useEffect(() => {
    if (!carregando) marcarVistos();
  }, [carregando, marcarVistos]);

  const agir = async (a: Alerta) => {
    if (!a.acao) return;
    switch (a.acao.tipo) {
      case 'atualizar':
        setAtualizando(true);
        await aplicarAtualizacao();
        break;
      case 'ativar_avisos':
        await push.ativar();
        break;
      case 'instalar':
        setInstalando(true);
        try {
          await pedirInstalacao();
        } finally {
          setInstalando(false);
        }
        break;
      case 'ir':
        void navigate(a.acao.para ?? '/');
        break;
    }
  };

  const rotuloDoBotao = (a: Alerta): string => {
    if (a.acao?.tipo === 'atualizar' && atualizando) return 'Atualizando…';
    if (a.acao?.tipo === 'ativar_avisos' && push.ocupado) return 'Ativando…';
    if (a.acao?.tipo === 'instalar' && instalando) return 'Instalando…';
    return a.acao?.rotulo ?? '';
  };

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">Alertas</h1>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        O que está pendente, do mais urgente ao tranquilo. Resolveu, some sozinho.
      </p>

      {carregando ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : alertas.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
          <CircleCheck className="h-8 w-8 text-positive" strokeWidth={1.5} />
          <p className="font-medium text-foreground">Tudo em dia!</p>
          <p className="text-sm text-muted-foreground">
            Nenhuma pendência por aqui. Bom trabalho. 👊
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {SECOES.map(({ nivel, titulo, icone: Icone, classes }) => {
            const doNivel = alertas.filter((a) => a.nivel === nivel);
            if (doNivel.length === 0) return null;
            return (
              <section key={nivel}>
                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icone className={cn('h-4 w-4', classes.icone)} strokeWidth={2.5} />
                  {titulo} ({doNivel.length})
                </h2>
                <ul className="space-y-2">
                  {doNivel.map((a) => (
                    <li
                      key={a.id}
                      className={cn(
                        'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 shadow-sm',
                        classes.faixa,
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">{a.titulo}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {a.detalhe}
                        </p>
                        {a.acao?.tipo === 'ativar_avisos' && push.aviso && (
                          <p className="mt-1 text-xs text-danger-soft-foreground">{push.aviso}</p>
                        )}
                      </div>
                      {a.acao &&
                        (a.acao.tipo === 'ir' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            onClick={() => void agir(a)}
                          >
                            {a.acao.rotulo}
                            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            className="shrink-0"
                            disabled={atualizando || push.ocupado || instalando}
                            onClick={() => void agir(a)}
                          >
                            {a.acao.tipo === 'atualizar' && (
                              <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={2.5} />
                            )}
                            {a.acao.tipo === 'instalar' && (
                              <Smartphone className="h-3.5 w-3.5" strokeWidth={2.5} />
                            )}
                            {a.acao.tipo === 'ativar_avisos' && (
                              <BellRing className="h-3.5 w-3.5" strokeWidth={2.5} />
                            )}
                            {rotuloDoBotao(a)}
                          </Button>
                        ))}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
