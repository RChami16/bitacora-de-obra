import { supabase } from './supabase'

/** Alguien (aparte de quien creó la obra) con acceso para ver la obra y
 * agregar notas/observaciones. */
export interface Miembro {
  userId: string
  email: string
  agregadoEn: string
}

export async function listarMiembros(obraId: string): Promise<Miembro[]> {
  const { data, error } = await supabase
    .from('obra_members')
    .select('user_id, email, agregado_en')
    .eq('obra_id', obraId)
    .order('agregado_en', { ascending: true })
  if (error) throw error
  return (data ?? []).map((f) => ({ userId: f.user_id, email: f.email, agregadoEn: f.agregado_en }))
}

/** Agrega a una persona por su correo. Esa persona debe ya tener una cuenta
 * creada en la app con ese correo (no se manda ninguna invitación, se busca
 * si ya existe). */
export async function invitarMiembro(obraId: string, correo: string): Promise<void> {
  const correoLimpio = correo.trim().toLowerCase()
  if (!correoLimpio) throw new Error('Escribe un correo.')

  const { data: userId, error: errorBusqueda } = await supabase.rpc('buscar_usuario_id_por_email', {
    p_email: correoLimpio,
  })
  if (errorBusqueda) throw errorBusqueda
  if (!userId) {
    throw new Error('Esa persona todavía no tiene cuenta en la app. Pídele que se registre primero con ese correo y vuelve a intentarlo.')
  }

  const { error: errorInsertar } = await supabase
    .from('obra_members')
    .insert({ obra_id: obraId, user_id: userId, email: correoLimpio })
  if (errorInsertar) {
    if (errorInsertar.code === '23505') throw new Error('Esa persona ya tiene acceso a esta obra.')
    throw errorInsertar
  }
}

export async function quitarMiembro(obraId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('obra_members').delete().eq('obra_id', obraId).eq('user_id', userId)
  if (error) throw error
}
