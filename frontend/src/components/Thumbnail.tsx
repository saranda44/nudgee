/**
 * Miniatura `hqdefault` recortada al centro (object-fit: cover, 4:5) para quitar las franjas
 * de los Shorts. Mientras carga o si falla: fondo cat-*-soft con el ícono (lo da el CSS).
 */

import { useState } from "react";
import type { Icon } from "@phosphor-icons/react";

interface Props {
  src: string | null;
  icon: Icon;
  iconSize?: number;
}

export function Thumbnail({ src, icon: IconCmp, iconSize = 28 }: Props) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <IconCmp size={iconSize} weight="bold" aria-hidden />;
  return <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
