/**
 * makecode-embed.js
 * Embeds MakeCode editor in an iframe and loads a pre-configured project
 * with the TM micro:bit link extension and dynamic class names.
 *
 * Supports multiple independent iframes via the optional `iframeId` parameter.
 * Each iframe has its own message handler stored in `messageHandlers`.
 */

const MAKECODE_URL = "https://makecode.microbit.org";

// Map of iframeId → registered message handler
const messageHandlers = {};

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
 */
function openMakeCode(classNames, savedProject, onSave, projectName, iframeId = 'makecodeFrame', hideSimulator = false) {
    const iframe = document.getElementById(iframeId);
    if (!iframe) return;

    // Remove any existing handler for this iframe
    if (messageHandlers[iframeId]) {
        window.removeEventListener('message', messageHandlers[iframeId]);
        delete messageHandlers[iframeId];
    }

    const handler = (event) => {
        if (event.source !== iframe.contentWindow) return;

        const data = event.data;
        if (!data || !data.type) return;

        if (data.action === 'workspacesync') {
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
    iframe.src = MAKECODE_URL + '?controller=1';
}

/**
 * Closes MakeCode: clears the iframe src and removes the message listener.
 * @param {string} [iframeId] - ID of the iframe element (default: 'makecodeFrame')
 */
function closeMakeCode(iframeId = 'makecodeFrame') {
    if (messageHandlers[iframeId]) {
        window.removeEventListener('message', messageHandlers[iframeId]);
        delete messageHandlers[iframeId];
    }
    const iframe = document.getElementById(iframeId);
    if (iframe) iframe.src = 'about:blank';
}

export { openMakeCode, closeMakeCode };
