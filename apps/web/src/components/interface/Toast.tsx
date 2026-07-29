import { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onDone: () => void;
}

export function Toast({ message, type = 'info', onDone }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(onDone, 300);
    }, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  const colorClass =
    type === 'success'
      ? 'bg-positive'
      : type === 'error'
        ? 'bg-danger'
        : 'bg-gray-800';

  return (
    <div
      className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-white text-sm shadow-lg transition-opacity duration-300 ${colorClass} ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {message}
    </div>
  );
}
