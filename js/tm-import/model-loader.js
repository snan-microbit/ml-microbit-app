/**
 * model-loader.js
 * Loads and detects Teachable Machine models (image, pose, audio)
 */

let model = null;
let maxPredictions = 0;
let modelType = null;

/**
 * Detect model type from URL pattern
 */
function detectModelTypeFromURL(url) {
    if (url.includes('/image/')) return 'image';
    if (url.includes('/pose/')) return 'pose';
    if (url.includes('/audio/')) return 'audio';
    return null;
}

/**
 * Find batch_input_shape recursively in model topology
 */
function findInputShape(obj, depth = 0) {
    if (depth > 10 || !obj || typeof obj !== 'object') return null;
    
    if (obj.batch_input_shape) {
        return obj.batch_input_shape;
    }
    
    // Check first layer's config (Sequential model)
    if (obj.config && obj.config.layers && obj.config.layers.length > 0) {
        const firstLayer = obj.config.layers[0];
        if (firstLayer.config && firstLayer.config.batch_input_shape) {
            return firstLayer.config.batch_input_shape;
        }
    }
    
    // Check model_config (Functional model)
    if (obj.model_config) {
        return findInputShape(obj.model_config, depth + 1);
    }
    
    // Check modelTopology
    if (obj.modelTopology) {
        return findInputShape(obj.modelTopology, depth + 1);
    }
    
    return null;
}

/**
 * Detect model type from metadata.json and model.json
 */
async function detectModelTypeFromMetadata(baseURL) {
    try {
        // === Step 1: Check metadata.json ===
        const response = await fetch(baseURL + 'metadata.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const metadata = await response.json();
        
        console.log('🔍 Full metadata.json:', JSON.stringify(metadata, null, 2));
        
        // Check for audio-specific fields
        if (metadata.tmSoundModelVersion || metadata.audioSampleRate || metadata.wordLabels) {
            console.log('🔍 Detected AUDIO from metadata fields');
            return 'audio';
        }
        
        // Check ALL string fields in metadata for "pose", "audio", "image"
        const metadataStr = JSON.stringify(metadata).toLowerCase();
        
        if (metadataStr.includes('@teachablemachine/pose') || 
            metadataStr.includes('teachablemachine-pose') ||
            metadataStr.includes('"pose"')) {
            console.log('🔍 Detected POSE from metadata string search');
            return 'pose';
        }
        
        if (metadataStr.includes('@teachablemachine/image') ||
            metadataStr.includes('teachablemachine-image')) {
            console.log('🔍 Detected IMAGE from metadata string search');
            return 'image';
        }
        
        if (metadataStr.includes('speechcommands') || metadataStr.includes('audio')) {
            console.log('🔍 Detected AUDIO from metadata string search');
            return 'audio';
        }
        
        // === Step 2: Check model.json input shape ===
        try {
            const modelResponse = await fetch(baseURL + 'model.json');
            if (modelResponse.ok) {
                const modelJson = await modelResponse.json();
                
                console.log('🔍 model.json keys:', Object.keys(modelJson));
                
                const inputShape = findInputShape(modelJson);
                
                console.log('🔍 Detected input shape:', JSON.stringify(inputShape));
                
                if (inputShape) {
                    // Pose models: 2D input [null, N] where N = num_keypoints * features
                    // Typical: [null, 34] for 17 keypoints * 2 (x,y)
                    if (inputShape.length === 2) {
                        console.log('🔍 2D input shape → POSE model');
                        return 'pose';
                    }
                    
                    // Image models: 4D input [null, 224, 224, 3]
                    if (inputShape.length === 4) {
                        const [, height, width, channels] = inputShape;
                        
                        if (channels === 1 && (height !== 224 || width !== 224)) {
                            console.log('🔍 4D non-standard input → AUDIO model');
                            return 'audio';
                        }
                        
                        console.log('🔍 4D input [224,224,3] → IMAGE model');
                        return 'image';
                    }
                }
            }
        } catch (e) {
            console.warn('Could not analyze model.json:', e);
        }
        
        console.log('🔍 Could not determine type, defaulting to IMAGE');
        return 'image'; // Default
    } catch (error) {
        console.error('Error detecting model type:', error);
        throw error;
    }
}

/**
 * Load model — accepts either a TM URL string or a project object with localModel.
 */
async function loadModel(modelURLorProject) {
    // Local audio model trained in-app
    if (typeof modelURLorProject === 'object'
            && modelURLorProject.localModel?.source === 'local-audio') {
        const audioModule = await import('./audio-trainer.js');
        await audioModule.loadSavedModel(modelURLorProject.localModel);

        model = {
            listen: (cb, opts) => audioModule.startListening(cb, opts),
            stopListening: () => audioModule.stopListening(),
            wordLabels: () => audioModule.getClassNames(),
            getTotalClasses: () => audioModule.getTotalClasses(),
            getClassLabels: () => audioModule.getClassNames()
        };
        modelType = 'audio';
        maxPredictions = audioModule.getTotalClasses();
        console.log(`✅ Local audio model loaded: ${maxPredictions} classes`);
        return model;
    }

    // Local image model trained in-app
    if (typeof modelURLorProject === 'object' && modelURLorProject.localModel) {
        const trainerModule = await import('./image-trainer.js');
        await trainerModule.loadSavedModel(modelURLorProject.localModel);

        model = {
            predict: (canvas) => trainerModule.predict(canvas),
            getTotalClasses: () => trainerModule.getTotalClasses(),
            getClassLabels: () => trainerModule.getClassNames()
        };
        modelType = 'image';
        maxPredictions = trainerModule.getTotalClasses();
        console.log(`✅ Local model loaded: ${maxPredictions} classes`);
        return model;
    }

    // Teachable Machine remote model
    const modelURL = typeof modelURLorProject === 'string'
        ? modelURLorProject
        : modelURLorProject.url;

    // Wait for TM libraries
    let attempts = 0;
    while (!window.tmImage || !window.tmPose) {
        if (attempts > 50) {
            throw new Error('Teachable Machine libraries did not load');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }

    const modelPath = modelURL.endsWith('/') ? modelURL : modelURL + '/';

    // Detect model type
    modelType = detectModelTypeFromURL(modelURL);
    console.log(`🔍 URL detection result: ${modelType || 'none'}`);

    if (!modelType) {
        modelType = await detectModelTypeFromMetadata(modelPath);
    }

    if (!modelType) {
        throw new Error('Could not detect model type');
    }

    console.log(`🔍 Final detected model type: ${modelType}`);

    const modelJsonURL = modelPath + 'model.json';
    const metadataURL = modelPath + 'metadata.json';

    // Load model based on type
    if (modelType === 'image') {
        model = await window.tmImage.load(modelJsonURL, metadataURL);
        maxPredictions = model.getTotalClasses();
    } else if (modelType === 'pose') {
        model = await window.tmPose.load(modelJsonURL, metadataURL);
        maxPredictions = model.getTotalClasses();
    } else if (modelType === 'audio') {
        // Wait for speech-commands library
        attempts = 0;
        while (!window.speechCommands) {
            if (attempts > 100) {
                throw new Error('Speech Commands library did not load');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        model = window.speechCommands.create(
            'BROWSER_FFT',
            undefined,
            modelPath + 'model.json',
            modelPath + 'metadata.json'
        );

        await model.ensureModelLoaded();
        maxPredictions = model.wordLabels().length;
    }

    console.log(`✅ Model loaded: ${modelType}, ${maxPredictions} classes`);
    return model;
}

/**
 * Get current loaded model
 */
function getModel() {
    return model;
}

/**
 * Get model type (image, pose, or audio)
 */
function getModelType() {
    return modelType;
}

/**
 * Get maximum number of prediction classes
 */
function getMaxPredictions() {
    return maxPredictions;
}

/**
 * Get class names for the loaded model
 */
function getClassNames() {
    if (!model) return [];
    if (modelType === 'audio') {
        return model.wordLabels();
    }
    // image and pose: getTotalClasses + getClassLabels (tmImage/tmPose)
    if (typeof model.getClassLabels === 'function') {
        return model.getClassLabels();
    }
    // Fallback: generate generic names
    return Array.from({ length: maxPredictions }, (_, i) => `Clase ${i + 1}`);
}

/**
 * Extract class names from a TM model URL without loading the full model.
 * Only fetches metadata.json — fast and lightweight.
 */
async function extractClassNames(modelURL) {
    const modelPath = modelURL.endsWith('/') ? modelURL : modelURL + '/';
    const response = await fetch(modelPath + 'metadata.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const metadata = await response.json();

    if (metadata.labels && metadata.labels.length) return metadata.labels;
    if (metadata.wordLabels && metadata.wordLabels.length) return metadata.wordLabels;
    if (metadata.tfjsMetadata?.labels?.length) return metadata.tfjsMetadata.labels;

    throw new Error('No se pudieron extraer las clases del modelo');
}

export { loadModel, getModel, getModelType, getMaxPredictions, getClassNames, extractClassNames };