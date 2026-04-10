# Archivos de importación de modelos TM

Estos archivos implementan la carga y ejecución de modelos de Teachable Machine
importados por URL. Se archivaron al eliminar la feature de importación por URL.

## Para re-habilitar

1. Mover `model-loader.js` y `predictions.js` de vuelta a `js/`
2. En `index.html`, agregar los scripts CDN de TM:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.3/dist/teachablemachine-image.min.js"></script>
   <script src="https://cdn.jsdelivr.net/npm/@teachablemachine/pose@0.8.3/dist/teachablemachine-pose.min.js"></script>
   ```
3. En `js/app.js`, restaurar los imports:
   ```js
   import { loadModel, extractClassNames } from './model-loader.js';
   import { startPredictions, stopPredictions, configurePredictions, applyEnvironmentCamera } from './predictions.js';
   ```
4. Restaurar funciones en app.js: `isUrlModel()`, `saveNewModel()`, `showNewModelModal()`,
   `hideModal()`, el branch `model.url` en `openPredictionScreen()`, y los event listeners
   del modal de URL (`typeUrlBtn`, `closeModalBtn`, `cancelModalBtn`, `saveModelBtn`,
   `modelUrlInput` keypress).
5. En `index.html`, des-ocultar `typeUrlBtn` (quitar `style="display:none"`)
6. En `sw.js`, re-agregar `./js/model-loader.js` y `./js/predictions.js` a `urlsToCache`
