import { useEffect, useState } from 'react';
import { Wifi } from 'lucide-react';

interface ReconnectBannerProps {
  title: string;
  detail?: string | undefined;
  onDone: () => void;
}

// Card que desce do topo quando o app volta a ficar online, confirmando a
// reconexão e (quando há) os pedidos que foram sincronizados.
export function ReconnectBanner({ title, detail, onDone }: ReconnectBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const enter = requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDone, 300);
    }, 5000);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(timer);
    };
  }, [onDone]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 safe-top">
      <div
        className={`mt-3 flex max-w-sm items-center gap-3 rounded-xl bg-positive px-4 py-3 text-white shadow-lg transition-all duration-300 ${
          visible ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0'
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
          <Wifi className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{title}</p>
          {detail && <p className="text-xs leading-tight text-white/90">{detail}</p>}
        </div>
      </div>
    </div>
  );
}
