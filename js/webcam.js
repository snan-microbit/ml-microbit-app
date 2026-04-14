/**
 * webcam.js
 * Lightweight webcam wrapper. Uses getUserMedia directly.
 * Canvas is always square — center-cropped from the camera's native resolution.
 * What the user sees = what the model trains on.
 */

export class Webcam {
    /**
     * @param {boolean} flip - Mirror horizontally (true for front camera)
     */
    constructor(flip = true) {
        this.flip = flip;
        this.width = 400;
        this.height = 400;

        // Crop offset (set after play when real resolution is known)
        this._sx = 0;
        this._sy = 0;
        this._side = 400;

        this._canvas = document.createElement('canvas');
        this._canvas.width = this.width;
        this._canvas.height = this.height;

        this._video = document.createElement('video');
        this._video.setAttribute('playsinline', '');
        this._video.setAttribute('autoplay', '');
        this._video.muted = true;

        this._stream = null;
        this._ctx = this._canvas.getContext('2d');
    }

    get canvas() {
        return this._canvas;
    }

    get video() {
        return this._video;
    }

    async setup(facingMode = 'user') {
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._video.srcObject = null;
            await new Promise(r => setTimeout(r, 200));
        }

        this._stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: facingMode,
                width: { ideal: 640 }
            }
        });

        this._video.srcObject = this._stream;
    }

    /**
     * Start playback and adapt canvas to a centered square crop
     * of the camera's native resolution.
     */
    async play() {
        await this._video.play();

        const vw = this._video.videoWidth;
        const vh = this._video.videoHeight;
        if (vw && vh) {
            this._side = Math.min(vw, vh);
            this._sx = Math.round((vw - this._side) / 2);
            this._sy = Math.round((vh - this._side) / 2);

            this.width = this._side;
            this.height = this._side;
            this._canvas.width = this._side;
            this._canvas.height = this._side;
        }
    }

    /**
     * Draw the current video frame onto the canvas with center-crop.
     * The result is always a square image.
     */
    update() {
        if (!this._video.srcObject) return;

        if (this.flip) {
            this._ctx.save();
            this._ctx.translate(this.width, 0);
            this._ctx.scale(-1, 1);
            this._ctx.drawImage(
                this._video,
                this._sx, this._sy, this._side, this._side,
                0, 0, this.width, this.height
            );
            this._ctx.restore();
        } else {
            this._ctx.drawImage(
                this._video,
                this._sx, this._sy, this._side, this._side,
                0, 0, this.width, this.height
            );
        }
    }

    stop() {
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }
        this._video.srcObject = null;
    }
}
