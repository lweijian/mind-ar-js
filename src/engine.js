const {ImageTarget} = require('./image-target/index.js');
const {Detector} = require('./image-target/detectorGPU/detector.js');
//const {Detector} = require('./image-target/detectorCPU/detector.js');

class Engine {
  constructor(options) {
    this.inputWidth = options.inputWidth;
    this.inputHeight = options.inputHeight;
    this.detector = new Detector(this.inputWidth, this.inputHeight);
    this._imageTargets = [];

    const near = 10;
    const far = 1000;
    const fovy = 45.0 * Math.PI / 180; // 45 in radian. field of view vertical
    const f = (this.inputHeight/2) / Math.tan(fovy/2);
    //     [fx  s cx]
    // K = [ 0 fx cy]
    //     [ 0  0  1]
    this._projectionTransform = [
      [f, 0, this.inputWidth / 2],
      [0, f, this.inputHeight / 2],
      [0, 0, 1]
    ];
    console.log("project transform", JSON.stringify(this._projectionTransform));

    this._projectionMatrix = _glProjectionMatrix({
      projectionTransform: this._projectionTransform,
      width: this.inputWidth - 1, // -1 is not necessary?
      height: this.inputHeight - 1,
      near: near,
      far: far,
    });

    const processCanvas = document.createElement('canvas');
    processCanvas.width = this.inputWidth;
    processCanvas.height = this.inputHeight;
    this.workerProcessContext = processCanvas.getContext('2d');
    this.processData = new Uint8Array(this.inputWidth * this.inputHeight);
  }

  getProjectionMatrix() {
    return this._projectionMatrix;
  }

  addImageTarget(options) {
    const imageTarget = new ImageTarget(Object.assign({projectionTransform: this._projectionTransform}, options));
    imageTarget.setupQuery(this.inputWidth, this.inputHeight);
    this._imageTargets.push(imageTarget);
  }

  process(video) {
    logTime("engine process");

    let featurePoints = null;
    let queryImage = null;

    this._imageTargets.forEach((imageTarget) => {
      if (!imageTarget.isTracking) {
        if (featurePoints === null) {
          featurePoints = this.detector.detectVideo(video);
        }
        imageTarget.match(this.inputWidth, this.inputHeight, featurePoints);
      }
    });

    const result = [];
    this._imageTargets.forEach((imageTarget) => {
      let worldMatrix = null;
      if (imageTarget.isTracking) {
        if (queryImage === null) {
          queryImage = this._buildQueryImage(video);
        }

        const modelViewTransform = imageTarget.track(queryImage, video);
        worldMatrix = modelViewTransform === null? null: _glModelViewMatrix({modelViewTransform});
      }
      result.push({
        worldMatrix: worldMatrix
      })
    });

    // for debugging now.
    this._imageTargets.forEach((imageTarget) => {
      //imageTarget.isTracking = false;
    });

    return result;
  }

  _buildQueryImage(video) {
    this.workerProcessContext.drawImage(video, 0, 0, this.inputWidth, this.inputHeight);
    const imageData = this.workerProcessContext.getImageData(0, 0, this.inputWidth, this.inputHeight);
    for (let i = 0; i < this.processData.length; i++) {
      const offset = i * 4;
      this.processData[i] = Math.floor((imageData.data[offset] + imageData.data[offset+1] + imageData.data[offset+2])/3);
    }
    const queryImage = {data: this.processData, width: this.inputWidth, height: this.inputHeight, dpi: 1};
    return queryImage;
  }
}

// build openGL modelView matrix
const _glModelViewMatrix = ({modelViewTransform}) => {
  const openGLWorldMatrix = [
    modelViewTransform[0][0], -modelViewTransform[1][0], -modelViewTransform[2][0], 0,
    modelViewTransform[0][1], -modelViewTransform[1][1], -modelViewTransform[2][1], 0,
    modelViewTransform[0][2], -modelViewTransform[1][2], -modelViewTransform[2][2], 0,
    modelViewTransform[0][3], -modelViewTransform[1][3], -modelViewTransform[2][3], 1
  ];
  return openGLWorldMatrix;
}

// build openGL projection matrix
const _glProjectionMatrix = ({projectionTransform, width, height, near, far}) => {
  const proj = [
    [2 * projectionTransform[0][0] / width, 0, -(2 * projectionTransform[0][2] / width - 1), 0],
    [0, 2 * projectionTransform[1][1] / height, -(2 * projectionTransform[1][2] / height - 1), 0],
    [0, 0, -(far + near) / (far - near), -2 * far * near / (far - near)],
    [0, 0, -1, 0]
  ];

  const projMatrix = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      projMatrix.push(proj[j][i]);
    }
  }
  return projMatrix;
}

module.exports = {
  Engine,
}
