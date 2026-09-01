import { Bell, BellOff, BellRing } from 'lucide-react';
import { useAvisosNoCelular } from '../../hooks/useAvisosNoCelular.js';
import { Button } from './Button.js';

/**
 * Avisos no celular (Web Push), na "Minha área".
 *
 * Um botão, uma decisão: a pessoa toca em "Ativar", o celular pergunta uma vez
 * e pronto — pedido chegando, aceite da fábrica e faturamento passam a apitar
 * mesmo com o app fechado. Nada é pedido na primeira abertura do app, de
 * propósito: permissão pedida sem contexto é permissão negada.
 *
 * O cartão só aparece quando dá para cumprir o que promete: navegador com
 * suporte E servidor com as chaves configuradas. iPhone só suporta com o app
 * na tela de início — sem isso, o cartão nem aparece por lá.
 *
 * A regra inteira (permissão, chave, assinatura) mora em `useAvisosNoCelular`,
 * compartilhada com a tela de Alertas.
 */
export function CartaoAvisos() {
  const { estado, ocupado, aviso, ativar, desativar } = useAvisosNoCelular();

  // Sem suporte ou sem chave no servidor: o cartão não promete o que não tem.
  if (estado === 'carregando' || estado === 'indisponivel') return null;

  const ativo = estado === 'ativo';

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
              ativo
                ? 'bg-positive-soft text-positive-soft-foreground'
                : 'bg-primary-soft text-primary-soft-foreground'
            }`}
          >
            {ativo ? (
              <BellRing className="h-5 w-5" strokeWidth={2} />
            ) : (
              <Bell className="h-5 w-5" strokeWidth={2} />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">Avisos no celular</p>
            <p className="text-xs text-muted-foreground">
              {estado === 'negado'
                ? 'Os avisos estão bloqueados nas configurações do navegador deste aparelho.'
                : ativo
                  ? 'Ligados neste aparelho: pedido chegando, aceite e faturamento apitam aqui.'
                  : 'Receba na hora: pedido chegando, aceite da fábrica e faturamento.'}
            </p>
            {aviso && <p className="mt-1 text-xs text-danger-soft-foreground">{aviso}</p>}
          </div>
        </div>

        {estado !== 'negado' &&
          (ativo ? (
            <Button
              size="md"
              variant="outline"
              className="shrink-0"
              disabled={ocupado}
              onClick={() => void desativar()}
            >
              <BellOff className="h-4 w-4" strokeWidth={2.5} />
              {ocupado ? 'Desligando…' : 'Desativar'}
            </Button>
          ) : (
            <Button size="md" className="shrink-0" disabled={ocupado} onClick={() => void ativar()}>
              <Bell className="h-4 w-4" strokeWidth={2.5} />
              {ocupado ? 'Ativando…' : 'Ativar avisos'}
            </Button>
          ))}
      </div>
    </div>
  );
}
