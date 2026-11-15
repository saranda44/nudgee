/**
 * Sheet modal sobre <dialog> nativo (foco atrapado, Esc). Para O-01, O-02 y O-03.
 * Controlado: `open` lo abre/cierra; tocar el velo o Esc llama a `onClose`.
 */

import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Insignia opcional arriba del título (p. ej. para confirmar una acción destructiva). */
  icon?: ReactNode;
}

export function Dialog({ open, title, onClose, children, icon }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="app-sheet-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {open && (
        <div className="ng-sheet">
          <div className="ng-sheet__handle" aria-hidden />
          {icon}
          <h2 className="ng-sheet__title" id={titleId}>
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
