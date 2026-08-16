import { supabase } from './supabase'
import type { CategoriaTrabajo } from './db'

/** Cuántas personas de un tipo de trabajo hay hoy en una obra. */
export interface PersonalFila {
  categoria: CategoriaTrabajo
  /** Solo tiene valor cuando `categoria` es 'otro'. */
  otroDetalle: string | null
  cantidad: number
}

/** Igual que `PersonalFila`, pero para Modo supervisión, que junta el
 * personal de varias obras a la vez. */
export interface PersonalConObra extends PersonalFila {
  obraId: string
  obraNombre: string
}

interface PersonalFilaCruda {
  obra_id: string
  categoria: CategoriaTrabajo
  otro_detalle: string | null
  cantidad: number
  obras: { nombre: string } | null
}

/** La fecha de hoy en hora LOCAL (no UTC) como "YYYY-MM-DD" — el personal
 * en obra es "de hoy", sin importar la zona horaria del servidor. */
function fechaHoyIso(): string {
  const hoy = new Date()
  const y = hoy.getFullYear()
  const m = String(hoy.getMonth() + 1).padStart(2, '0')
  const d = String(hoy.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** El personal reportado hoy en una obra (puede venir vacío si nadie lo ha
 * llenado todavía). */
export async function obtenerPersonalHoy(obraId: string): Promise<PersonalFila[]> {
  const { data, error } = await supabase
    .from('personal_obra')
    .select('categoria, otro_detalle, cantidad')
    .eq('obra_id', obraId)
    .eq('fecha', fechaHoyIso())
  if (error) throw error
  return (data ?? []).map((f) => ({ categoria: f.categoria, otroDetalle: f.otro_detalle, cantidad: f.cantidad }))
}

/** Guarda de una vez el personal de hoy de una obra (una fila por tipo de
 * trabajo). Vuelve a llamar esto actualiza lo de hoy en vez de duplicarlo. */
export async function guardarPersonalObra(
  obraId: string,
  filas: { categoria: CategoriaTrabajo; cantidad: number; otroDetalle: string }[],
): Promise<void> {
  const { data: sesion } = await supabase.auth.getUser()
  const registros = filas.map((f) => ({
    obra_id: obraId,
    fecha: fechaHoyIso(),
    categoria: f.categoria,
    otro_detalle: f.categoria === 'otro' ? f.otroDetalle.trim() || null : null,
    cantidad: f.cantidad,
    actualizado_por: sesion.user?.id ?? null,
    actualizado_en: new Date().toISOString(),
  }))
  const { error } = await supabase.from('personal_obra').upsert(registros, { onConflict: 'obra_id,fecha,categoria' })
  if (error) throw error
}

/** Para Modo supervisión: el personal de hoy de todas las obras a las que
 * se tiene acceso (o de una sola, si se pasa `obraId`). Solo trae renglones
 * con gente de verdad (cantidad > 0), para no llenar la pantalla de ceros. */
export async function listarPersonalHoySupervision(obraId?: string): Promise<PersonalConObra[]> {
  let query = supabase
    .from('personal_obra')
    .select('obra_id, categoria, otro_detalle, cantidad, obras(nombre)')
    .eq('fecha', fechaHoyIso())
    .gt('cantidad', 0)
  if (obraId) query = query.eq('obra_id', obraId)

  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as unknown as PersonalFilaCruda[]).map((f) => ({
    obraId: f.obra_id,
    obraNombre: f.obras?.nombre ?? 'Obra',
    categoria: f.categoria,
    otroDetalle: f.otro_detalle,
    cantidad: f.cantidad,
  }))
}
