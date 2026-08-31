import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Button } from './Button.js';
import type { ApiResponse } from '@csb/shared';

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
 */

/** A chave pública VAPID vem em base64url; o navegador quer bytes. */
function chaveParaBytes(base64: string): Uint8Array {
  const preenchida = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(preenchida.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

type Estado = 'carregando' | 'indisponivel' | 'inativo' | 'ativo' | 'negado';

export function CartaoAvisos() {
  const { token } = useAuthStore();
  const [estado, setEstado] = useState<Estado>('carregando');
  const [chave, setChave] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const suporte =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  useEffect(() => {
    let vivo = true;
    const descobrir = async () => {
      if (!suporte || !token) {
        if (vivo) setEstado('indisponivel');
        return;
      }
      try {
        const res = await api.get<ApiResponse<{ chave: string | null }>>(
          '/push/chave-publica',
          token,
        );
        if (!vivo) return;
        if (!res.data.chave) {
          setEstado('indisponivel');
          return;
        }
        setChave(res.data.chave);
        if (Notification.permission === 'denied') {
          setEstado('negado');
          return;
        }
        const reg = await navigator.serviceWorker.getRegistration();
        const assinatura = await reg?.pushManager.getSubscription();
        if (vivo) setEstado(assinatura ? 'ativo' : 'inativo');
      } catch {
        if (vivo) setEstado('indisponivel');
      }
    };
    void descobrir();
    return () => {
      vivo = false;
    };
  }, [suporte, token]);

  const ativar = async () => {
    if (!token || !chave || ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') {
        setEstado(permissao === 'denied' ? 'negado' : 'inativo');
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error('O app ainda está terminando de instalar — tente de novo.');
      const assinatura = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chaveParaBytes(chave) as BufferSource,
      });
      const json = assinatura.toJSON();
      await api.post<ApiResponse<{ ok: boolean }>>(
        '/push/assinar',
        { endpoint: assinatura.endpoint, keys: json.keys },
        token,
      );
      setEstado('ativo');
      // O teste sai na hora: a primeira notificação É a prova de que funciona.
      await api.post<ApiResponse<{ entregues: number }>>('/push/teste', {}, token);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Não deu para ativar agora.');
    } finally {
      setOcupado(false);
    }
  };

  const desativar = async () => {
    if (!token || ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const assinatura = await reg?.pushManager.getSubscription();
      if (assinatura) {
        await api.post<ApiResponse<{ ok: boolean }>>(
          '/push/desassinar',
          { endpoint: assinatura.endpoint },
          token,
        );
        await assinatura.unsubscribe();
      }
      setEstado('inativo');
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Não deu para desativar agora.');
    } finally {
      setOcupado(false);
    }
  };

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
