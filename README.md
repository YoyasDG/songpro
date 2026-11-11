# TXT → ChordPro (versión estática)

Convierte canciones en formato "acordes arriba de la letra" (.txt) a ChordPro (.cho), 100 % en el navegador. Sin servidor, sin dependencias.

`converter.js` es un port directo de `src/parser.ts` + `src/alignment.ts`: produce exactamente el mismo `.cho` que la versión Node.

## Archivos

- `index.html` – la página
- `style.css` – estilos (modo claro/oscuro automático)
- `converter.js` – motor de conversión (alineación musical y estricta)
- `app.js` – interfaz: pegar/abrir .txt, metadatos, copiar, descargar, vista previa