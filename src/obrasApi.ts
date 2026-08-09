import { supabase } from './supabase'

/** Una obra tal como la usa la app (las obras viven en Supabase, no en
 * IndexedDB, para que cada cuenta vea solo las suyas). */
export interface Obra {
  id: string
  nombre: string
  color: string
  imagenUrl: string | null
  /** Empresa dueña de la obra: se pide al crearla, y aparece automáticamente
   * en todos los PDF que se generen de esa obra. */
  empresa: string | null
  /** Datos de contacto de la empresa (dirección, teléfono, etc.), en texto
   * libre — aparecen junto al nombre y el logo en el encabezado del PDF. */
  empresaDatos: string | null
  logoUrl: string | null
  /** Quién creó la obra — solo esa persona puede editarla, borrarla y
   * agregar/quitar colaboradores (ver miembrosApi.ts). */
  creadoPor: string
  creadoEn: string
}

const COLUMNAS = 'id, nombre, color, imagen_url, empresa, empresa_datos, logo_url, creado_por, creado_en'

interface ObraFila {
  id: string
  nombre: string
  color: string
  imagen_url: string | null
  empresa: string | null
  empresa_datos: string | null
  logo_url: string | null
  creado_por: string
  creado_en: string
}

function mapObra(fila: ObraFila): Obra {
  return {
    id: fila.id,
    nombre: fila.nombre,
    color: fila.color,
    imagenUrl: fila.imagen_url,
    empresa: fila.empresa,
    empresaDatos: fila.empresa_datos,
    logoUrl: fila.logo_url,
    creadoPor: fila.creado_por,
    creadoEn: fila.creado_en,
  }
}

export async function listarObras(): Promise<Obra[]> {
  const { data, error } = await supabase.from('obras').select(COLUMNAS).order('creado_en', { ascending: true })
  if (error) throw error
  return (data ?? []).map(mapObra)
}

/** Sube una imagen (ícono de obra o logo de empresa) al bucket compartido y
 * devuelve su URL pública. `sufijo` distingue el archivo (p.ej. "icono" o
 * "logo") dentro de la carpeta del usuario. */
async function subirImagenObra(obraId: string, blob: Blob, sufijo: string): Promise<string> {
  const { data: sesion } = await supabase.auth.getUser()
  const userId = sesion.user?.id
  if (!userId) throw new Error('No hay sesión activa')

  const extension = blob.type.includes('png') ? 'png' : 'jpg'
  const ruta = `${userId}/${obraId}-${sufijo}.${extension}`

  const { error: errorSubida } = await supabase.storage
    .from('obra-iconos')
    .upload(ruta, blob, { upsert: true, contentType: blob.type || 'image/jpeg' })
  if (errorSubida) throw errorSubida

  const { data: urlPublica } = supabase.storage.from('obra-iconos').getPublicUrl(ruta)
  // Se agrega un parámetro para que el navegador no muestre en caché una
  // versión vieja al reemplazar la imagen de una obra existente.
  return `${urlPublica.publicUrl}?t=${Date.now()}`
}

export interface DatosObra {
  nombre: string
  color: string
  empresa: string
  empresaDatos: string
  imagenBlob?: Blob
  logoBlob?: Blob
  quitarImagen?: boolean
  quitarLogo?: boolean
}

export async function crearObra(datos: DatosObra): Promise<Obra> {
  const { data: sesion } = await supabase.auth.getUser()
  const userId = sesion.user?.id
  if (!userId) throw new Error('No hay sesión activa')

  const { data, error } = await supabase
    .from('obras')
    .insert({
      nombre: datos.nombre,
      color: datos.color,
      empresa: datos.empresa.trim() || null,
      empresa_datos: datos.empresaDatos.trim() || null,
      creado_por: userId,
    })
    .select(COLUMNAS)
    .single()
  if (error) throw error

  const patch: Record<string, unknown> = {}
  if (datos.imagenBlob) patch.imagen_url = await subirImagenObra(data.id, datos.imagenBlob, 'icono')
  if (datos.logoBlob) patch.logo_url = await subirImagenObra(data.id, datos.logoBlob, 'logo')

  if (Object.keys(patch).length === 0) return mapObra(data)

  const { data: actualizada, error: errorUpdate } = await supabase
    .from('obras')
    .update(patch)
    .eq('id', data.id)
    .select(COLUMNAS)
    .single()
  if (errorUpdate) throw errorUpdate
  return mapObra(actualizada)
}

export async function eliminarObra(id: string): Promise<void> {
  const { error } = await supabase.from('obras').delete().eq('id', id)
  if (error) throw error
}

export async function actualizarObra(id: string, datos: DatosObra): Promise<Obra> {
  const patch: Record<string, unknown> = {
    nombre: datos.nombre,
    color: datos.color,
    empresa: datos.empresa.trim() || null,
    empresa_datos: datos.empresaDatos.trim() || null,
  }
  if (datos.quitarImagen) patch.imagen_url = null
  if (datos.quitarLogo) patch.logo_url = null
  if (datos.imagenBlob) patch.imagen_url = await subirImagenObra(id, datos.imagenBlob, 'icono')
  if (datos.logoBlob) patch.logo_url = await subirImagenObra(id, datos.logoBlob, 'logo')

  const { data, error } = await supabase.from('obras').update(patch).eq('id', id).select(COLUMNAS).single()
  if (error) throw error
  return mapObra(data)
}
