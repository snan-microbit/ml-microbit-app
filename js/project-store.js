/**
 * project-store.js
 * Project persistence — CRUD operations on localStorage
 */

const MODELS_KEY = 'tm_microbit_models';

export function loadModels() {
    const stored = localStorage.getItem(MODELS_KEY);
    return stored ? JSON.parse(stored) : [];
}

export function saveModels(models) {
    localStorage.setItem(MODELS_KEY, JSON.stringify(models));
}

export function addProject(name, projectType) {
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

export async function deleteProject(id, trainerModules) {
    const models = loadModels();
    const project = models.find(m => m.id === id);

    if (project?.localModel?.storageKey) {
        const { trainer, audioTrainer, poseTrainer } = trainerModules;
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

export function updateProjectMakeCode(id, makecodeProject) {
    const models = loadModels();
    const model = models.find(m => m.id === id);
    if (model) {
        model.makecodeProject = makecodeProject;
        model.lastUsed = new Date().toISOString();
        saveModels(models);
    }
}

export function updateProjectModel(id, localModelInfo) {
    const models = loadModels();
    const project = models.find(m => m.id === id);
    if (project) {
        project.localModel = localModelInfo;
        project.classNames = localModelInfo.classNames;
        saveModels(models);
        return project;
    }
    return null;
}
