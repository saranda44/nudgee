/**
 * Toast (sistema de diseño): uno a la vez, 4 s; con acción ("Deshacer", "Ver") dura 6 s.
 * role="status" para lectores de pantalla. No se usa para errores de formulario.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ToastSpec {
  message: string;
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<(toast: ToastSpec) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastSpec & { id: number }) | null>(null);
  const nextId = useRef(0);

  const show = useCallback((spec: ToastSpec) => setToast({ ...spec, id: ++nextId.current }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.action ? 6000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="app-toast" role="status" aria-live="polite">
        {toast && (
          <div className="ng-toast" key={toast.id}>
            <span className="ng-toast__msg">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="ng-toast__action"
                onClick={() => {
                  toast.action!.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
