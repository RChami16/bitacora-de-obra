/**
 * Pide al backend (función serverless en Vercel, ver /api/resumen.ts) que
 * redacte un resumen narrativo del periodo a partir de las notas sueltas.
 *
 * Se degrada a `null` sin lanzar error si: no hay conexión, el endpoint no
 * existe todavía, o el servidor no tiene configurada la API key de
 * Anthropic — en cualquiera de esos casos el PDF se genera igual, solo sin
 * la sección de resumen.
 */
export async function obtenerResumenIA(
  obraNombre: string,
  periodoLabel: string,
  entradas: { fecha: string; nota?: string }[],
): Promise<string | null> {
  if (entradas.length === 0) return null
  try {
    const resp = await fetch('/api/resumen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ obraNombre, periodoLabel, entradas }),
    })
    if (!resp.ok) return null
    const data = await resp.json()
    return typeof data.resumen === 'string' && data.resumen.trim() ? data.resumen : null
  } catch {
    return null
  }
}
