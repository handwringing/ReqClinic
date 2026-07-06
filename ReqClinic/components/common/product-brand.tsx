import { PRODUCT_BRAND } from '@/lib/product-language';

export function ProductBrandText() {
  return (
    <span className="brand-lockup">
      <span className="brand-lockup__zh">{PRODUCT_BRAND.zh}</span>
      <span className="brand-lockup__slash">/</span>
      <span className="brand-lockup__en">{PRODUCT_BRAND.en}</span>
    </span>
  );
}
