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

Los mensajes se truncan a 20 bytes (límite BLE UART). La conexión se mantiene activa con un heartbeat cada 2 minutos.

## Extensión para MakeCode

Usá la extensión `iaMachine` en MakeCode para programar tu micro:bit:

```blocks
al iniciar
    iaMachine.mostrarNombreBluetooth()

iaMachine.alDetectarClase("Arriba", 80, function () {
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

- **Al detectar clase** — ejecuta código cuando detecta una clase con cierta certeza mínima
- **Al detectar cualquier clase** — ejecuta código con cualquier detección
- **clase detectada** — devuelve el nombre de la clase actual
- **certeza detectada** — devuelve el % de certeza (0–100)
- **mostrar nombre Bluetooth** — muestra el nombre del micro:bit en la matriz LED
- **Al conectar/desconectar** — maneja eventos de conexión Bluetooth

## Arquitectura Técnica

### Stack

| Componente | Tecnología |
|---|---|
| Frontend | Vanilla JavaScript (ES6 modules), sin frameworks |
| Trainer imagen | TF.js 4.22.0 + MobileNet v1 (transfer learning, capa `conv_pw_13_relu`) |
| Trainer audio | TF.js 4.22.0 + Speech Commands 0.5.4 (transfer learning) |
| Trainer pose | MediaPipe Tasks Vision 0.10.14 (PoseLandmarker, 33 keypoints) + TF.js 4.22.0 |
| Storage | IndexedDB — modelos vía `indexeddb://` (tf.io), muestras en object store propio |
| Bluetooth | Web Bluetooth API (UART) con keep-alive cada 2 minutos |
| PWA | Service Worker (network-first) + Web App Manifest |

### Pipelines de inferencia

**Imagen**
```
Webcam → MobileNet (features 12544) → Dense(128, relu) → Dense(N, softmax)
```

**Audio**
```
Micrófono → Espectrograma → Speech Commands base → Dense head → Predicción
```

**Pose**
```
Webcam → PoseLandmarker → 33 keypoints (99 floats x,y,z) → Dense(64, relu) → Dense(N, softmax)
```

### Estructura de Archivos

```
tm-microbit-app/
├── index.html              # UI principal (todas las pantallas)
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
    └── tm-import/          # (Archivado) importador de modelos TM por URL
        ├── model-loader.js
        ├── predictions.js
        └── README.md
```

## Branding Ceibal

- Color primario: `#009f95` (turquesa Ceibal)
- Tipografía: Nunito
- Iconos personalizados con laptop + micro:bit
