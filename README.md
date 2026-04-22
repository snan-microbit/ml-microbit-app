# ML - micro:bit

Progressive Web App (PWA) que entrena modelos de **Machine Learning en el navegador** y los conecta al **micro:bit** vía Bluetooth.

## Características

- **Tres tipos de trainer**: Imagen (cámara), Audio (micrófono), Pose (postura corporal)
- **Entrenamiento en el navegador**: sin depender de servicios externos
- **PWA**: instalable en móviles y desktop, funciona offline
- **Bluetooth UART**: envía predicciones en tiempo real al micro:bit
- **Captura toggle**: activá/desactivá captura continua en imagen y pose; batch de 10 muestras en audio
- **Panel MakeCode inline**: programá tu micro:bit sin salir de la app
- **Cambio de cámara**: alternancia entre cámara frontal y trasera

## Flujo de Uso

1. En la pantalla principal, creá un nuevo proyecto y elegí el tipo: **Imagen**, **Audio** o **Pose**
2. Agregá al menos 2 clases, capturá muestras para cada una y presioná **Entrenar**
3. En la pantalla de predicción, conectá tu micro:bit por Bluetooth
4. Programá el micro:bit con la extensión **iaMachine** en MakeCode (panel integrado)

## Formato de Datos Bluetooth

La app envía datos al micro:bit por UART:

```
clase#certeza\n
```

**Ejemplos:**
```
Arriba#95\n
Gato#87\n
Izquierda#92\n
```

Los mensajes se truncan a 20 bytes (límite BLE UART), respetando fronteras UTF-8 para no cortar caracteres multibyte como `ñ` o `é`. La conexión se mantiene activa con un heartbeat cada 2 minutos.

## Extensión para MakeCode

La extensión `iaMachine` (repo: [`pxt-tm-microbit-link-v2`](https://github.com/snan-microbit/pxt-tm-microbit-link-v2)) permite programar el micro:bit con bloques que reaccionan a las predicciones de la app. Las clases del modelo entrenado aparecen automáticamente como un dropdown tipado (`TMClase`) en los bloques que las usan.

```blocks
iaMachine.alDetectarClase(TMClase.Arriba, 80, function () {
    basic.showLeds(`
        . . # . .
        . # # # .
        # . # . #
        . . # . .
        . . # . .
    `)
})
```

### Bloques Disponibles

**Detección**

- **al detectar %clase con certeza > %umbral** — se ejecuta cada vez que llega una predicción de la clase indicada y la certeza supera el umbral. Dispara vía event bus con protección contra reentrada: si el handler todavía está corriendo cuando llega la siguiente predicción, esa predicción se descarta.
- **mientras se detecta %clase con certeza > %umbral** — se ejecuta continuamente en un fiber propio mientras la clase detectada coincida con la indicada y la certeza supere el umbral. El código interno controla el ritmo (por ejemplo con `music.play(..., UntilDone)` o `basic.pause`). Más adecuado que `al detectar` cuando el handler debe completar cada ciclo antes de re-evaluar.
- **al detectar cualquier clase con certeza > %umbral** — se ejecuta cada vez que llega cualquier predicción con certeza sobre el umbral, con la misma protección de reentrada.

**Lectura de estado**

- **clase detectada** — nombre de la última clase recibida.
- **certeza detectada** — porcentaje de certeza de la última detección (0–100).

**Conexión**

- **al conectar a la app** — handler ejecutado cuando se establece la conexión BLE.
- **al desconectar de la app** — handler ejecutado al cerrarse la conexión.

**Modo controlado** (avanzado)

- **habilitar / deshabilitar modo controlado** — cuando está habilitado, cada handler de detección ejecutado responde automáticamente con `OK\n` a la app.
- **enviar señal de listo** — envía manualmente `OK\n` a la app.

### Versión de MakeCode

El iframe de MakeCode está pineado a `v7.1.47` (`makecode-embed.js`, constante `MAKECODE_URL`). Esto es un **workaround** por el bug upstream [microsoft/pxt-microbit#6629](https://github.com/microsoft/pxt-microbit/issues/6629): en MakeCode v8 (runtime codal-microbit-v2 v0.3.2), cualquier llamada al subsistema `music.*` desde un programa con conexión BLE activa dispara el panic `070` (`MICROBIT_PANIC_SD_ASSERT`) en la primera ejecución del audio. Reproducible tanto con el ejemplo mínimo del issue como con el flujo real de la app.

**Notas de mantenimiento:**

- No actualizar `MAKECODE_URL` a una versión más reciente sin verificar primero que el issue upstream esté cerrado y el fix incluido en esa versión.
- La extensión `pxt-tm-microbit-link-v2` tiene `targetVersions` omitido de su `pxt.json` para que MakeCode v7 la acepte. No agregar esa clave sin re-validar en ambas versiones.
- Si Microsoft retira v7.1.47 del editor archivado, el fallback existente en `makecode-embed.js` (timeout de carga) va a disparar la UI de error. Alternativa futura: migrar el feedback sonoro a buzzer externo por pin (evita el subsistema `music`).

## Arquitectura Técnica

### Stack

| Componente | Tecnología |
|---|---|
| Frontend | Vanilla JavaScript (ES6 modules), sin frameworks |
| Trainer imagen | TF.js 4.22.0 + MobileNet v1 alpha 0.25 (transfer learning, truncado en `conv_pw_13_relu`) |
| Trainer audio | TF.js 4.22.0 + Speech Commands 0.5.4 (`createTransfer()`) |
| Trainer pose | MediaPipe Tasks Vision 0.10.14 (PoseLandmarker lite, GPU) + TF.js 4.22.0 |
| Storage | IndexedDB — modelos vía `indexeddb://` (tf.io), muestras en object store propio |
| Bluetooth | Web Bluetooth API (UART) con keep-alive cada 2 minutos |
| MakeCode | Iframe embebido en v7.1.47 + comunicación `postMessage` |
| PWA | Service Worker (network-first) + Web App Manifest |

### Pipelines de inferencia

**Imagen**
```
Webcam (224×224) → MobileNet (features 12544) → Dense(100, relu) → Dense(N, softmax)
```

**Audio**
```
Micrófono → Espectrograma → Speech Commands base → head de transfer learning → Predicción
```

La clase `Ruido de fondo` se fija en el índice 0 como requisito de `speech-commands`.

**Pose**
```
Webcam → PoseLandmarker → 33 keypoints (99 floats: x, y, z) → Dense(64, relu) → Dense(N, softmax)
```

### Estructura de Archivos

```
tm-microbit-app/
├── index.html              # UI principal (todas las pantallas + modales)
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker (network-first, v4.5)
├── assets/
│   ├── icon-192.png        # Iconos PWA
│   └── icon-512.png
├── css/
│   └── styles.css          # Estilos responsivos
└── js/
    ├── app.js              # Lógica principal, UI y coordinación
    ├── image-trainer.js    # Transfer learning sobre MobileNet
    ├── audio-trainer.js    # Transfer learning sobre Speech Commands
    ├── pose-trainer.js     # MediaPipe PoseLandmarker + clasificador TF.js
    ├── webcam.js           # Gestión de cámara (canvas + video)
    ├── bluetooth.js        # Gestión Bluetooth UART
    ├── makecode-embed.js   # Iframe MakeCode + comunicación postMessage
    ├── project-store.js    # CRUD de proyectos en localStorage
    ├── trainer-config.js   # Configuración declarativa por tipo de trainer
    └── tm-import/          # (Archivado) importador de modelos TM por URL
        ├── model-loader.js
        ├── predictions.js
        └── README.md
```

## Branding Ceibal

- Color primario: `#009f95` (turquesa Ceibal)
- Tipografía: Nunito
- Iconos personalizados con laptop + micro:bit