/** Size · colour label for a product variant */
export function variantLabel(size?: string | null, color?: string | null): string {
  return [size, color].filter(Boolean).join(' · ');
}

/** Product name with optional size/colour suffix */
export function productDisplayName(
  name: string,
  size?: string | null,
  color?: string | null,
): string {
  const label = variantLabel(size, color);
  return label ? `${name} · ${label}` : name;
}
