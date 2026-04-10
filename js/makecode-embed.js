/**
 * makecode-embed.js
 * Embeds MakeCode editor in an iframe and loads a pre-configured project
 * with the TM micro:bit link extension and dynamic class names.
 *
 * Supports multiple independent iframes via the optional `iframeId` parameter.
 * Each iframe has its own message handler stored in `messageHandlers`.
 */

const MAKECODE_URL = "https://makecode.microbit.org";

const MAKECODE_LOAD_TIMEOUT_MS = 8000;

// Map of iframeId → registered message handler
const messageHandlers = {};

// Map of iframeId → pending load timeout id
const pendingTimeouts = {};

// Map of iframeId → last openMakeCode params (for retry)
const lastCallParams = {};

function generateTmClassesTs(classNames) {
    const enumMembers = classNames.map((name, i) => {
        const safeName = name.charAt(0).toUpperCase() + name.slice(1).replace(/[^a-zA-Z0-9]/g, '_');
        return `    //% block="${name}"\n    ${safeName} = ${i}`;
    });
    const arrayItems = classNames.map(n => `"${n}"`).join(', ');
    return `enum TMClase {\n${enumMembers.join(',\n')}\n}\nnamespace iaMachine {\n    export const _tmClaseNombres = [${arrayItems}];\n    //% blockId=tm_clase_picker\n    //% block="$clase"\n    //% blockHidden=true\n    //% shim=TD_ID\n    export function tmClasePicker(clase: TMClase): number {\n        return clase;\n    }\n}\n`;
}

function generateProject(classNames, projectName) {
    const tmClassesTs = generateTmClassesTs(classNames);
    const pxtJson = JSON.stringify({
        "name": projectName || "proyecto-tm",
        "description": "Proyecto con Teachable Machine",
        "dependencies": {
            "core": "*",
            "bluetooth": "*",
            "pxt-tm-microbit-link": "github:snan-microbit/pxt-tm-microbit-link-v2#2999f770f1deeea37678e47c7f38ef7477627245"
        },
        "files": ["main.blocks", "main.ts", "tm-classes.ts", "README.md"],
        "yotta": { "config": { "microbit-dal": { "bluetooth": { "open": 1 } } } }
    }, null, 4);

    return {
        text: {
            "main.blocks": '<xml xmlns="http://www.w3.org/1999/xhtml">\n  <variables></variables>\n</xml>',
            "main.ts": "// Programá tu micro:bit acá\n",
            "tm-classes.ts": tmClassesTs,
            "README.md": " ",
            "pxt.json": pxtJson
        }
    };
}

/**
 * Opens MakeCode in the given iframe.
 * @param {string[]} classNames     - Class names from the TM model
 * @param {object|null} savedProject - Previously saved project or null for new
 * @param {function|null} onSave    - Callback called with the project each time MakeCode saves
 * @param {string} [projectName]    - Project name for fresh projects
 * @param {string} [iframeId]       - ID of the iframe element (default: 'makecodeFrame')
 * @param {boolean} [hideSimulator] - Whether to hide the simulator panel
 */
function openMakeCode(classNames, savedProject, onSave, projectName, iframeId = 'makecodeFrame', hideSimulator = false) {
    const iframe = document.getElementById(iframeId);
    if (!iframe) return;

    // Cache params for retry
    lastCallParams[iframeId] = { classNames, savedProject, onSave, projectName, iframeId, hideSimulator };

    // Remove any existing handler for this iframe
    if (messageHandlers[iframeId]) {
        window.removeEventListener('message', messageHandlers[iframeId]);
        delete messageHandlers[iframeId];
    }

    // Clear any pending timeout from a previous load attempt
    if (pendingTimeouts[iframeId]) {
        clearTimeout(pendingTimeouts[iframeId]);
        delete pendingTimeouts[iframeId];
    }

    // Hide any visible fallback overlay from a previous failure
    hideFallbackOverlay(iframeId);

    const handler = (event) => {
        if (event.source !== iframe.contentWindow) return;

        const data = event.data;
        if (!data || !data.type) return;

        if (data.action === 'workspacesync') {
            // First valid message from MakeCode — it loaded successfully.
            // Cancel the pending timeout.
            if (pendingTimeouts[iframeId]) {
                clearTimeout(pendingTimeouts[iframeId]);
                delete pendingTimeouts[iframeId];
            }

            let project;
            if (savedProject) {
                // Deep copy to avoid mutating caller's object
                project = { ...savedProject, text: { ...savedProject.text } };
                // Always regenerate tm-classes.ts so class names stay in sync
                project.text['tm-classes.ts'] = generateTmClassesTs(classNames);
            } else {
                project = generateProject(classNames, projectName);
            }
            const response = {
                ...data,
                type: 'pxthost',
                success: true,
                projects: [project],
                controllerId: 'tm-microbit-app',
                editor: {}
            };
            iframe.contentWindow.postMessage(response, '*');

            if (hideSimulator) {
                iframe.contentWindow.postMessage({ type: 'pxteditor', action: 'hidesimulator' }, '*');
            }
        } else if (data.action === 'workspacesave') {
            if (data.project && onSave) {
                onSave(data.project);
            }
        }
    };

    messageHandlers[iframeId] = handler;
    window.addEventListener('message', handler);

    // If we're already offline, show fallback immediately without trying.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showFallbackOverlay(iframeId);
        return;
    }

    // Set timeout: if no workspacesync arrives within MAKECODE_LOAD_TIMEOUT_MS,
    // assume MakeCode failed to load and show fallback.
    pendingTimeouts[iframeId] = setTimeout(() => {
        delete pendingTimeouts[iframeId];
        showFallbackOverlay(iframeId);
    }, MAKECODE_LOAD_TIMEOUT_MS);

    iframe.src = MAKECODE_URL + '?controller=1';
}

/**
 * Closes MakeCode: clears the iframe src, removes the message listener,
 * cancels any pending timeout, and hides the fallback overlay.
 * @param {string} [iframeId] - ID of the iframe element (default: 'makecodeFrame')
 */
function closeMakeCode(iframeId = 'makecodeFrame') {
    if (messageHandlers[iframeId]) {
        window.removeEventListener('message', messageHandlers[iframeId]);
        delete messageHandlers[iframeId];
    }
    if (pendingTimeouts[iframeId]) {
        clearTimeout(pendingTimeouts[iframeId]);
        delete pendingTimeouts[iframeId];
    }
    hideFallbackOverlay(iframeId);
    delete lastCallParams[iframeId];
    const iframe = document.getElementById(iframeId);
    if (iframe) iframe.src = 'about:blank';
}

function retryMakeCode(iframeId) {
    const params = lastCallParams[iframeId];
    if (!params) return;
    // openMakeCode will hide the overlay, clear timeouts, and start a fresh attempt.
    openMakeCode(
        params.classNames,
        params.savedProject,
        params.onSave,
        params.projectName,
        params.iframeId,
        params.hideSimulator
    );
}

function showFallbackOverlay(iframeId) {
    const iframe = document.getElementById(iframeId);
    if (!iframe) return;

    // Avoid duplicates
    const existing = document.getElementById('makecodeFallback-' + iframeId);
    if (existing) {
        existing.style.display = 'flex';
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'makecodeFallback-' + iframeId;
    overlay.className = 'makecode-fallback-overlay';
    overlay.innerHTML = `
        <div class="makecode-fallback-card">
            <h3>No se pudo cargar MakeCode</h3>
            <p>Necesitás conexión a internet para programar con bloques.<br>
            El resto de la app funciona normalmente.</p>
            <button type="button" class="btn-primary makecode-fallback-retry">
                Reintentar conexión
            </button>
        </div>
    `;

    // Position the overlay over the iframe
    const parent = iframe.parentElement;
    if (parent && getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
    }
    (parent || document.body).appendChild(overlay);

    overlay.querySelector('.makecode-fallback-retry').addEventListener('click', () => {
        retryMakeCode(iframeId);
    });
}

function hideFallbackOverlay(iframeId) {
    const overlay = document.getElementById('makecodeFallback-' + iframeId);
    if (overlay && overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
    }
}

export { openMakeCode, closeMakeCode, retryMakeCode };
