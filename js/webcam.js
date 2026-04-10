/**
 * webcam.js
 * Lightweight webcam wrapper. Drop-in replacement for tmImage.Webcam.
 * Uses getUserMedia directly — no TM dependency.
 */

export class Webcam {
    /**
     * @param {number} width  - Canvas width  (default 400)
     * @param {number} height - Canvas height (default 400)
     * @param {boolean} flip  - Mirror horizontally (true for front camera)
     */
    constructor(width = 400, height = 400, flip = true) {
        this.width = width;
        this.height = height;
        this.flip = flip;

        this._canvas = document.createElement('canvas');
        this._canvas.width = width;
        this._canvas.height = height;

        this._video = document.createElement('video');
        this._video.setAttribute('playsinline', '');
        this._video.setAttribute('autoplay', '');
        this._video.muted = true;
        this._video.width = width;
        this._video.height = height;

        this._stream = null;
        this._ctx = this._canvas.getContext('2d');
    }

    /** The HTMLCanvasElement with the current frame. */
    get canvas() {
        return this._canvas;
    }

    /** The internal HTMLVideoElement (needed by MediaPipe detectForVideo). */
    get video() {
        return this._video;
    }

    /**
     * Request camera access.
     * @param {'user'|'environment'} [facingMode='user']
     */
    async setup(facingMode = 'user') {
        // If switching cameras, stop any existing stream first
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._video.srcObject = null;
            // Android needs time to release hardware
            await new Promise(r => setTimeout(r, 200));
        }

        this._stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: facingMode,
                width: { ideal: this.width },
                height: { ideal: this.height }
            }
        });

        this._video.srcObject = this._stream;
    }

    /** Start video playback. Call after setup(). */
    async play() {
        await this._video.play();
    }

    /**
     * Draw the current video frame onto the canvas.
     * Call once per requestAnimationFrame before reading .canvas.
     */
    update() {
        if (!this._video.srcObject) return;

        if (this.flip) {
            this._ctx.save();
            this._ctx.translate(this.width, 0);
            this._ctx.scale(-1, 1);
            this._ctx.drawImage(this._video, 0, 0, this.width, this.height);
            this._ctx.restore();
        } else {
            this._ctx.drawImage(this._video, 0, 0, this.width, this.height);
        }
    }

    /** Stop camera, release hardware. */
    stop() {
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }
        this._video.srcObject = null;
    }
}
