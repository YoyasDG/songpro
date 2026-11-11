# TXT → ChordPro (versión estática)

Convierte canciones en formato "acordes arriba de la letra" (.txt) a ChordPro (.cho), 100 % en el navegador. Sin servidor, sin dependencias.

`converter.js` es un port directo de `src/parser.ts` + `src/alignment.ts`: produce exactamente el mismo `.cho` que la versión Node.

## Archivos

- `index.html` – la página
- `style.css` – estilos (modo claro/oscuro automático)
- `converter.js` – motor de conversión (alineación musical y estricta)
- `app.js` – interfaz: pegar/abrir .txt, metadatos, copiar, descargar, vista previa

## Publicar en GitHub Pages

1. Crea un repositorio y sube estos 4 archivos a la raíz (o a una carpeta `docs/`).
2. En el repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Elige la rama `main` y la carpeta `/ (root)` (o `/docs`), guarda.
4. En un minuto queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

También funciona abriendo `index.html` con doble clic, sin internet.
