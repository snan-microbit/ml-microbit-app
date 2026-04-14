/**
 * trainer-config.js
 * Configuration table encoding the UI/behavior differences per trainer type.
 * No logic, no imports — pure data.
 */

const ICON_CAMERA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><circle cx="12" cy="10" r="3"/></svg>';

const ICON_MIC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';

export const TRAINER_CONFIGS = {
    image: {
        captureMode: 'webcam',
        captureOneLabel: 'Capturar',
        captureHoldLabel: 'Grabar',
        captureIcon: ICON_CAMERA,
        fixedFirstClass: null,
        showProgressBar: true,
        renameRequiresTryCatch: false,
        captureOneFailMessage: null,
        defaultClasses: ['Clase 1', 'Clase 2'],
    },
    pose: {
        captureMode: 'webcam-skeleton',
        captureOneLabel: 'Capturar',
        captureHoldLabel: 'Grabar',
        captureIcon: ICON_CAMERA,
        fixedFirstClass: null,
        showProgressBar: true,
        renameRequiresTryCatch: false,
        captureOneFailMessage: 'No se detectó pose. Asegurate de estar visible en la cámara.',
        defaultClasses: ['Clase 1', 'Clase 2'],
    },
    audio: {
        captureMode: 'audio',
        captureOneLabel: 'Grabar',
        captureHoldLabel: 'Grabar 10 muestras',
        captureIcon: ICON_MIC,
        fixedFirstClass: 'Ruido de fondo',
        showProgressBar: true,
        renameRequiresTryCatch: true,
        captureOneFailMessage: null,
        defaultClasses: ['Ruido de fondo', 'Clase 1', 'Clase 2'],
    },
};

export function getConfig(projectType) {
    return TRAINER_CONFIGS[projectType] || TRAINER_CONFIGS.image;
}
