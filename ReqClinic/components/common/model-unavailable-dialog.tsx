'use client';

import { PRODUCT_TERMS } from '@/lib/product-language';

interface ModelUnavailableDialogProps {
  open: boolean;
  title: string;
  description: string;
  onDismiss: () => void;
  dismissLabel?: string;
}

export function ModelUnavailableDialog({
  open,
  title,
  description,
  onDismiss,
  dismissLabel = '知道了',
}: ModelUnavailableDialogProps) {
  if (!open) return null;

  return (
    <div className="model-key-modal" role="dialog" aria-modal="true" aria-labelledby="model-unavailable-title">
      <div className="model-key-panel">
        <div className="model-key-kicker">{PRODUCT_TERMS.modelUnavailableKicker}</div>
        <h2 id="model-unavailable-title">{title}</h2>
        <p>{description}</p>
        <div className="model-key-actions">
          <button type="button" className="model-key-primary" onClick={onDismiss} autoFocus>
            {dismissLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
