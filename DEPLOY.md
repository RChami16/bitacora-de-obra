# Desplegar en Vercel (para probar en el celular)

Estos pasos son para cuando quieras publicar la app y probarla instalada en tu teléfono real. Vercel es gratis para este uso.

## 1. Crear cuenta en Vercel

1. Ve a [vercel.com/signup](https://vercel.com/signup).
2. La forma más simple es registrarte con tu correo (o con GitHub si ya tienes cuenta ahí — no es obligatorio).
3. Confirma tu correo si te lo pide.

## 2. Instalar la herramienta de línea de comandos de Vercel

En una terminal (PowerShell), corre:

```powershell
npm install -g vercel
```

## 3. Iniciar sesión desde la terminal

```powershell
vercel login
```

Esto abre el navegador para confirmar tu sesión — solo la primera vez.

## 4. Desplegar

Desde la carpeta del proyecto (`Bitácora_de_obra`):

```powershell
cd "C:\Users\rodri\OneDrive\Dokumente\Claude-Code-2026\Bitácora_de_obra"
vercel
```

Te va a hacer 3-4 preguntas (todas se pueden aceptar con Enter / valores por defecto la primera vez). Al final te da una URL tipo `https://bitacora-de-obra-xxxx.vercel.app`.

## 5. Probar en el celular

1. Abre esa URL en Chrome (Android) o Safari (iPhone) desde tu celular.
2. Deberías ver un aviso de "Agregar a pantalla de inicio" / "Instalar app" — acéptalo.
3. Ábrela desde el ícono que aparece en tu pantalla de inicio: debería abrir sin la barra del navegador, como una app normal.

## Para actualizaciones futuras

Cada vez que quieras subir cambios nuevos, repite solo el paso 4 (`vercel` desde la carpeta del proyecto) — o usa `vercel --prod` para publicarlo como la versión "oficial" en vez de una vista previa.
