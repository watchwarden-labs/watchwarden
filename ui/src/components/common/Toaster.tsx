import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';

const glowMap = {
  success: 'border-success shadow-glow-success',
  error: 'border-destructive shadow-glow-error',
  info: 'border-primary shadow-glow-accent',
};

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`bg-card border rounded-lg px-4 py-3 flex items-start gap-3 animate-[slideIn_0.2s_ease-out] ${glowMap[toast.type]}`}
        >
          <p className="text-sm text-foreground flex-1">{toast.message}</p>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            onClick={() => removeToast(toast.id)}
            aria-label="Dismiss"
          >
            <X size={14} />
          </Button>
        </div>
      ))}
    </div>
  );
}
