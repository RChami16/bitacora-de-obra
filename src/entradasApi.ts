import { supabase } from './supabase'
import type { EstadoObservacion, TipoEntrada } from './db'

/** Una nota u observación tal como vive en Supabase, visible para todo el
 * equipo que tenga acceso a la obra (ver miembrosApi.ts). */
export interface EntradaRemota {
  id: string
  obraId: string
  tipo: TipoEntrada
  autorEmail: string | null
  fecha: string
  texto: string | null
  estado: EstadoObservacion | null
  fotos: string[] // rutas dentro del bucket privado "entradas-fotos"
  creadoEn: string
  atendidoEn: string | null
}

const COLUMNAS = 'id, obra_id, tipo, autor_email, fecha, texto, estado, fotos, creado_en, atendido_en'

interface EntradaFila {
  id: string
  obra_id: string
  tipo: TipoEntrada
  autor_email: string | null
  fecha: string
  texto: string | null
  estado: EstadoObservacion | null
  fotos: string[] | null
  creado_en: string
  atendido_en: string | null
}

function mapEntrada(fila: EntradaFila): EntradaRemota {
  return {
    id: fila.id,
    obraId: fila.obra_id,
    tipo: fila.tipo,
    autorEmail: fila.autor_email,
    fecha: fila.fecha,
    texto: fila.texto,
    estado: fila.estado,
    fotos: fila.fotos ?? [],
    creadoEn: fila.creado_en,
    atendidoEn: fila.atendido_en,
  }
}

export async function listarEntradas(obraId: string, tipo: TipoEntrada): Promise<EntradaRemota[]> {
  const { data, error } = await supabase
    .from('entradas')
    .select(COLUMNAS)
    .eq('obra_id', obraId)
    .eq('tipo', tipo)
    .order('fecha', { ascending: false })
  if (error) throw error
  return (data ?? []).map(mapEntrada)
}

/** Una entrada con los datos de su obra ya incluidos — para el "Modo
 * supervisión", que junta lo más reciente de TODAS las obras a las que se
 * tiene acceso en un solo lugar. */
export interface EntradaConObra extends EntradaRemota {
  obraNombre: string
  obraColor: string
  obraImagenUrl: string | null
}

interface EntradaFilaConObra extends EntradaFila {
  obras: { nombre: string; color: string; imagen_url: string | null } | null
}

/** Medianoche de ayer, en hora local — para el "Modo supervisión": las
 * notas de hoy y ayer se consideran "recientes"; las de antes ya no. */
function inicioDeAyer(): Date {
  const hoy = new Date()
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const ayer = new Date(inicioHoy)
  ayer.setDate(ayer.getDate() - 1)
  return ayer
}

/** Para el "Modo supervisión": junta dos cosas bien distintas en una sola
 * consulta —
 *  - las NOTAS de hoy y ayer (el avance reciente), y
 *  - las OBSERVACIONES que todavía no se atienden, sin importar cuándo se
 *    crearon (siguen siendo pendientes hasta que alguien las resuelva).
 * Si se pasa `obraId` se limita a esa obra; si no, junta las de todas las
 * obras a las que se tiene acceso (RLS se encarga de filtrar eso solo). */
export async function listarEntradasSupervision(obraId?: string): Promise<EntradaConObra[]> {
  const desde = inicioDeAyer().toISOString()
  let query = supabase
    .from('entradas')
    .select(`${COLUMNAS}, obras(nombre, color, imagen_url)`)
    .or(`and(tipo.eq.nota,fecha.gte.${desde}),and(tipo.eq.observacion,estado.in.(por_atender,en_proceso))`)
    .order('fecha', { ascending: false })
  if (obraId) query = query.eq('obra_id', obraId)

  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as unknown as EntradaFilaConObra[]).map((fila) => ({
    ...mapEntrada(fila),
    obraNombre: fila.obras?.nombre ?? 'Obra',
    obraColor: fila.obras?.color ?? '#e67e22',
    obraImagenUrl: fila.obras?.imagen_url ?? null,
  }))
}

async function subirFotoEntrada(obraId: string, entradaId: string, blob: Blob, indice: number): Promise<string> {
  const extension = blob.type.includes('png') ? 'png' : 'jpg'
  const ruta = `${obraId}/${entradaId}-${indice}.${extension}`
  const { error } = await supabase.storage
    .from('entradas-fotos')
    .upload(ruta, blob, { upsert: true, contentType: blob.type || 'image/jpeg' })
  if (error) throw error
  return ruta
}

export interface DatosEntrada {
  obraId: string
  tipo: TipoEntrada
  /** ISO datetime local, p.ej. "2026-03-14T09:30". */
  fecha: string
  texto?: string
  fotos: Blob[]
  /** Solo aplica a observaciones; por defecto "por_atender". */
  estado?: EstadoObservacion
}

/** Crea el renglón sin fotos todavía. Separado de `crearEntrada` para poder
 * reintentar solo la parte de las fotos si esa es la que falla, en vez de
 * insertar un renglón duplicado cada vez que se reintenta (ver
 * `crearEntrada` más abajo). */
export async function crearEntradaBase(
  datos: Omit<DatosEntrada, 'fotos'>,
): Promise<EntradaRemota> {
  const { data: sesion } = await supabase.auth.getUser()
  const userId = sesion.user?.id
  if (!userId) throw new Error('No hay sesión activa')

  const { data, error } = await supabase
    .from('entradas')
    .insert({
      obra_id: datos.obraId,
      autor: userId,
      autor_email: sesion.user?.email ?? null,
      tipo: datos.tipo,
      fecha: new Date(datos.fecha).toISOString(),
      texto: datos.texto?.trim() || null,
      estado: datos.tipo === 'observacion' ? (datos.estado ?? 'por_atender') : null,
    })
    .select(COLUMNAS)
    .single()
  if (error) throw error
  return mapEntrada(data)
}

/** Sube las fotos de un renglón que ya existe y actualiza su columna
 * `fotos`. Se puede volver a llamar tranquilamente si la vez anterior
 * falló a medias — `upload` usa `upsert`, así que sube lo que falte sin
 * duplicar archivos. */
export async function subirFotosDeEntrada(obraId: string, entradaId: string, fotos: Blob[]): Promise<string[]> {
  const rutas = await Promise.all(fotos.map((foto, i) => subirFotoEntrada(obraId, entradaId, foto, i)))
  const { error } = await supabase.from('entradas').update({ fotos: rutas }).eq('id', entradaId)
  if (error) throw error
  return rutas
}

/** Crea una nota/observación completa (renglón + fotos) de una sola vez.
 * `onIdCreado` se llama en cuanto el renglón existe en Supabase, aunque las
 * fotos fallen después — así quien llama puede recordar ese id y, si hay
 * que reintentar, usar `crearEntradaBase`/`subirFotosDeEntrada` por separado
 * en vez de volver a insertar todo (lo que crearía un renglón repetido). */
export async function crearEntrada(
  datos: DatosEntrada,
  onIdCreado?: (id: string) => void | Promise<void>,
): Promise<EntradaRemota> {
  const base = await crearEntradaBase(datos)
  if (onIdCreado) await onIdCreado(base.id)
  if (datos.fotos.length === 0) return base
  const rutas = await subirFotosDeEntrada(datos.obraId, base.id, datos.fotos)
  return { ...base, fotos: rutas }
}

/** Cambia el estatus de una observación (la puede cambiar cualquiera con
 * acceso a la obra, no solo quien la creó). */
export async function actualizarEstadoObservacion(id: string, estado: EstadoObservacion): Promise<void> {
  const { error } = await supabase
    .from('entradas')
    .update({ estado, atendido_en: estado === 'atendido' ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw error
}

export async function eliminarEntrada(id: string): Promise<void> {
  const { error } = await supabase.from('entradas').delete().eq('id', id)
  if (error) throw error
}

/** Descarga una foto del bucket privado de entradas. Devuelve null si no
 * hay conexión o no se pudo leer (se cachea aparte para no repetir). */
export async function descargarFotoEntrada(ruta: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from('entradas-fotos').download(ruta)
  if (error) return null
  return data
}
