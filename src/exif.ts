/**
 * Lector mínimo de la fecha EXIF (DateTimeOriginal) de una foto JPEG.
 *
 * Se implementa a mano en vez de agregar una librería solo para esto: basta
 * con leer los primeros bytes del archivo (donde vive la metadata EXIF) y
 * recorrer la estructura TIFF/IFD hasta encontrar el tag de fecha.
 *
 * Si la foto no trae EXIF (PNG, captura de pantalla, HEIC sin convertir,
 * metadata borrada por la app de mensajería, etc.) simplemente devuelve
 * `null` y quien llama debe dejar que el usuario ponga la fecha a mano.
 */
export async function leerFechaExif(file: Blob): Promise<Date | null> {
  try {
    // La metadata EXIF siempre vive cerca del inicio del archivo.
    const buf = await file.slice(0, 128 * 1024).arrayBuffer()
    const view = new DataView(buf)
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
      return null // no es un JPEG
    }

    let offset = 2
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break
      const marker = view.getUint8(offset + 1)
      const segLength = view.getUint16(offset + 2, false)

      if (marker === 0xe1) {
        const segStart = offset + 4
        if (readAscii(view, segStart, 4) === 'Exif') {
          const tiffStart = segStart + 6
          const fecha = parseTiff(view, tiffStart)
          if (fecha) return fecha
        }
      }
      if (marker === 0xda) break // Start of Scan: no hay más metadata después
      offset += 2 + segLength
    }
  } catch {
    // Formato inesperado — se ignora, el usuario ajusta la fecha manualmente.
  }
  return null
}

function readAscii(view: DataView, offset: number, length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

function parseTiff(view: DataView, tiffStart: number): Date | null {
  if (tiffStart + 8 > view.byteLength) return null
  const byteOrderMark = readAscii(view, tiffStart, 2)
  const little = byteOrderMark === 'II'
  if (!little && byteOrderMark !== 'MM') return null

  const ifd0Offset = view.getUint32(tiffStart + 4, little)
  const ifd0 = readIfd(view, tiffStart, tiffStart + ifd0Offset, little)

  // Tag 0x8769: puntero al Exif SubIFD, donde vive DateTimeOriginal (0x9003).
  const exifIfdPointer = ifd0.get(0x8769)
  if (typeof exifIfdPointer === 'number') {
    const exifIfd = readIfd(view, tiffStart, tiffStart + exifIfdPointer, little)
    const dt = exifIfd.get(0x9003) ?? exifIfd.get(0x9004) // Original o Digitized
    if (typeof dt === 'string') {
      const parsed = parseExifDate(dt)
      if (parsed) return parsed
    }
  }

  // Fallback: tag 0x0132 (DateTime de modificación) directo en IFD0.
  const dt0 = ifd0.get(0x0132)
  if (typeof dt0 === 'string') return parseExifDate(dt0)

  return null
}

type IfdValue = string | number

function readIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  little: boolean,
): Map<number, IfdValue> {
  const result = new Map<number, IfdValue>()
  if (ifdOffset < 0 || ifdOffset + 2 > view.byteLength) return result

  const count = view.getUint16(ifdOffset, little)
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdOffset + 2 + i * 12
    if (entryOffset + 12 > view.byteLength) break

    const tag = view.getUint16(entryOffset, little)
    const type = view.getUint16(entryOffset + 2, little)
    const numValues = view.getUint32(entryOffset + 4, little)

    if (type === 2) {
      // ASCII: si el string mide más de 4 bytes, el campo guarda un offset.
      const byteLength = numValues
      const valueOffset =
        byteLength > 4 ? tiffStart + view.getUint32(entryOffset + 8, little) : entryOffset + 8
      if (valueOffset >= 0 && valueOffset + byteLength <= view.byteLength) {
        const str = readAscii(view, valueOffset, byteLength).replace(/\0+$/, '')
        result.set(tag, str)
      }
    } else if (type === 3) {
      result.set(tag, view.getUint16(entryOffset + 8, little)) // SHORT
    } else if (type === 4) {
      result.set(tag, view.getUint32(entryOffset + 8, little)) // LONG
    }
    // Otros tipos (RATIONAL, etc.) no hacen falta para leer la fecha.
  }
  return result
}

function parseExifDate(raw: string): Date | null {
  // Formato EXIF estándar: "YYYY:MM:DD HH:MM:SS"
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  return Number.isNaN(date.getTime()) ? null : date
}
