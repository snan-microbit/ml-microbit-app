# TM + micro:bit

Progressive Web App (PWA) que conecta modelos de **Teachable Machine** con el **micro:bit** vía Bluetooth.

## Características

### Modelos Soportados
- **Imagen**: Clasificación de imágenes desde webcam
- **Pose**: Detección de posturas corporales
- **Audio**: Reconocimiento de comandos de voz

### Funcionalidades
- **PWA**: Instalable en móviles y desktop
- **Bluetooth**: Conexión directa con micro:bit
- **Biblioteca de modelos**: Guarda múltiples modelos
- **Visualización de audio**: Barras de frecuencia optimizadas para voz
- **Filtro inteligente**: No envía "Ruido de fondo" al micro:bit
- **Cambio de cámara**: Alterna entre cámara frontal y trasera en modelos de imagen y pose
- **Offline-ready**: Service Worker para uso sin conexión

## Uso Rápido

1. Entrena tu modelo en [Teachable Machine](https://teachablemachine.withgoogle.com/)
2. Exporta el modelo y copia la URL
3. Abre la app: [tm-microbit.app](https://tu-dominio.com)
4. Pega la URL del modelo
5. Conecta tu micro:bit por Bluetooth
6. El micro:bit recibirá las predicciones

## Formato de Datos Bluetooth

La app envía datos al micro:bit por UART en el formato:

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

Usa la extensión `iaMachine` en MakeCode para programar tu micro:bit:

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

- **Al detectar clase** - Ejecuta código cuando detecta una clase específica
- **Al detectar cualquier clase** - Ejecuta código con cualquier detección
- **clase detectada** - Devuelve el nombre de la clase
- **certeza detectada** - Devuelve el % de certeza (0-100)
- **mostrar nombre Bluetooth** - Muestra el nombre del micro:bit en la matriz LED
- **Al conectar/desconectar** - Maneja eventos de conexión

## Branding Ceibal

La app usa la identidad visual de Plan Ceibal:
- Color primario: `#009f95` (turquoise)
- Iconos personalizados con laptop + micro:bit
- Tipografía: Nunito

## Arquitectura Técnica

### Stack
- **Frontend**: Vanilla JavaScript (ES6 modules), sin frameworks
- **ML**: TensorFlow.js v1.3.1 + Teachable Machine (image v0.8.3, pose v0.8.3) + Speech Commands v0.4.0
- **Bluetooth**: Web Bluetooth API (UART) con keep-alive cada 2 minutos
- **Storage**: LocalStorage para biblioteca de modelos (solo nombres y URLs)
- **PWA**: Service Worker (network-first) + Web App Manifest

### Estructura de Archivos

```
tm-microbit-app/
├── index.html           # UI principal
├── manifest.json        # PWA manifest
├── sw.js               # Service worker
├── CONTRIBUTING.md      # Guía de contribución
├── LICENSE             # Licencia MIT
├── assets/
│   ├── icon-192.png    # Iconos PWA
│   └── icon-512.png
├── css/
│   └── styles.css      # Estilos responsivos
└── js/
    ├── app.js          # Lógica principal y biblioteca
    ├── model-loader.js # Carga y detección de modelos
    ├── predictions.js  # Webcam, audio y predicciones
    └── bluetooth.js    # Gestión Bluetooth UART
```

### Modelos de Audio

Los modelos de audio usan `speechCommands` de TensorFlow.js como intermediario:

```
Micrófono → Speech Commands → Espectrograma → Tu modelo TM → Predicción
```

El visualizador de audio:
- Muestra 32 barras de frecuencia
- Rango optimizado: 80Hz - 8000Hz (voz humana)
- Barras redondeadas que crecen desde el centro
- Gradient turquesa a azul

### Modelos de Pose

Los modelos de pose usan PoseNet como intermediario:

```
Webcam (400x400) → Canvas (200x200) → PoseNet → 17 keypoints → Tu modelo TM → Predicción
```

El frame de la webcam se escala a 200x200 antes de la estimación para que los keypoints coincidan con el rango usado durante el entrenamiento en Teachable Machine. Se dibuja el esqueleto sobre el video en tiempo real.

## Convenciones de Desarrollo

- La lógica de predicciones está en `js/predictions.js`
- No modificar la integración con micro:bit salvo que se pida explícitamente
- La función `applyEnvironmentCamera` maneja el flip de cámara (fue problemática, tocar con cuidado)
- Los loops de predicción (`loopImage`, `loopPose`) usan un flag `predictionInFlight` para evitar llamadas concurrentes de inferencia sin bloquear el render del video
- La detección de tipo de modelo es automática: primero intenta por URL, luego analiza `metadata.json` y `model.json`
- Compatible con iOS Safari y Chrome Android, tener en cuenta que Web Bluetooth solo funciona en Chrome/Edge

## Desarrollo

### Requisitos
- Navegador con soporte de Web Bluetooth (Chrome, Edge)
- Servidor HTTPS (requerido para Bluetooth y getUserMedia)

### Desarrollo Local

```bash
# Servidor HTTPS simple con Python
python3 -m http.server 8000 --bind localhost

# O con Node.js
npx http-server -p 8000 -S
```

### Testing
- **Desktop**: Chrome/Edge (Web Bluetooth habilitado)
- **Mobile**: Android con Chrome (experiencia completa)
- **iOS**: La PWA carga y los modelos funcionan, pero Web Bluetooth no está soportado en Safari/iOS (no se puede conectar al micro:bit)

## Despliegue en GitHub Pages

### Opción 1: Interfaz web de GitHub (Más fácil)

#### Paso 1: Crear repositorio
1. Ve a [GitHub](https://github.com) e inicia sesión
2. Haz clic en el botón **"+"** arriba a la derecha, luego **"New repository"**
3. Nombre del repositorio: `tm-microbit-app` (o el que prefieras)
4. Selecciona **"Public"**
5. **NO** marques "Initialize with README" (ya tenemos uno)
6. Haz clic en **"Create repository"**

#### Paso 2: Subir archivos
1. En la página del nuevo repositorio, haz clic en **"uploading an existing file"**
2. Arrastra TODOS los archivos del proyecto
3. Escribe un mensaje de commit: "Initial commit"
4. Haz clic en **"Commit changes"**

#### Paso 3: Activar GitHub Pages
1. Ve a **Settings** de tu repositorio
2. En el menú lateral, haz clic en **"Pages"**
3. En "Source", selecciona **"main"** branch
4. Haz clic en **"Save"**
5. Espera 1-2 minutos

#### Paso 4: Verificar
Tu app estará disponible en:
```
https://TU-USUARIO.github.io/tm-microbit-app/
```

### Opción 2: Línea de comandos (Para usuarios avanzados)

#### Requisitos previos
- Git instalado
- Cuenta de GitHub

#### Comandos

```bash
# 1. Navega a la carpeta del proyecto
cd /ruta/a/tm-microbit-app

# 2. Inicializa git
git init

# 3. Agrega todos los archivos
git add .

# 4. Primer commit
git commit -m "Initial commit: Teachable Machine + micro:bit app"

# 5. Conecta con GitHub (reemplaza TU-USUARIO y TU-REPO)
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git

# 6. Sube los archivos
git branch -M main
git push -u origin main
```

#### Activar GitHub Pages por CLI (opcional)

Si tienes [GitHub CLI](https://cli.github.com/) instalado:

```bash
gh repo create tm-microbit-app --public --source=. --push
gh repo edit --enable-pages --pages-branch main
```

### Configuración adicional

#### Personalizar el dominio
1. Ve a Settings, luego Pages
2. En "Custom domain" ingresa tu dominio
3. Sigue las instrucciones de configuración DNS

#### Agregar iconos PWA
Para crear iconos reales (en lugar del placeholder SVG):

1. Crea un ícono de 512x512px
2. Usa una herramienta como [RealFaviconGenerator](https://realfavicongenerator.net/)
3. Descarga los iconos generados
4. Reemplaza `assets/icon-192.png` y `assets/icon-512.png`

### Actualizar la app

#### Por interfaz web:
1. Ve a tu repositorio en GitHub
2. Navega al archivo que quieres editar
3. Haz clic en el ícono del lápiz para editar
4. Edita y haz commit

#### Por línea de comandos:
```bash
git add .
git commit -m "Descripción de los cambios"
git push
```

### Probar la app

1. Abre Chrome o Edge
2. Ve a tu URL de GitHub Pages
3. Acepta permisos de cámara
4. Carga tu modelo de Teachable Machine

### Problemas comunes

**"404 - Not Found"**
- Espera 2-5 minutos después de activar Pages
- Verifica que el repositorio sea público
- Comprueba que los archivos estén en la raíz del repositorio

**"La app no carga"**
- Verifica la consola del navegador (F12)
- Asegúrate de que todos los archivos se hayan subido correctamente
- Comprueba que las rutas en `index.html` sean correctas

**"Bluetooth no funciona"**
- GitHub Pages usa HTTPS automáticamente
- Usa Chrome o Edge (Firefox/Safari no soportan Web Bluetooth)
- Verifica permisos de Bluetooth en el navegador

## Contribuir

Ver [CONTRIBUTING.md](CONTRIBUTING.md) para guidelines.

## Licencia

MIT License - Ver [LICENSE](LICENSE)

## Uso Educativo

Esta app fue diseñada para contextos educativos con Plan Ceibal, permitiendo que múltiples estudiantes trabajen con micro:bits en un aula.

**Identificación de dispositivos**: Usa el bloque `mostrar nombre Bluetooth` para que cada estudiante identifique su micro:bit cuando hay varios en el aula.

## Enlaces

- [Teachable Machine](https://teachablemachine.withgoogle.com/)
- [micro:bit](https://microbit.org/)
- [Plan Ceibal](https://www.ceibal.edu.uy/)
- [MakeCode](https://makecode.microbit.org/)

---

Hecho para la educación
