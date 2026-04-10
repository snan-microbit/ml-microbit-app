/**
 * audio-trainer.js
 * Transfer learning module for audio/speech commands.
 * Wrapper around the speech-commands library's transfer learning API.
 *
 * speechCommands is a global loaded via <script> in index.html.
 */

// Base recognizer (pre-trained speech commands model)
let baseRecognizer = null;

// Transfer recognizer (custom classes)
let transfer = null;

// Class names tracked separately
let classNames = [];

// Spectrogram thumbnails by class name
let classThumbs = {};

// Recording state
let isRecording = false;

// Prediction
let predictionCallback = null;

// Audio visualizer state
let audioContext = null;
let analyser = null;
let micStream = null;
let visualizerRunning = false;
let vizCanvas = null;

// ============================================
// SPECTROGRAM THUMBNAIL
// ============================================

function generateSpectrogramThumb(spectrogramData, frameSize) {
    const numFrames = spectrogramData.length / frameSize;

    const c = document.createElement('canvas');
    c.width = numFrames;
    c.height = frameSize;
    const ctx = c.getContext('2d');
    const imgData = ctx.createImageData(numFrames, frameSize);

    let min = Infinity, max = -Infinity;
    for (let i = 0; i < spectrogramData.length; i++) {
        if (spectrogramData[i] < min) min = spectrogramData[i];
        if (spectrogramData[i] > max) max = spectrogramData[i];
    }
    const range = max - min || 1;

    for (let frame = 0; frame < numFrames; frame++) {
        for (let bin = 0; bin < frameSize; bin++) {
            const val = spectrogramData[frame * frameSize + bin];
            const norm = (val - min) / range;
            const brightness = Math.floor(norm * 255);

            const y = frameSize - 1 - bin;
            const idx = (y * numFrames + frame) * 4;

            imgData.data[idx]     = 0;
            imgData.data[idx + 1] = Math.floor(brightness * 0.62);
            imgData.data[idx + 2] = Math.floor(brightness * 0.58);
            imgData.data[idx + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);

    const thumb = document.createElement('canvas');
    thumb.width = 80;
    thumb.height = 60;
    thumb.getContext('2d').drawImage(c, 0, 0, 80, 60);

    return thumb.toDataURL('image/png');
}

// ============================================
// INIT
// ============================================

async function initTrainer() {
    if (baseRecognizer) return;

    baseRecognizer = speechCommands.create('BROWSER_FFT');
    await baseRecognizer.ensureModelLoaded();
    transfer = baseRecognizer.createTransfer('tm-audio-' + Date.now());

    console.log('Audio trainer ready');
}

// ============================================
// CLASS MANAGEMENT
// ============================================

function addClass(name) {
    classNames.push(name);
    return classNames.length - 1;
}

function removeClass(index) {
    const name = classNames[index];
    delete classThumbs[name];
    classNames.splice(index, 1);
}

function renameClass(index, newName) {
    const oldName = classNames[index];
    let counts = {};
    try { counts = transfer.countExamples(); } catch (e) {}
    if (counts[oldName] && counts[oldName] > 0) {
        throw new Error('No se puede renombrar una clase con muestras. Borrá las muestras primero.');
    }
    classNames[index] = newName;
}

/**
 * Clear examples for a specific class name from the transfer recognizer.
 * speech-commands 0.4.0 clearExamples() clears ALL examples — so this
 * resets all class counts to 0. The UI reflects this via getClasses().
 */
function clearSamples(index) {
    try {
        if (typeof transfer.clearExamples === 'function') {
            transfer.clearExamples();
        }
    } catch (e) {
        console.warn('clearExamples error:', e);
    }
    // clearExamples clears ALL examples across all classes
    classThumbs = {};
}

function getSamples(classIndex) {
    const name = classNames[classIndex];
    const thumbs = classThumbs[name] || [];
    return thumbs.map((thumb, i) => ({ index: i, thumb }));
}

function deleteSample(classIndex, sampleIndex) {
    const name = classNames[classIndex];
    const examples = transfer.getExamples(name);
    if (examples && examples[sampleIndex]) {
        try {
            transfer.removeExample(examples[sampleIndex].uid);
        } catch (e) {
            console.warn('removeExample error:', e);
        }
    }
    if (classThumbs[name]) {
        classThumbs[name].splice(sampleIndex, 1);
    }
}

function getClasses() {
    let counts = {};
    try { counts = transfer.countExamples(); } catch (e) {}
    return classNames.map(name => ({
        name,
        count: counts[name] || 0
    }));
}

function getClassNames() {
    return [...classNames];
}

function getTotalClasses() {
    return classNames.length;
}

// ============================================
// CAPTURE
// ============================================

/**
 * Record one audio sample for a class (~1 second).
 * Returns a Promise that resolves when done.
 */
async function recordSample(classIndex) {
    if (isRecording) return;
    const name = classNames[classIndex];
    isRecording = true;

    const wasListening = isListening();
    if (wasListening) stopListening();

    try {
        await transfer.collectExample(name);
        const examples = transfer.getExamples(name);
        const last = examples[examples.length - 1];
        const thumb = generateSpectrogramThumb(
            last.example.spectrogram.data,
            last.example.spectrogram.frameSize
        );
        if (!classThumbs[name]) classThumbs[name] = [];
        classThumbs[name].push(thumb);
    } finally {
        isRecording = false;
        if (wasListening && predictionCallback) {
            try {
                await startListening(predictionCallback);
            } catch (e) {
                console.warn('Could not resume listening:', e);
            }
        }
    }
}

function getIsRecording() {
    return isRecording;
}

/**
 * Record samples continuously for a class while isRecording is true.
 */
async function startContinuousRecording(classIndex) {
    isRecording = true;
    const name = classNames[classIndex];

    const wasListening = isListening();
    if (wasListening) stopListening();

    while (isRecording) {
        try {
            await transfer.collectExample(name);
            const examples = transfer.getExamples(name);
            const last = examples[examples.length - 1];
            const thumb = generateSpectrogramThumb(
                last.example.spectrogram.data,
                last.example.spectrogram.frameSize
            );
            if (!classThumbs[name]) classThumbs[name] = [];
            classThumbs[name].push(thumb);
        } catch (e) {
            console.warn('Recording error:', e);
            break;
        }
    }

    if (wasListening && predictionCallback) {
        try {
            await startListening(predictionCallback);
        } catch (e) {
            console.warn('Could not resume listening:', e);
        }
    }
}

function stopContinuousRecording() {
    isRecording = false;
}

// ============================================
// TRAINING
// ============================================

async function train(onProgress) {
    let counts = {};
    try { counts = transfer.countExamples(); } catch (e) {}

    const classesWithSamples = classNames.filter(n => (counts[n] || 0) >= 8);
    if (classesWithSamples.length < 2) {
        throw new Error('Se necesitan al menos 2 clases con 8+ muestras cada una');
    }

    // Serialize current samples, recreate transfer recognizer fresh,
    // and reload samples. This avoids the "trainable" error that occurs
    // when trying to retrain after transfer.load() corrupted internal state.
    const serialized = transfer.serializeExamples();
    transfer = baseRecognizer.createTransfer('tm-audio-' + Date.now());
    transfer.loadExamples(serialized, false);

    // Regenerate thumbnails since transfer was recreated
    classThumbs = {};
    for (const name of classNames) {
        const examples = transfer.getExamples(name);
        if (!examples) continue;
        classThumbs[name] = examples.map(ex =>
            generateSpectrogramThumb(
                ex.example.spectrogram.data,
                ex.example.spectrogram.frameSize
            )
        );
    }

    const totalEpochs = 50;
    await transfer.train({
        epochs: totalEpochs,
        callback: {
            onEpochEnd: (epoch, logs) => {
                if (onProgress) onProgress(epoch, totalEpochs, logs);
            }
        }
    });

    return { epochs: totalEpochs };
}

// ============================================
// PREDICTION
// ============================================

/**
 * Start listening for predictions.
 * callback receives [{className, probability}] on each result.
 */
async function startListening(callback) {
    if (!transfer) return;
    predictionCallback = callback;

    await transfer.listen(result => {
        // Use transfer.wordLabels() for label mapping — scores are in
        // alphabetical order matching wordLabels, not classNames order.
        const labels = transfer.wordLabels();  // orden correcto (alfabético)
        const scores = Array.from(result.scores);
        const predictions = scores.map((score, i) => ({
            className: labels[i],     
            probability: score
        }));

        if (predictionCallback) predictionCallback(predictions);
    }, {
        probabilityThreshold: 0.3,
        invokeCallbackOnNoiseAndUnknown: true,
        overlapFactor: 0.5
    });
}

function stopListening() {
    predictionCallback = null;
    try {
        if (transfer && transfer.isListening()) {
            transfer.stopListening();
        }
    } catch (e) {
        console.warn('stopListening error:', e);
    }
}

function isListening() {
    try {
        return transfer ? transfer.isListening() : false;
    } catch (e) {
        return false;
    }
}

// ============================================
// AUDIO VISUALIZER
// ============================================

async function startVisualizer(canvasElement) {
    stopVisualizer();
    vizCanvas = canvasElement;

    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        const source = audioContext.createMediaStreamSource(micStream);
        source.connect(analyser);
        visualizerRunning = true;
        drawVisualizer();
    } catch (e) {
        console.warn('Could not start audio visualizer:', e);
    }
}

function drawVisualizer() {
    if (!visualizerRunning || !analyser || !vizCanvas) return;

    const ctx = vizCanvas.getContext('2d');
    const w = vizCanvas.width;
    const h = vizCanvas.height;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const barCount = 32;
    const barWidth = (w / barCount) * 0.9;
    const barGap = (w / barCount) * 0.1;
    const borderRadius = Math.max(1, barWidth / 2);
    const centerY = h / 2;

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barGap / 2, centerY);
    ctx.lineTo(w - barGap / 2, centerY);
    ctx.stroke();

    const binFrequency = 22050 / bufferLength;
    const logMin = Math.log10(80);
    const logMax = Math.log10(4000);

    const barValues = [];
    for (let i = 0; i < barCount; i++) {
        const freqStart = Math.pow(10, logMin + (i / barCount) * (logMax - logMin));
        const freqEnd = Math.pow(10, logMin + ((i + 1) / barCount) * (logMax - logMin));
        const start = Math.max(0, Math.floor(freqStart / binFrequency));
        const end = Math.min(bufferLength - 1, Math.floor(freqEnd / binFrequency));
        let sum = 0, count = 0;
        for (let j = start; j <= end; j++) { sum += dataArray[j]; count++; }
        barValues.push(count > 0 ? sum / count : 0);
    }

    const threshold = 40;
    const half = barCount / 2;
    for (let i = 0; i < barCount; i++) {
        const freqIndex = i < half ? half - 1 - i : i - half;
        const average = barValues[freqIndex];
        const gated = average > threshold ? average - threshold : 0;
        const fullBarHeight = (gated / (255 - threshold)) * h * 0.65;
        const halfBarHeight = fullBarHeight / 2;
        const x = i * (barWidth + barGap) + barGap / 2;

        drawRoundedBar(ctx, x, centerY - halfBarHeight, barWidth, halfBarHeight, borderRadius, true);
        drawRoundedBar(ctx, x, centerY, barWidth, halfBarHeight, borderRadius, false);
    }

    requestAnimationFrame(drawVisualizer);
}

function drawRoundedBar(ctx, x, y, width, height, radius, isUp) {
    if (height < 2) return;
    const gradient = ctx.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, '#009f95');
    gradient.addColorStop(1, '#4169B8');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    if (isUp) {
        ctx.moveTo(x, y + height);
        ctx.lineTo(x, y + radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.lineTo(x + width, y + radius);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.lineTo(x + width, y + height);
    } else {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + height - radius);
        ctx.arcTo(x, y + height, x + width, y + height, radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.arcTo(x + width, y + height, x + width, y, radius);
        ctx.lineTo(x + width, y);
    }
    ctx.closePath();
    ctx.fill();
}

function stopVisualizer() {
    visualizerRunning = false;
    vizCanvas = null;
    if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
    }
    analyser = null;
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
    }
}

// ============================================
// PERSISTENCE
// ============================================

function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('tm-microbit', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('samples');
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbPut(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('samples', 'readwrite');
        tx.objectStore('samples').put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('samples', 'readonly');
        const req = tx.objectStore('samples').get(key);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}

async function idbDelete(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('samples', 'readwrite');
        tx.objectStore('samples').delete(key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function saveModel(projectId) {
    const storageKey = 'tm-audio-local-' + projectId;
    let saved = false;

    // Try transfer.save() directly (may exist on some builds)
    if (typeof transfer.save === 'function') {
        try {
            await transfer.save('indexeddb://' + storageKey);
            saved = true;
        } catch (e) {
            console.warn('transfer.save failed:', e);
        }
    }

    // Fall back to accessing the internal model property
    if (!saved) {
        const internalModel = transfer.model || transfer.transferModel;
        if (internalModel && typeof internalModel.save === 'function') {
            try {
                await internalModel.save('indexeddb://' + storageKey);
                saved = true;
            } catch (e) {
                console.warn('model.save failed:', e);
            }
        }
    }

    if (!saved) {
        console.warn('Audio model weights could not be saved. Samples are saved separately.');
    }

    return {
        source: 'local-audio',
        storageKey,
        classNames: [...classNames],
        trainedAt: new Date().toISOString()
    };
}

async function loadSavedModel(localModelInfo) {
    await initTrainer();
    classNames = [...localModelInfo.classNames];

    // Try transfer.load() directly
    if (typeof transfer.load === 'function') {
        await transfer.load('indexeddb://' + localModelInfo.storageKey);
        return;
    }

    // Fall back: load TF.js model and inject into transfer recognizer
    const loadedModel = await tf.loadLayersModel('indexeddb://' + localModelInfo.storageKey);

    let injected = false;
    for (const prop of ['model', 'transferModel']) {
        if (prop in transfer) {
            transfer[prop] = loadedModel;
            injected = true;
            break;
        }
    }

    // Restore word labels so listen() maps scores correctly
    for (const prop of ['words', 'words_', 'wordList_']) {
        if (prop in transfer) {
            transfer[prop] = [...classNames].sort();
            break;
        }
    }

    if (!injected) {
        throw new Error('No se pudo restaurar el modelo de audio');
    }
}

async function saveSamples(projectId) {
    let serialized;
    try {
        serialized = transfer.serializeExamples();
    } catch (e) {
        console.warn('No examples to serialize:', e);
        return;
    }
    await idbPut('tm-audio-samples-' + projectId, serialized);
}

async function loadSamples(projectId) {
    const serialized = await idbGet('tm-audio-samples-' + projectId);
    if (!serialized) return;
    try {
        transfer.loadExamples(serialized, false);
    } catch (e) {
        console.warn('Could not load audio samples:', e);
        return;
    }

    classThumbs = {};
    for (const name of classNames) {
        const examples = transfer.getExamples(name);
        if (!examples || examples.length === 0) continue;
        classThumbs[name] = examples.map(ex =>
            generateSpectrogramThumb(
                ex.example.spectrogram.data,
                ex.example.spectrogram.frameSize
            )
        );
    }
}

async function deleteModel(storageKey) {
    try {
        await tf.io.removeModel('indexeddb://' + storageKey);
    } catch (e) {
        console.warn('Could not remove audio model:', e);
    }
}

async function deleteSamplesDB(projectId) {
    await idbDelete('tm-audio-samples-' + projectId);
}

// ============================================
// CLEANUP
// ============================================

function isTrained() {
    try {
        // After training, wordLabels() returns custom class names.
        // After model injection, we check if classNames are populated.
        const labels = transfer ? transfer.wordLabels() : null;
        if (Array.isArray(labels) && labels.length > 0) return true;
        // Also check if we have classNames and a model was injected
        return classNames.length > 0 &&
               !!(transfer && (transfer.model || transfer.transferModel));
    } catch {
        return false;
    }
}

function dispose() {
    stopListening();
    stopVisualizer();
    stopContinuousRecording();

    transfer = null;
    baseRecognizer = null;
    classNames = [];
    classThumbs = {};
    isRecording = false;
    predictionCallback = null;
}

export {
    initTrainer,
    addClass, removeClass, renameClass,
    clearSamples, getClasses, getClassNames, getTotalClasses,
    getSamples, deleteSample,
    recordSample, startContinuousRecording, stopContinuousRecording,
    getIsRecording,
    train,
    startListening, stopListening, isListening,
    startVisualizer, stopVisualizer,
    saveModel, loadSavedModel, deleteModel,
    saveSamples, loadSamples, deleteSamplesDB,
    isTrained, dispose
};
