import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface AdminModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}

export function AdminModal({ title, onClose, children, footer, maxWidth = 520 }: AdminModalProps) {
  return (
    <div className="modal-backdrop" style={{ zIndex: 11000 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog" style={{ maxWidth }}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
