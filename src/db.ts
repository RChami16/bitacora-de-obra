import Dexie, { type Table } from 'dexie'

/**
 * Esquema local (IndexedDB) de la bitácora.
 *
 * Las OBRAS viven en Supabase (ver obrasApi.ts). Desde que varias personas
 * pueden compartir una misma obra, las ENTRADAS (notas y observaciones,
 * ver entradasApi.ts) también viven en Supabase — así todo el equipo ve lo
 * mismo, no solo lo que se guardó en un celular.
 *
 * Para no perder el "funciona sin señal" que tenía la app, aquí se guardan
 * dos cosas nada más:
 *  - `entradasCola`: lo que se creó sin conexión y todavía no se sube.
 *  - `entradasCache`: la última copia que sí se descargó de Supabase, para
 *    poder seguir viendo la bitácora aunque se pierda la señal después.
 *  - `fotosCache`: fotos ya descargadas una vez, para no volver a bajarlas.
 */

export type TipoEntrada = 'nota' | 'observacion'
export type EstadoObservacion = 'por_atender' | 'en_proceso' | 'atendido'

/** Una foto guardada como ArrayBuffer en vez de Blob. Varios navegadores
 * (sobre todo Safari/iOS) tienen bugs conocidos donde un Blob guardado en
 * IndexedDB "sobrevive" al cerrarse pero vuelve vacío (0 bytes) al leerlo
 * más tarde — el ArrayBuffer no tiene ese problema. Se reconstruye el Blob
 * (con `almacenadasABlobs`) solo al momento de usarlo. */
export interface FotoAlmacenada {
  data: ArrayBuffer
  type: string
}

export async function blobsAAlmacenar(blobs: Blob[]): Promise<FotoAlmacenada[]> {
  return Promise.all(blobs.map(async (b) => ({ data: await b.arrayBuffer(), type: b.type || 'image/jpeg' })))
}

export function almacenadasABlobs(fotos: FotoAlmacenada[]): Blob[] {
  return fotos
    .map((f) => {
      // Defensivo: si quedó algo guardado con la forma vieja (Blob directo,
      // de antes de este cambio), se descarta en vez de tronar la app.
      if (!f || !(f.data instanceof ArrayBuffer)) return null
      return new Blob([f.data], { type: f.type })
    })
    .filter((b): b is Blob => b !== null)
}

/** Una nota/observación creada en este dispositivo, pendiente de subir. */
export interface EntradaCola {
  id?: number
  obraId: string
  tipo: TipoEntrada
  fecha: string // ISO datetime local, p.ej. "2026-03-14T09:30"
  texto?: string
  fotos: FotoAlmacenada[]
  /** Solo aplica a observaciones. */
  estado?: EstadoObservacion
  creadoEn: string
  /** Mensaje del último intento fallido de subida que NO fue por falta de
   * señal (p.ej. un permiso mal configurado) — si sigue sin señal simplemente
   * no se llena, para no alarmar de más. Sirve para avisar en la app que algo
   * necesita atención en vez de reintentar en silencio para siempre. */
  ultimoError?: string
  /** Si ya se alcanzó a crear el renglón en Supabase (pero fallaron las
   * fotos), aquí queda su id — así un reintento solo termina de subir las
   * fotos en vez de insertar el renglón otra vez y duplicarlo. */
  remotaIdParcial?: string
}

/** Copia local (sin fotos) de una entrada ya guardada en Supabase, para
 * poder mostrar la bitácora incluso sin conexión. */
export interface EntradaCache {
  id: string // uuid de Supabase
  obraId: string
  tipo: TipoEntrada
  autorEmail: string | null
  fecha: string
  texto: string | null
  estado: EstadoObservacion | null
  fotos: string[] // rutas dentro del bucket entradas-fotos
  creadoEn: string
  atendidoEn: string | null
}

export interface FotoCache {
  ruta: string
  blob: Blob
}

/** @deprecated forma vieja de una entrada (solo local, un dispositivo). Se
 * mantiene para poder migrar los datos de instalaciones previas. */
interface EntradaVieja {
  id?: number
  obraId: string
  fecha: string
  nota?: string
  fotos?: Blob[]
  fotoBlob?: Blob
  audioBlob?: Blob
  creadoEn: string
  estado: 'pendiente' | 'sincronizado'
}

class BitacoraDB extends Dexie {
  entradasCola!: Table<EntradaCola, number>
  entradasCache!: Table<EntradaCache, string>
  fotosCache!: Table<FotoCache, string>

  constructor() {
    super('bitacora-de-obra')
    this.version(1).stores({
      entradas: '++id, obraId, fecha, estado',
    })
    // v2: soporte multiobra local (versión previa al login; se mantiene
    // por compatibilidad con instalaciones ya hechas, aunque las obras ya
    // no se guarden en esta tabla).
    this.version(2).stores({
      obras: '++id, nombre',
      entradas: '++id, obraId, fecha, estado',
    })
    // v3: las obras se mudan a Supabase; `obraId` en entradas pasa a ser el
    // uuid de la obra en vez del id numérico local.
    this.version(3).stores({
      obras: null,
      entradas: '++id, obraId, fecha, estado',
    })
    // v4: las entradas (notas y observaciones) se mudan a Supabase para
    // poder compartirse entre todo el equipo de la obra. La tabla local
    // vieja se reemplaza por una cola de subida + una caché de lectura.
    // Las notas que hubiera sin subir de instalaciones previas se pasan a
    // la cola de subida en vez de perderse.
    this.version(4)
      .stores({
        entradas: null,
        entradasCola: '++id, obraId, tipo',
        entradasCache: 'id, obraId, tipo, fecha',
        fotosCache: 'ruta',
      })
      .upgrade(async (tx) => {
        const viejas: EntradaVieja[] = await tx.table('entradas').toArray()
        for (const vieja of viejas) {
          const fotosBlobs = vieja.fotos && vieja.fotos.length > 0 ? vieja.fotos : vieja.fotoBlob ? [vieja.fotoBlob] : []
          const nueva: EntradaCola = {
            obraId: vieja.obraId,
            tipo: 'nota',
            fecha: vieja.fecha,
            texto: vieja.nota,
            fotos: await blobsAAlmacenar(fotosBlobs),
            creadoEn: vieja.creadoEn,
          }
          await tx.table('entradasCola').add(nueva)
        }
      })
  }
}

export const db = new BitacoraDB()
