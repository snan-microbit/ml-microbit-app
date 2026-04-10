/**
 * app.js
 * Main application logic
 */

import { Webcam } from './webcam.js';
import { connectMicrobit, disconnectMicrobit, sendToMicrobit, isConnected, setDisconnectCallback } from './bluetooth.js';
import { openMakeCode, closeMakeCode } from './makecode-embed.js';
import * as trainer from './image-trainer.js';
import * as audioTrainer from './audio-trainer.js';
import * as poseTrainer from './pose-trainer.js';

let currentModel = null;
const MODELS_KEY = 'tm_microbit_models';

// Tracks which type of project is being created via the name modal
let pendingProjectType = 'image'; // 'image' | 'audio' | 'pose'

// Webcam unificada: se mueve entre clases (captura) y sección de predicciones
let activeWebcam = null;
let activeWebcamTarget = null;  // 'capture' | 'prediction' | null
let predictionLoopRunning = false;
let trainingFacingMode = 'user'; // 'user' | 'environment'
let predictionExpanded = false;

let batchRecordingActive = false;
let batchRecordingCancelled = false;

const CLASS_COLORS = [
    { bg: '#E1F5EE', dot: '#1D9E75', btnFill: '#1D9E75', badge: '#9FE1CB', badgeText: '#0F6E56', headerText: '#085041', icon: '#0F6E56' },
    { bg: '#E6F1FB', dot: '#378ADD', btnFill: '#378ADD', badge: '#B5D4F4', badgeText: '#185FA5', headerText: '#0C447C', icon: '#185FA5' },
    { bg: '#FAECE7', dot: '#D85A30', btnFill: '#D85A30', badge: '#F5C4B3', badgeText: '#993C1D', headerText: '#712B13', icon: '#993C1D' },
    { bg: '#EEEDFE', dot: '#7F77DD', btnFill: '#7F77DD', badge: '#CECBF6', badgeText: '#534AB7', headerText: '#3C3489', icon: '#534AB7' },
    { bg: '#FBEAF0', dot: '#D4537E', btnFill: '#D4537E', badge: '#F4C0D1', badgeText: '#993556', headerText: '#72243E', icon: '#993556' },
    { bg: '#FAEEDA', dot: '#BA7517', btnFill: '#BA7517', badge: '#FAC775', badgeText: '#854F0B', headerText: '#633806', icon: '#854F0B' },
];

function getClassColor(index) {
    return CLASS_COLORS[index % CLASS_COLORS.length];
}

function getTrainer() {
    if (currentModel?.projectType === 'audio') return audioTrainer;
    if (currentModel?.projectType === 'pose') return poseTrainer;
    return trainer;
}

function resetConnectionUI() {
    const pConn = document.getElementById('predictionConnectBtn');
    if (pConn && pConn.classList.contains('connected')) {
        pConn.classList.remove('connected');
        pConn.textContent = '🔗 Conectar';
    }
}
setDisconnectCallback(resetConnectionUI);

// ============================================
// PROJECT LIBRARY
// ============================================

function loadModels() {
    const stored = localStorage.getItem(MODELS_KEY);
    return stored ? JSON.parse(stored) : [];
}

function saveModels(models) {
    localStorage.setItem(MODELS_KEY, JSON.stringify(models));
}

function addProject(name, projectType) {
    const models = loadModels();
    const newModel = {
        id: Date.now().toString(),
        name: name.trim(),
        projectType: projectType,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        makecodeProject: null,
    };
    models.unshift(newModel);
    saveModels(models);
    return newModel;
}

async function deleteModel(id) {
    const models = loadModels();
    const project = models.find(m => m.id === id);

    if (project?.localModel?.storageKey) {
        if (project.localModel.source === 'local-audio') {
            await audioTrainer.deleteModel(project.localModel.storageKey);
            await audioTrainer.deleteSamplesDB(id);
        } else if (project.localModel.source === 'local-pose') {
            await poseTrainer.deleteModel(project.localModel.storageKey);
            await poseTrainer.deleteSamplesDB(id);
        } else {
            await trainer.deleteModel(project.localModel.storageKey);
            await trainer.deleteSamplesDB(id);
        }
    }

    saveModels(models.filter(m => m.id !== id));
}

function updateProjectMakeCode(id, makecodeProject) {
    const models = loadModels();
    const model = models.find(m => m.id === id);
    if (model) {
        model.makecodeProject = makecodeProject;
        model.lastUsed = new Date().toISOString();
        saveModels(models);
    }
}

function renderModels() {
    const models = loadModels();
    const modelsList = document.getElementById('modelsList');
    const emptyState = document.getElementById('emptyState');

    // Always hide the old empty state — the New Project card takes its place
    if (emptyState) emptyState.style.display = 'none';

    const newProjectCard = `
        <button class="model-card-new" id="newProjectCard">
            <span class="card-new-icon">+</span>
            <span class="card-new-label">Nuevo Proyecto</span>
        </button>`;

    const projectCards = models.map(model => `
        <div class="model-card">
            <div class="model-card-title">${escapeHtml(model.name)}</div>
            ${model.classNames ? `<div class="model-card-classes">${model.classNames.map(c => escapeHtml(c)).join(' · ')}</div>` : ''}
            <div class="model-card-date">${formatDate(model.createdAt)}</div>
            <div class="model-card-actions">
                <button class="btn-card btn-use" data-action="open" data-id="${model.id}">Abrir</button>
                <button class="btn-card btn-delete" data-action="delete" data-id="${model.id}">🗑</button>
            </div>
        </div>
    `).join('');

    modelsList.innerHTML = newProjectCard + projectCards;

    document.getElementById('newProjectCard').addEventListener('click', () => {
        document.getElementById('projectTypeModal').classList.remove('hidden');
    });

    modelsList.querySelectorAll('[data-action="open"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const model = loadModels().find(m => m.id === btn.dataset.id);
            if (!model) return;
            currentModel = model;
            await openTrainingScreen(model);
        });
    });

    modelsList.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm('¿Eliminar este proyecto?')) {
                await deleteModel(btn.dataset.id);
                renderModels();
                showToast('Proyecto eliminado', 'success');
            }
        });
    });
}

// ============================================
// NAVIGATION & FLOWS
// ============================================

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');

}

async function openPredictionScreen(model) {
    currentModel = model;
    document.getElementById('predictionModelName').textContent = model.name;

    document.getElementById('predictionRetrainBtn').style.display = '';

    const isAudio = model.projectType === 'audio' || model.localModel?.source === 'local-audio';
    const isPose = model.projectType === 'pose' || model.localModel?.source === 'local-pose';

    // Flip button only makes sense for camera models
    document.getElementById('predictionFlipBtn').style.display = isAudio ? 'none' : '';

    batchRecordingActive = false;
    batchRecordingCancelled = true;
    stopPredictionLoop();
    audioTrainer.stopListening();
    audioTrainer.stopVisualizer();
    closeMakeCode('makecodeInlineFrame');
    closeCaptureWebcamSilent();
    disconnectMicrobit();

    const conn = document.getElementById('predictionConnectBtn');
    conn.classList.remove('connected');
    conn.textContent = '🔗 Conectar';

    trainingFacingMode = 'user';
    predictionExpanded = false;
    document.body.classList.remove('prediction-expanded');
    document.getElementById('prediction-predictions').innerHTML = '';

    showScreen('predictionScreen');
    showToast('Cargando modelo...', 'info');

    try {
        if (isAudio) {
            // Local audio model: load weights + start visualizer + start listening
            await audioTrainer.loadSavedModel(model.localModel);

            const wrapper = document.getElementById('prediction-webcam-wrapper');
            const canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 400;
            canvas.style.background = '#fff';
            wrapper.innerHTML = '';
            wrapper.appendChild(canvas);
            await audioTrainer.startVisualizer(canvas);
            await audioTrainer.startListening(preds => renderTrainingPredictions(preds));
        } else if (isPose) {
            if (!poseTrainer.isTrained()) {
                await poseTrainer.loadSavedModel(model.localModel);
            }
            await startPosePredictionLoop();
        } else {
            await startPredictionLoop();
        }
        showToast('Modelo cargado', 'success');
    } catch (error) {
        console.error('Error loading model:', error);
        showToast('Error al cargar el modelo', 'error');
        showScreen('homeScreen');
        return;
    }

    const classNamesForMakeCode = model.classNames
        || (isAudio ? audioTrainer.getClassNames()
            : isPose ? poseTrainer.getClassNames()
            : trainer.getClassNames());

    openMakeCode(
        classNamesForMakeCode,
        model.makecodeProject || null,
        (proj) => {
            updateProjectMakeCode(model.id, proj);
            if (currentModel) currentModel.makecodeProject = proj;
        },
        model.name,
        'makecodeInlineFrame',
        true
    );
}

// ============================================
// TRAINING SCREEN
// ============================================

async function openTrainingScreen(project) {
    document.getElementById('trainingModelName').textContent = project.name;
    document.getElementById('trainBtn').disabled = true;

    stopPredictionLoop();
    closeCaptureWebcamSilent();
    audioTrainer.stopListening();
    audioTrainer.stopVisualizer();
    trainer.dispose();
    audioTrainer.dispose();
    poseTrainer.dispose();
    document.getElementById('trainProgressText').textContent = '';

    trainingFacingMode = 'user';
    predictionExpanded = false;
    document.body.classList.remove('prediction-expanded');

    const isAudio = project.projectType === 'audio';
    const isPose = project.projectType === 'pose';

    if (isPose) {
        showToast('Cargando detector de pose...', 'info');

        try {
            await poseTrainer.initTrainer();

            if (project.localModel) {
                try {
                    await poseTrainer.loadSavedModel(project.localModel);
                } catch (e) {
                    showScreen('trainingScreen');
                    document.getElementById('trainingCaptureSection').classList.remove('hidden');
                    project.localModel.classNames.forEach(name => poseTrainer.addClass(name));
                    renderTrainingClasses();
                    await openCaptureWebcamWithSkeleton();
                    showToast('Listo', 'success');
                    return;
                }
                showToast('Cargando muestras anteriores...', 'info');
                await poseTrainer.loadSamples(project.id);
                if (poseTrainer.isTrained()) {
                    await openPredictionScreen(project);
                    return;
                }
                showScreen('trainingScreen');
                document.getElementById('trainingCaptureSection').classList.remove('hidden');
            } else {
                showScreen('trainingScreen');
                document.getElementById('trainingCaptureSection').classList.remove('hidden');
                poseTrainer.addClass('Clase 1');
                poseTrainer.addClass('Clase 2');
            }

            renderTrainingClasses();
            await openCaptureWebcamWithSkeleton();
            showToast('Listo', 'success');
        } catch (error) {
            console.error('Pose training init error:', error);
            showToast('Error al inicializar detector de pose', 'error');
            showScreen('homeScreen');
        }

        return;
    }

    if (isAudio) {
        showToast('Iniciando entrenador de audio...', 'info');

        try {
            await audioTrainer.initTrainer();

            if (project.localModel) {
                project.localModel.classNames.forEach(name => audioTrainer.addClass(name));
                showToast('Cargando muestras anteriores...', 'info');
                await audioTrainer.loadSamples(project.id);
                try {
                    await audioTrainer.loadSavedModel(project.localModel);
                    await openPredictionScreen(project);
                    return;
                } catch (e) {
                    // Model weights not found — show training screen for re-recording/re-training
                    showScreen('trainingScreen');
                    document.getElementById('trainingCaptureSection').classList.remove('hidden');
                }
            } else {
                showScreen('trainingScreen');
                document.getElementById('trainingCaptureSection').classList.remove('hidden');
                audioTrainer.addClass('Ruido de fondo');
                audioTrainer.addClass('Clase 1');
                audioTrainer.addClass('Clase 2');
            }

            renderTrainingClasses();
            await openAudioVisualizer();
            showToast('Listo', 'success');
        } catch (error) {
            console.error('Audio training init error:', error);
            showToast('Error al inicializar micrófono', 'error');
            showScreen('homeScreen');
        }

        return;
    }

    // ── Image trainer flow ──
    if (!project.localModel) {
        document.getElementById('trainingCaptureSection').classList.remove('hidden');
    }

    showToast('Cargando red base...', 'info');

    try {
        await trainer.initTrainer();

        if (project.localModel) {
            try {
                await trainer.loadSavedModel(project.localModel);
            } catch (e) {
                showScreen('trainingScreen');
                document.getElementById('trainingCaptureSection').classList.remove('hidden');
                project.localModel.classNames.forEach(name => trainer.addClass(name));
                renderTrainingClasses();
                openCaptureWebcam();
                showToast('Listo', 'success');
                return;
            }
            showToast('Cargando muestras anteriores...', 'info');
            await trainer.loadSamples(project.id);
            if (trainer.isTrained()) {
                await openPredictionScreen(project);
                return;
            }
            showScreen('trainingScreen');
            document.getElementById('trainingCaptureSection').classList.remove('hidden');
        } else {
            showScreen('trainingScreen');
            trainer.addClass('Clase 1');
            trainer.addClass('Clase 2');
        }

        renderTrainingClasses();
        openCaptureWebcam();
        showToast('Listo', 'success');
    } catch (error) {
        console.error('Training init error:', error);
        showToast('Error al inicializar', 'error');
        showScreen('homeScreen');
    }
}

// ============================================
// WEBCAM MANAGEMENT
// ============================================

async function openCaptureWebcam() {
    if (activeWebcamTarget === 'capture') closeCaptureWebcamSilent();
    stopPredictionLoop();

    activeWebcamTarget = 'capture';

    const webcam = new Webcam(400, 400, true);
    await webcam.setup('user');

    // Abortar si el modo cambió durante el setup
    if (activeWebcamTarget !== 'capture') {
        webcam.stop();
        return;
    }

    await webcam.play();
    activeWebcam = webcam;

    const container = document.getElementById('captureWebcamContainer');
    if (container) {
        container.innerHTML = '';
        container.appendChild(activeWebcam.canvas);
    }

    function updateLoop() {
        if (activeWebcamTarget !== 'capture') return;
        if (activeWebcam) activeWebcam.update();
        requestAnimationFrame(updateLoop);
    }
    requestAnimationFrame(updateLoop);
}

async function openCaptureWebcamWithSkeleton() {
    if (activeWebcamTarget === 'capture') closeCaptureWebcamSilent();
    stopPredictionLoop();

    activeWebcamTarget = 'capture';

    const webcam = new Webcam(400, 400, true);
    await webcam.setup('user');

    if (activeWebcamTarget !== 'capture') {
        webcam.stop();
        return;
    }

    await webcam.play();
    activeWebcam = webcam;

    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = 400;
    displayCanvas.height = 400;
    const displayCtx = displayCanvas.getContext('2d');

    const container = document.getElementById('captureWebcamContainer');
    if (container) {
        container.innerHTML = '';
        container.appendChild(displayCanvas);
    }

    function updateLoop() {
        if (activeWebcamTarget !== 'capture') return;
        if (!activeWebcam) return;

        activeWebcam.update();
        displayCtx.drawImage(activeWebcam.canvas, 0, 0, 400, 400);

        try {
            poseTrainer.extractKeypoints(activeWebcam.video, performance.now());
            const landmarks = poseTrainer.getLastLandmarks();
            if (landmarks) poseTrainer.drawSkeleton(displayCtx, landmarks, 400, 400, true);
        } catch (e) {
            // ignore detection errors during preview
        }

        requestAnimationFrame(updateLoop);
    }
    requestAnimationFrame(updateLoop);
}

async function startPosePredictionLoop() {
    if (activeWebcamTarget === 'capture') return;
    stopPredictionLoop();

    const flip = trainingFacingMode === 'user';
    const wrapper = document.getElementById('prediction-webcam-wrapper');
    activeWebcam = new Webcam(400, 400, flip);
    await activeWebcam.setup(trainingFacingMode);
    await activeWebcam.play();

    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = 400;
    displayCanvas.height = 400;
    const displayCtx = displayCanvas.getContext('2d');

    wrapper.innerHTML = '';
    wrapper.appendChild(displayCanvas);

    activeWebcamTarget = 'prediction';
    predictionLoopRunning = true;

    updateTrainButton();

    let inFlight = false;
    function loop() {
        if (!predictionLoopRunning || activeWebcamTarget !== 'prediction') return;
        if (!activeWebcam) return;

        activeWebcam.update();
        displayCtx.drawImage(activeWebcam.canvas, 0, 0, 400, 400);

        const landmarks = poseTrainer.getLastLandmarks();
        if (landmarks) poseTrainer.drawSkeleton(displayCtx, landmarks, 400, 400, flip);

        if (!inFlight) {
            inFlight = true;
            poseTrainer.predict(activeWebcam.video)
                .then(preds => {
                    inFlight = false;
                    renderTrainingPredictions(preds);
                })
                .catch(() => { inFlight = false; });
        }

        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

async function openAudioVisualizer() {
    const container = document.getElementById('captureWebcamContainer');
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    canvas.style.cssText = 'width:100%;height:100%;display:block;border-radius:12px;';
    container.appendChild(canvas);
    await audioTrainer.startVisualizer(canvas);
}

function closeCaptureWebcamSilent() {
    trainer.stopCapture();
    poseTrainer.stopCapture();
    if (activeWebcam && activeWebcamTarget === 'capture') {
        activeWebcam.stop();
        activeWebcam = null;
    }
    const container = document.getElementById('captureWebcamContainer');
    if (container) container.innerHTML = '';
    activeWebcam = null;
    activeWebcamTarget = null;
}

async function startPredictionLoop() {
    if (activeWebcamTarget === 'capture') return;
    stopPredictionLoop(); // destruir webcam previa si la hay

    const wrapper = document.getElementById('prediction-webcam-wrapper');
    activeWebcam = new Webcam(400, 400, trainingFacingMode === 'user');
    await activeWebcam.setup(trainingFacingMode);
    await activeWebcam.play();

    wrapper.innerHTML = '';
    wrapper.appendChild(activeWebcam.canvas);

    activeWebcamTarget = 'prediction';
    predictionLoopRunning = true;

    updateTrainButton();

    let inFlight = false;
    function loop() {
        if (!predictionLoopRunning || activeWebcamTarget !== 'prediction') return;
        if (!activeWebcam) return;
        activeWebcam.update();
        if (!inFlight) {
            inFlight = true;
            trainer.predict(activeWebcam.canvas)
                .then(preds => {
                    inFlight = false;
                    renderTrainingPredictions(preds);
                })
                .catch(() => { inFlight = false; });
        }
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

function stopPredictionLoop() {
    predictionLoopRunning = false;
    if (activeWebcam && activeWebcamTarget === 'prediction') {
        activeWebcam.stop();
        activeWebcam = null;
        activeWebcamTarget = null;
        document.getElementById('prediction-webcam-wrapper').innerHTML = '';
    }
    updateTrainButton();
}

async function flipTrainingCamera() {
    trainingFacingMode = trainingFacingMode === 'user' ? 'environment' : 'user';
    stopPredictionLoop();
    await new Promise(r => setTimeout(r, 250)); // wait for camera hardware to release
    if (currentModel?.projectType === 'pose') {
        await startPosePredictionLoop();
    } else {
        await startPredictionLoop();
    }
}

function togglePredictionExpanded() {
    predictionExpanded = !predictionExpanded;
    document.body.classList.toggle('prediction-expanded', predictionExpanded);
    if (predictionExpanded) {
        requestAnimationFrame(() => {
            requestAnimationFrame(sizeExpandedVideo);
        });
    } else {
        clearExpandedVideoSize();
    }
}

function sizeExpandedVideo() {
    if (!predictionExpanded) return;

    const area = document.querySelector('.prediction-video-area');
    const wrapper = document.querySelector('.prediction-webcam-wrapper');
    const column = document.querySelector('.prediction-main-column');
    if (!area || !wrapper) return;
    const r = area.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const padW = parseFloat(getComputedStyle(area).paddingLeft)
               + parseFloat(getComputedStyle(area).paddingRight);
    const padH = parseFloat(getComputedStyle(area).paddingTop)
               + parseFloat(getComputedStyle(area).paddingBottom);
    const size = Math.floor(Math.min(r.width - padW, r.height - padH));
    if (size > 0) {
        wrapper.style.width = size + 'px';
        wrapper.style.height = size + 'px';
        if (column) column.style.setProperty('--expanded-video-size', size + 'px');
    }
}

function clearExpandedVideoSize() {
    const wrapper = document.querySelector('.prediction-webcam-wrapper');
    if (wrapper) { wrapper.style.width = ''; wrapper.style.height = ''; }
    const column = document.querySelector('.prediction-main-column');
    if (column) column.style.removeProperty('--expanded-video-size');
}

window.addEventListener('resize', () => {
    if (predictionExpanded) sizeExpandedVideo();
});

document.addEventListener('click', () => {
    document.querySelectorAll('.class-dropdown.open').forEach(d => d.classList.remove('open'));
});

async function enterCaptureMode() {
    trainingFacingMode = 'user';
    predictionExpanded = false;
    document.body.classList.remove('prediction-expanded');

    stopPredictionLoop();
    closeMakeCode('makecodeInlineFrame');

    const isAudio = currentModel?.projectType === 'audio';
    const isPose = currentModel?.projectType === 'pose';

    if (isAudio) {
        audioTrainer.stopListening();
        audioTrainer.stopVisualizer();

        // Restore samples from IDB if counts are all 0
        const classes = audioTrainer.getClasses();
        const needLoad = classes.length > 0 && classes.every(c => c.count === 0);
        if (needLoad) await audioTrainer.loadSamples(currentModel.id);

        document.getElementById('trainingCaptureSection').classList.remove('hidden');
        renderTrainingClasses();
        showScreen('trainingScreen');
        await openAudioVisualizer();
    } else if (isPose) {
        const classes = poseTrainer.getClasses();
        const needLoad = classes.length > 0 && classes.every(c => c.count === 0);
        if (needLoad) await poseTrainer.loadSamples(currentModel.id);
        renderTrainingClasses();

        document.getElementById('trainingCaptureSection').classList.remove('hidden');
        showScreen('trainingScreen');
        await openCaptureWebcamWithSkeleton();
    } else {
        // Restaurar muestras desde IDB si no hay samples en memoria
        const classes = trainer.getClasses();
        const needLoad = classes.length > 0 && classes.every(c => c.count === 0);
        if (needLoad) await trainer.loadSamples(currentModel.id);
        renderTrainingClasses();

        showScreen('trainingScreen');
        openCaptureWebcam();
    }
}

function renderTrainingPredictions(predictions) {
    const container = document.getElementById('prediction-predictions');
    if (!container || !predictions?.length) return;

    const sorted = predictions.slice().sort((a, b) => b.probability - a.probability);

    container.innerHTML = sorted.map((pred, i) => {
        const pct = (pred.probability * 100).toFixed(1);
        return `
            <div class="prediction-item ${i === 0 ? 'top' : ''}">
                <div class="prediction-header">
                    <span class="class-name">${escapeHtml(pred.className)}</span>
                    <span class="confidence">${pct}%</span>
                </div>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${pct}%"></div>
                </div>
            </div>`;
    }).join('');

    if (isConnected() && sorted.length > 0) {
        const top = sorted[0];
        sendToMicrobit(top.className, top.probability * 100);
    }
}

function updateClassUI(classIndex) {
    const card = document.querySelector(`#trainingClassesList [data-index="${classIndex}"]`);
    if (!card) return;
    const t = getTrainer();
    const c = t.getClasses()[classIndex];

    const badge = card.querySelector('.sample-badge');
    if (badge) badge.textContent = `${c.count} muestras`;

    const gallery = card.querySelector('.sample-gallery');
    if (gallery) {
        const samples = t.getSamples(classIndex);
        gallery.innerHTML = samples.map(s => `
            <div class="sample-thumb">
                <img src="${s.thumb}">
                <button class="btn-delete-sample" data-ci="${classIndex}" data-si="${s.index}">×</button>
            </div>
        `).join('');
        gallery.querySelectorAll('.btn-delete-sample').forEach(btn => {
            btn.addEventListener('click', () => {
                t.deleteSample(+btn.dataset.ci, +btn.dataset.si);
                updateClassUI(classIndex);
                updateTrainButton();
            });
        });
    }

    updateTrainButton();
}

function renderTrainingClasses() {
    if (currentModel?.projectType === 'audio') {
        renderAudioTrainingClasses();
        return;
    }
    if (currentModel?.projectType === 'pose') {
        renderPoseTrainingClasses();
        return;
    }

    const container = document.getElementById('trainingClassesList');
    const cls = trainer.getClasses();

    container.innerHTML = cls.map((c, i) => {
        const color = getClassColor(i);
        const samples = trainer.getSamples(i);
        const pct = Math.min(100, (c.count / 20) * 100);

        return `
        <div class="training-class-card" data-index="${i}">
            <div class="class-card-header" style="background:${color.bg}; border-bottom-color:${color.badge};">
                <div class="class-card-header-left">
                    <div class="class-dot" style="background:${color.dot};"></div>
                    <input class="class-name-input" value="${escapeHtml(c.name)}" data-index="${i}" style="color:${color.headerText};">
                </div>
                <div class="class-card-header-right">
                    <span class="sample-badge" data-index="${i}" style="background:${color.badge}; color:${color.badgeText};">${c.count} muestras</span>
                    <div class="class-menu-wrapper">
                        <button class="btn-class-menu" data-index="${i}" title="Opciones">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="${color.icon}" stroke="none">
                                <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                            </svg>
                        </button>
                        <div class="class-dropdown">
                            <button class="class-dropdown-item btn-clear-class" data-index="${i}"${c.count === 0 ? ' disabled' : ''}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
                                </svg>
                                Borrar muestras
                            </button>
                            <button class="class-dropdown-item btn-delete-class danger" data-index="${i}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
                                </svg>
                                Eliminar clase
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="class-card-body">
                <div class="class-capture-buttons">
                    <button class="btn-capture-one" data-index="${i}" style="background:${color.bg}; color:${color.headerText}; border-color:${color.badge};">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><circle cx="12" cy="10" r="3"/></svg>
                        Tomar
                    </button>
                    <button class="btn-capture-hold" data-index="${i}" style="background:${color.btnFill};">
                        <span class="hold-dot"></span>
                        Mantener
                    </button>
                </div>
                <div class="sample-gallery">
                    ${samples.map(s => `
                        <div class="sample-thumb">
                            <img src="${s.thumb}">
                            <button class="btn-delete-sample" data-ci="${i}" data-si="${s.index}">×</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.class-name-input').forEach(input => {
        input.addEventListener('change', () => {
            trainer.renameClass(+input.dataset.index, input.value.trim());
        });
    });

    container.querySelectorAll('.btn-class-menu').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = btn.closest('.class-menu-wrapper').querySelector('.class-dropdown');
            document.querySelectorAll('.class-dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.toggle('open');
        });
    });

    container.querySelectorAll('.btn-clear-class').forEach(btn => {
        btn.addEventListener('click', () => {
            trainer.clearSamples(+btn.dataset.index);
            renderTrainingClasses();
            updateTrainButton();
        });
    });

    container.querySelectorAll('.btn-delete-class').forEach(btn => {
        btn.addEventListener('click', () => {
            if (trainer.getTotalClasses() <= 2) {
                showToast('Mínimo 2 clases', 'error');
                return;
            }
            trainer.removeClass(+btn.dataset.index);
            renderTrainingClasses();
        });
    });

    container.querySelectorAll('.btn-delete-sample').forEach(btn => {
        btn.addEventListener('click', () => {
            const ci = +btn.dataset.ci;
            trainer.deleteSample(ci, +btn.dataset.si);
            updateClassUI(ci);
        });
    });

    container.querySelectorAll('.btn-capture-one').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!activeWebcam || activeWebcamTarget !== 'capture') return;
            trainer.captureOne(+btn.dataset.index, activeWebcam.canvas);
            updateClassUI(+btn.dataset.index);
        });
    });

    container.querySelectorAll('.btn-capture-hold').forEach(btn => {
        const ci = +btn.dataset.index;
        btn.addEventListener('click', () => {
            if (!activeWebcam || activeWebcamTarget !== 'capture') return;
            if (btn.classList.contains('capturing')) {
                btn.classList.remove('capturing');
                trainer.stopCapture();
                clearInterval(btn._updateInterval);
                updateClassUI(ci);
            } else {
                container.querySelectorAll('.btn-capture-hold.capturing').forEach(other => {
                    other.classList.remove('capturing');
                    clearInterval(other._updateInterval);
                });
                btn.classList.add('capturing');
                trainer.startCapture(ci, activeWebcam.canvas);
                btn._updateInterval = setInterval(() => updateClassUI(ci), 300);
            }
        });
    });

    updateTrainButton();
}

function renderPoseTrainingClasses() {
    const container = document.getElementById('trainingClassesList');
    const cls = poseTrainer.getClasses();

    container.innerHTML = cls.map((c, i) => {
        const color = getClassColor(i);
        const samples = poseTrainer.getSamples(i);

        return `
        <div class="training-class-card" data-index="${i}">
            <div class="class-card-header" style="background:${color.bg}; border-bottom-color:${color.badge};">
                <div class="class-card-header-left">
                    <div class="class-dot" style="background:${color.dot};"></div>
                    <input class="class-name-input" value="${escapeHtml(c.name)}" data-index="${i}" style="color:${color.headerText};">
                </div>
                <div class="class-card-header-right">
                    <span class="sample-badge" data-index="${i}" style="background:${color.badge}; color:${color.badgeText};">${c.count} muestras</span>
                    <div class="class-menu-wrapper">
                        <button class="btn-class-menu" data-index="${i}" title="Opciones">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="${color.icon}" stroke="none">
                                <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                            </svg>
                        </button>
                        <div class="class-dropdown">
                            <button class="class-dropdown-item btn-pose-clear" data-index="${i}"${c.count === 0 ? ' disabled' : ''}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
                                </svg>
                                Borrar muestras
                            </button>
                            <button class="class-dropdown-item btn-pose-delete danger" data-index="${i}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
                                </svg>
                                Eliminar clase
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="class-card-body">
                <div class="class-capture-buttons">
                    <button class="btn-capture-one btn-pose-capture-one" data-index="${i}" style="background:${color.bg}; color:${color.headerText}; border-color:${color.badge};">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><circle cx="12" cy="10" r="3"/></svg>
                        Tomar
                    </button>
                    <button class="btn-capture-hold btn-pose-capture-hold" data-index="${i}" style="background:${color.btnFill};">
                        <span class="hold-dot"></span>
                        Mantener
                    </button>
                </div>
                <div class="sample-gallery">
                    ${samples.map(s => `
                        <div class="sample-thumb">
                            <img src="${s.thumb}">
                            <button class="btn-delete-sample" data-ci="${i}" data-si="${s.index}">×</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.class-name-input').forEach(input => {
        input.addEventListener('change', () => {
            poseTrainer.renameClass(+input.dataset.index, input.value.trim());
        });
    });

    container.querySelectorAll('.btn-class-menu').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = btn.closest('.class-menu-wrapper').querySelector('.class-dropdown');
            document.querySelectorAll('.class-dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.toggle('open');
        });
    });

    container.querySelectorAll('.btn-pose-clear').forEach(btn => {
        btn.addEventListener('click', () => {
            poseTrainer.clearSamples(+btn.dataset.index);
            renderTrainingClasses();
            updateTrainButton();
        });
    });

    container.querySelectorAll('.btn-pose-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            if (poseTrainer.getTotalClasses() <= 2) {
                showToast('Mínimo 2 clases', 'error');
                return;
            }
            poseTrainer.removeClass(+btn.dataset.index);
            renderTrainingClasses();
        });
    });

    container.querySelectorAll('.btn-delete-sample').forEach(btn => {
        btn.addEventListener('click', () => {
            const ci = +btn.dataset.ci;
            poseTrainer.deleteSample(ci, +btn.dataset.si);
            updateClassUI(ci);
        });
    });

    container.querySelectorAll('.btn-pose-capture-one').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!activeWebcam || activeWebcamTarget !== 'capture') return;
            const ok = poseTrainer.captureOne(+btn.dataset.index, activeWebcam.canvas, activeWebcam.video);
            if (!ok) showToast('No se detectó pose. Asegurate de estar visible en la cámara.', 'info');
            updateClassUI(+btn.dataset.index);
        });
    });

    container.querySelectorAll('.btn-pose-capture-hold').forEach(btn => {
        const ci = +btn.dataset.index;
        btn.addEventListener('click', () => {
            if (!activeWebcam || activeWebcamTarget !== 'capture') return;
            if (btn.classList.contains('capturing')) {
                btn.classList.remove('capturing');
                poseTrainer.stopCapture();
                clearInterval(btn._updateInterval);
                updateClassUI(ci);
            } else {
                container.querySelectorAll('.btn-pose-capture-hold.capturing').forEach(other => {
                    other.classList.remove('capturing');
                    clearInterval(other._updateInterval);
                });
                btn.classList.add('capturing');
                poseTrainer.startCapture(ci, activeWebcam.canvas, activeWebcam.video);
                btn._updateInterval = setInterval(() => updateClassUI(ci), 300);
            }
        });
    });

    updateTrainButton();
}

async function recordWithCountdown(classIndex, current = null, total = null) {
    const modal = document.getElementById('audioRecordModal');
    const numberEl = document.getElementById('countdownNumber');
    const labelEl = document.getElementById('countdownLabel');

    modal.classList.remove('hidden');

    for (let i = 3; i >= 1; i--) {
        numberEl.className = 'countdown-number';
        numberEl.textContent = i;
        labelEl.textContent = (current !== null && total !== null)
            ? `Muestra ${current}/${total}`
            : 'Prepárate...';
        // Re-trigger animation by forcing reflow
        void numberEl.offsetWidth;
        numberEl.classList.add('pulse');
        await new Promise(r => setTimeout(r, 800));
    }

    numberEl.className = 'countdown-number recording';
    numberEl.textContent = '🔴';
    labelEl.textContent = '¡GRABANDO!';

    try {
        await audioTrainer.recordSample(classIndex);
    } catch (e) {
        console.error('Recording error:', e);
    }

    numberEl.className = 'countdown-number done';
    numberEl.textContent = '✓';
    labelEl.textContent = 'Listo';

    await new Promise(r => setTimeout(r, 400));

    modal.classList.add('hidden');

    updateClassUIAudio(classIndex);
    updateTrainButton();
}

function renderAudioTrainingClasses() {
    const container = document.getElementById('trainingClassesList');
    const cls = audioTrainer.getClasses();

    container.innerHTML = cls.map((c, i) => {
        const color = getClassColor(i);
        const isBackground = i === 0; // "Ruido de fondo" is always index 0
        const pct = Math.min(100, (c.count / 20) * 100);
        const samples = audioTrainer.getSamples(i);

        return `
        <div class="training-class-card" data-index="${i}">
            <div class="class-card-header" style="background:${color.bg}; border-bottom-color:${color.badge};">
                <div class="class-card-header-left">
                    <div class="class-dot" style="background:${color.dot};"></div>
                    <input class="class-name-input" value="${escapeHtml(c.name)}" data-index="${i}"
                        style="color:${color.headerText};" ${isBackground ? 'disabled' : ''}>
                </div>
                <div class="class-card-header-right">
                    <span class="sample-badge" data-index="${i}"
                        style="background:${color.badge}; color:${color.badgeText};">${c.count} muestras</span>
                    ${isBackground ? '' : `
                    <div class="class-menu-wrapper">
                        <button class="btn-class-menu" data-index="${i}" title="Opciones">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="${color.icon}" stroke="none">
                                <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                            </svg>
                        </button>
                        <div class="class-dropdown">
                            <button class="class-dropdown-item btn-audio-clear" data-index="${i}"${c.count === 0 ? ' disabled' : ''}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
                                </svg>
                                Borrar muestras
                            </button>
                            <button class="class-dropdown-item btn-audio-delete danger" data-index="${i}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
                                </svg>
                                Eliminar clase
                            </button>
                        </div>
                    </div>`}
                </div>
            </div>
            <div class="class-card-body">
                <div class="audio-sample-info">
                    <div class="audio-sample-bar-wrap">
                        <div class="audio-sample-bar-fill" style="width:${pct}%"></div>
                    </div>
                </div>
                <div class="class-capture-buttons">
                    <button class="btn-audio-record" data-index="${i}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                        Grabar
                    </button>
                    <button class="btn-audio-record-hold" data-index="${i}">
                        <span class="hold-dot"></span>
                        Mantener
                    </button>
                </div>
                <div class="sample-gallery">
                    ${samples.map(s => `
                        <div class="sample-thumb">
                            <img src="${s.thumb}">
                            <button class="btn-delete-sample" data-ci="${i}" data-si="${s.index}">×</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>`;
    }).join('');

    // ── Rename ──
    container.querySelectorAll('.class-name-input:not([disabled])').forEach(input => {
        input.addEventListener('change', () => {
            const newName = input.value.trim();
            if (!newName) { input.value = audioTrainer.getClasses()[+input.dataset.index].name; return; }
            try {
                audioTrainer.renameClass(+input.dataset.index, newName);
            } catch (e) {
                showToast(e.message, 'error');
                input.value = audioTrainer.getClasses()[+input.dataset.index].name;
            }
        });
    });

    // ── Dropdown open/close ──
    container.querySelectorAll('.btn-class-menu').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = btn.closest('.class-menu-wrapper').querySelector('.class-dropdown');
            document.querySelectorAll('.class-dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.toggle('open');
        });
    });

    // ── Clear samples (clears ALL due to speech-commands API limitation) ──
    container.querySelectorAll('.btn-audio-clear').forEach(btn => {
        btn.addEventListener('click', () => {
            audioTrainer.clearSamples(+btn.dataset.index);
            renderTrainingClasses();
            updateTrainButton();
            showToast('Muestras borradas', 'success');
        });
    });

    // ── Delete class ──
    container.querySelectorAll('.btn-audio-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            if (audioTrainer.getTotalClasses() <= 2) {
                showToast('Mínimo 2 clases', 'error');
                return;
            }
            batchRecordingActive = false;
            batchRecordingCancelled = true;
            audioTrainer.removeClass(+btn.dataset.index);
            renderTrainingClasses();
        });
    });

    // ── Delete individual sample ──
    container.querySelectorAll('.btn-delete-sample').forEach(btn => {
        btn.addEventListener('click', () => {
            const ci = +btn.dataset.ci;
            audioTrainer.deleteSample(ci, +btn.dataset.si);
            updateClassUIAudio(ci);
            updateTrainButton();
        });
    });

    // ── Single record (~1 second) with countdown ──
    container.querySelectorAll('.btn-audio-record').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (audioTrainer.getIsRecording()) return;
            await recordWithCountdown(+btn.dataset.index);
        });
    });

    // ── Batch record (toggle: 10 muestras con countdown) ──
    container.querySelectorAll('.btn-audio-record-hold').forEach(btn => {
        const ci = +btn.dataset.index;

        btn.addEventListener('click', async () => {
            // Segundo click durante un batch: cancelar
            if (batchRecordingActive) {
                if (!batchRecordingCancelled) {
                    batchRecordingCancelled = true;
                    btn.innerHTML = '<span class="hold-dot"></span> Cancelando...';
                }
                return;
            }

            // Primer click: iniciar batch de 10 grabaciones
            batchRecordingActive = true;
            batchRecordingCancelled = false;
            btn.classList.add('capturing');

            const cancelBtn = document.getElementById('audioRecordCancelBtn');
            cancelBtn.classList.add('visible');
            cancelBtn.onclick = () => {
                if (!batchRecordingCancelled) {
                    batchRecordingCancelled = true;
                    btn.innerHTML = '<span class="hold-dot"></span> Cancelando...';
                }
            };

            for (let n = 1; n <= 10; n++) {
                if (batchRecordingCancelled) break;
                await recordWithCountdown(ci, n, 10);
                if (batchRecordingCancelled) break;
            }

            cancelBtn.classList.remove('visible');
            cancelBtn.onclick = null;

            batchRecordingActive = false;
            batchRecordingCancelled = false;
            btn.classList.remove('capturing');
            btn.innerHTML = '<span class="hold-dot"></span> Mantener';

            updateClassUIAudio(ci);
            updateTrainButton();
        });
    });

    updateTrainButton();
}

function updateClassUIAudio(classIndex) {
    const card = document.querySelector(`#trainingClassesList [data-index="${classIndex}"]`);
    if (!card) return;
    const c = audioTrainer.getClasses()[classIndex];
    if (!c) return;

    const badge = card.querySelector('.sample-badge');
    if (badge) badge.textContent = `${c.count} muestras`;

    const fill = card.querySelector('.audio-sample-bar-fill');
    if (fill) fill.style.width = Math.min(100, (c.count / 20) * 100) + '%';

    const gallery = card.querySelector('.sample-gallery');
    if (gallery) {
        const samples = audioTrainer.getSamples(classIndex);
        gallery.innerHTML = samples.map(s => `
            <div class="sample-thumb">
                <img src="${s.thumb}">
                <button class="btn-delete-sample" data-ci="${classIndex}" data-si="${s.index}">×</button>
            </div>
        `).join('');
        gallery.querySelectorAll('.btn-delete-sample').forEach(btn => {
            btn.addEventListener('click', () => {
                audioTrainer.deleteSample(+btn.dataset.ci, +btn.dataset.si);
                updateClassUIAudio(classIndex);
                updateTrainButton();
            });
        });
    }
}

function updateTrainButton() {
    const isAudio = currentModel?.projectType === 'audio';
    const t = getTrainer();
    const cls = t.getClasses();
    const ready = cls.length >= 2 && cls.every(c => c.count >= 8);
    const isCameraModel = !isAudio;
    document.getElementById('trainBtn').disabled = !ready || (isCameraModel && predictionLoopRunning);
}

// ============================================
// MODAL
// ============================================

// ============================================
// UTILITIES
// ============================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Hoy';
    if (days === 1) return 'Ayer';
    if (days < 7) return `Hace ${days} días`;

    return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('statusToast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================
// EVENT LISTENERS
// ============================================

// Home: open type selection modal
document.getElementById('newModelBtn').addEventListener('click', () => {
    document.getElementById('projectTypeModal').classList.remove('hidden');
});

// Project type modal
document.getElementById('closeTypeModalBtn').addEventListener('click', () => {
    document.getElementById('projectTypeModal').classList.add('hidden');
});

document.getElementById('typeTrainBtn').addEventListener('click', () => {
    pendingProjectType = 'image';
    document.getElementById('projectTypeModal').classList.add('hidden');
    document.getElementById('trainNameModal').classList.remove('hidden');
    document.getElementById('trainProjectName').value = '';
    document.getElementById('trainProjectName').focus();
});

document.getElementById('typeAudioTrainBtn').addEventListener('click', () => {
    pendingProjectType = 'audio';
    document.getElementById('projectTypeModal').classList.add('hidden');
    document.getElementById('trainNameModal').classList.remove('hidden');
    document.getElementById('trainProjectName').value = '';
    document.getElementById('trainProjectName').focus();
});

document.getElementById('typePoseTrainBtn').addEventListener('click', () => {
    pendingProjectType = 'pose';
    document.getElementById('projectTypeModal').classList.add('hidden');
    document.getElementById('trainNameModal').classList.remove('hidden');
    document.getElementById('trainProjectName').value = '';
    document.getElementById('trainProjectName').focus();
});

// Train name modal
document.getElementById('closeTrainNameBtn').addEventListener('click', () => {
    document.getElementById('trainNameModal').classList.add('hidden');
});

document.getElementById('cancelTrainNameBtn').addEventListener('click', () => {
    document.getElementById('trainNameModal').classList.add('hidden');
});

document.getElementById('startTrainingBtn').addEventListener('click', async () => {
    const name = document.getElementById('trainProjectName').value.trim();
    if (!name) {
        showToast('Ingresa un nombre', 'error');
        return;
    }

    document.getElementById('trainNameModal').classList.add('hidden');

    currentModel = addProject(name, pendingProjectType);
    renderModels();
    await openTrainingScreen(currentModel);
});

document.getElementById('trainProjectName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('startTrainingBtn').click();
});

// Training screen
document.getElementById('trainingBackBtn').addEventListener('click', () => {
    batchRecordingActive = false;
    batchRecordingCancelled = true;
    closeCaptureWebcamSilent();
    audioTrainer.stopListening();
    audioTrainer.stopVisualizer();
    disconnectMicrobit();
    trainer.dispose();
    audioTrainer.dispose();
    poseTrainer.dispose();
    document.getElementById('trainingClassesList').innerHTML = '';
    trainingFacingMode = 'user';
    renderModels();
    showScreen('homeScreen');
});

// Prediction screen
document.getElementById('predictionBackBtn').addEventListener('click', () => {
    stopPredictionLoop();
    audioTrainer.stopListening();
    audioTrainer.stopVisualizer();
    poseTrainer.dispose();
    closeMakeCode('makecodeInlineFrame');
    disconnectMicrobit();
    predictionExpanded = false;
    document.body.classList.remove('prediction-expanded');
    renderModels();
    showScreen('homeScreen');
});

document.getElementById('predictionRetrainBtn').addEventListener('click', async () => {
    await enterCaptureMode();
});

document.getElementById('predictionFlipBtn').addEventListener('click', () => flipTrainingCamera());
document.getElementById('predictionExpandBtn').addEventListener('click', togglePredictionExpanded);

document.getElementById('addClassBtn').addEventListener('click', () => {
    const t = getTrainer();
    t.addClass(`Clase ${t.getTotalClasses() + 1}`);
    renderTrainingClasses();
});

document.getElementById('trainBtn').addEventListener('click', async () => {
    const btn = document.getElementById('trainBtn');
    const text = document.getElementById('trainProgressText');
    const isAudio = currentModel?.projectType === 'audio';
    const t = getTrainer();

    if (isAudio) {
        audioTrainer.stopListening();
    } else {
        closeCaptureWebcamSilent();
    }

    btn.disabled = true;
    btn.querySelector('.train-label').textContent = 'Entrenando...';
    btn.classList.add('training');
    text.textContent = '0%';

    try {
        await t.saveSamples(currentModel.id);
        await t.train((epoch, total) => {
            const pct = ((epoch + 1) / total * 100);
            text.textContent = `${Math.round(pct)}%`;
        });

        showToast('Modelo entrenado', 'success');

        const localModelInfo = await t.saveModel(currentModel.id);
        const models = loadModels();
        const project = models.find(m => m.id === currentModel.id);
        if (project) {
            project.localModel = localModelInfo;
            project.classNames = localModelInfo.classNames;
            saveModels(models);
            currentModel = project;
        }
        renderModels();

        await openPredictionScreen(currentModel);

    } catch (error) {
        console.error('Training error:', error);
        showToast(error.message, 'error');

        // If audio training failed but model was previously trained, resume listening
        if (isAudio && audioTrainer.isTrained()) {
            await audioTrainer.startListening(preds => renderTrainingPredictions(preds));
        }
    }

    btn.querySelector('.train-label').textContent = 'Entrenar';
    btn.classList.remove('training');
    btn.disabled = false;
});


// Prediction screen — bluetooth toggle
document.getElementById('predictionConnectBtn').addEventListener('click', async () => {
    const btn = document.getElementById('predictionConnectBtn');
    if (isConnected()) {
        disconnectMicrobit();
    } else {
        try {
            await connectMicrobit();
            btn.classList.add('connected');
            btn.textContent = '❌ Desconectar';
        } catch (error) {
            showToast('Error al conectar', 'error');
        }
    }
});

// ============================================
// PULL-TO-REFRESH PREVENTION
// ============================================

let touchStartY = 0;

document.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    const predictionScreen = document.getElementById('predictionScreen');
    if (!predictionScreen.classList.contains('hidden')) {
        const touchDelta = e.touches[0].clientY - touchStartY;
        if (touchDelta > 0 && window.scrollY === 0) e.preventDefault();
    }
}, { passive: false });

// ============================================
// INIT
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    renderModels();
});

export { showToast };
