import { supabase } from './supabase'
import type { TipoEntrada } from './db'

/** Nombres de semana personalizados (el equipo puede renombrar "04/08/25 –
 * 10/08/25" por algo como "Semana de cimentación"). Viven en Supabase para
 * que el cambio lo vea todo el equipo, no solo quien lo hizo. */

export async function listarNombresSemana(obraId: string, tipo: TipoEntrada): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('semanas_nombre')
    .select('semana_inicio, nombre')
    .eq('obra_id', obraId)
    .eq('tipo', tipo)
  if (error) throw error
  const mapa: Record<string, string> = {}
  for (const fila of data ?? []) mapa[fila.semana_inicio] = fila.nombre
  return mapa
}

/** `semanaInicio` es la fecha (lunes) de esa semana, en formato "YYYY-MM-DD". */
export async function renombrarSemana(
  obraId: string,
  tipo: TipoEntrada,
  semanaInicio: string,
  nombre: string,
): Promise<void> {
  const { error } = await supabase
    .from('semanas_nombre')
    .upsert(
      { obra_id: obraId, tipo, semana_inicio: semanaInicio, nombre: nombre.trim() },
      { onConflict: 'obra_id,tipo,semana_inicio' },
    )
  if (error) throw error
}
