/** Set de íconos de línea, minimalistas y de un solo color (heredan el
 * color del texto vía `currentColor`) — se usan en vez de emojis para que
 * la app se vea más cuidada/profesional en vez de "hecha con IA". */

interface IconProps {
  size?: number
  className?: string
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconEditar({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M13.5 3.5l3 3L6 17l-4 1 1-4L13.5 3.5z" />
    </svg>
  )
}

export function IconEliminar({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M4 6h12M8 6V4.5h4V6M5.5 6l.7 10a1.5 1.5 0 001.5 1.4h4.6a1.5 1.5 0 001.5-1.4l.7-10" />
      <path d="M8.5 9v5M11.5 9v5" />
    </svg>
  )
}

export function IconSalir({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M8 17H4.5A1.5 1.5 0 013 15.5v-11A1.5 1.5 0 014.5 3H8" />
      <path d="M13 14l4-4-4-4M17 10H7.5" />
    </svg>
  )
}

export function IconAdvertencia({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M10 3.2L18 16.5H2L10 3.2z" strokeLinejoin="round" />
      <path d="M10 8.3v3.6" />
      <circle cx="10" cy="14" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Nube con flecha hacia arriba: entrada guardada localmente, esperando
 * subir a la nube. */
export function IconSubiendo({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M6 14.5a3 3 0 01-.5-5.96A4 4 0 0113.9 7.2 3.2 3.2 0 0113.5 14.5H6z" />
      <path d="M10 12V8m0 0l-1.8 1.8M10 8l1.8 1.8" />
    </svg>
  )
}

export function IconUsuario({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <circle cx="10" cy="6.5" r="3" />
      <path d="M3.5 17c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" />
    </svg>
  )
}

export function IconDocumento({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M5.5 2.5h6l3 3v12h-9v-15z" strokeLinejoin="round" />
      <path d="M11.5 2.5v3h3M7.5 10h5M7.5 13h5" />
    </svg>
  )
}

export function IconCerrar({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M4.5 4.5l11 11M15.5 4.5l-11 11" />
    </svg>
  )
}

export function IconEdificio({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M4 17.5V4.8L10 2.5l6 2.3v12.7" strokeLinejoin="round" />
      <path d="M2.5 17.5h15M7.3 6.5h1.2M11.5 6.5h1.2M7.3 9.7h1.2M11.5 9.7h1.2M7.3 12.9h1.2M11.5 12.9h1.2M8.6 17.5v-3.2h2.8v3.2" />
    </svg>
  )
}

export function IconDiario({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M4 3.5h9.5a1.5 1.5 0 011.5 1.5v11.5H5.5A1.5 1.5 0 014 15V3.5z" strokeLinejoin="round" />
      <path d="M4 15a1.5 1.5 0 011.5-1.5H15" />
      <path d="M7 7h5.5M7 9.7h5.5" />
    </svg>
  )
}

export function IconOjo({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.3" />
    </svg>
  )
}

export function IconCarpeta({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path
        d="M2.5 5.8A1.3 1.3 0 013.8 4.5h3.3l1.5 1.8H16a1.3 1.3 0 011.3 1.3v7A1.3 1.3 0 0116 16H3.8a1.3 1.3 0 01-1.3-1.3v-8.9z"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconFlechaIzquierda({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M12.5 4.5l-6 5.5 6 5.5" />
    </svg>
  )
}

export function IconFlechaDerecha({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M7.5 4.5l6 5.5-6 5.5" />
    </svg>
  )
}

export function IconMas({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M10 4v12M4 10h12" />
    </svg>
  )
}
