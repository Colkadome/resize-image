// index.js

/**
 * Constants.
 */
const UNDEF = 'undefined';

/**
 * Custom error class for this library.
 */
class ResizeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResizeError';
  }
}

/**
 * Returns WebWorker code required for OffscreenCanvas resizing.
 */
function getWebWorkerCode() {

  // TODO: Potentially allow a resize in here with createImageBitmap for a small range of older browser versions?
  // It's incredibly slow for Firefox though.

  return `self.addEventListener('message', function(event) {
  
  const id = event.data.id;

  if (event.data.__isTest) {
    self.postMessage({ id: id });
    return;
  }

  try {

    let img = event.data.img;
    const fit = event.data.fit;
    const opts = event.data.opts;

    const canvasEl = new OffscreenCanvas(fit.cw, fit.ch);
    const ctx = canvasEl.getContext('2d', { alpha: opts.alpha });

    if (opts.smoothen) {
      if (typeof ctx.imageSmoothingQuality !== 'undefined') {
        ctx.imageSmoothingQuality = 'high';
      }
      if (typeof ctx.filter !== 'undefined') {
        const steps = (Math.min(img.width / fit.iw, img.height / fit.ih) - 1) * 0.375;
        if (steps > 0) {
          const tempEl = new OffscreenCanvas(img.width, img.height);
          const tempCtx = tempEl.getContext('2d', { alpha: true, desynchronized: true });
          tempCtx.filter = 'blur(' + steps + 'px)';
          tempCtx.drawImage(img, 0, 0);
          img = tempEl;
        }
      } else {
        // TODO.
      }
    }

    if (opts.background) {
      ctx.fillStyle = args.background;
      ctx.fillRect(0, 0, fit.cw, fit.ch);
    }
    
    ctx.drawImage(img, fit.ix, fit.iy, fit.iw, fit.ih);

    const blobOpts = {
      type: opts.type,
      quality: opts.quality
    };

    (canvasEl.convertToBlob || canvasEl.toBlob).call(canvasEl, blobOpts).then(blob => {
      self.postMessage({ id: id, result: blob });
    }).catch(err => {
      self.postMessage({ id: id, error: err });
    });

  } catch (err) {

    self.postMessage({ id: id, error: err });

  }

});`;
}

/**
 * Creates a Worker with the given string.
 * 
 * @param {string} codeStr - Code for the worker.
 * @returns {Worker}
 */
function createWebWorker(codeStr, opts) {
  const url = URL.createObjectURL(new Blob([codeStr]));
  try {
    return new Worker(url, opts);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Loads the WebWorker required for resize, and caches it.
 * 
 * @returns {Worker}
 */
let _worker = null;
let _workerError = null;
async function loadWebWorker() {
  if (_workerError) {
    
    throw new ResizeError('Worker is not loaded');

  } else if (_worker) {

    return _worker;

  } else {
    try {

      // TODO: Clean this code up.

      await new Promise((resolve, reject) => {

        const id = '_test';

        _worker = createWebWorker(getWebWorkerCode(), { name: 'resize-image' });

        function handleResult(error) {
          _worker.removeEventListener('message', handleMessage);
          _worker.removeEventListener('error', handleError);
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }

        function handleMessage(event) {
          if (event.data.id === id) {
            handleResult();
          }
        }

        function handleError(error) {
          handleResult(error);
        }

        _worker.addEventListener('message', handleMessage);
        _worker.addEventListener('error', handleError);
        _worker.postMessage({ id, __isTest: true });

      });

      return _worker;

    } catch (err) {

      _workerError = err;
      throw err;

    }
  }
}

/**
 * Renders to an offscreen canvas.
 * 
 * @param {Any} imageSource
 * @param {Object} options - Options for rendering to the canvas.
 * @returns {Blob} 
 */
let _messageId = 0;
async function renderToBlobWithOffscreenCanvas(img, fit, opts) {

  // Attempt to create the WebWorker.

  const worker = await loadWebWorker();

  // Make "img" into a transferable object.
  // We do this even if "img" is already transferable, so that the original "img"
  // doesn't become unusable after transfer.

  img = await createImageBitmap(img);

  try {

    // Get a unique ID for this message to the worker.

    const id = _messageId;
    _messageId += 1;

    // Post the message and await a response.

    return await new Promise((resolve, reject) => {

      function handleMessage(event) {
        if (event.data.id === id) {
          worker.removeEventListener('message', handleMessage);
          if (event.data.error) {
            reject(event.data.error);
          } else {
            resolve(event.data.result);
          }
        }
      }
      
      worker.addEventListener('message', handleMessage);
      worker.postMessage({ id, img, fit, opts }, [img]);

    });

  } finally {

    img.close();

  }
}

/**
 * Gets Y gravity value from a string.
 * 
 * @param {string} gravity
 * @returns {Number}
 */
function getYGravity(gravity) {
  if (typeof gravity === 'string') {
    gravity = gravity.toLowerCase();
    if (gravity.includes('north') || gravity.includes('top')) {
      return -1;
    } else if (gravity.includes('south') || gravity.includes('bottom')) {
      return 1;
    }
  }
  return 0;
}

/**
 * Gets X gravity value from a string.
 * 
 * @param {string} gravity
 * @returns {Number}
 */
function getXGravity(gravity) {
  if (typeof gravity === 'string') {
    gravity = gravity.toLowerCase();
    if (gravity.includes('east') || gravity.includes('left')) {
      return -1;
    } else if (gravity.includes('west') || gravity.includes('right')) {
      return 1;
    }
  }
  return 0;
}

/**
 * Parses a number argument. If the argument is invalid, or not provided, returns "default".
 * 
 * @param {Any} n - number to check.
 * @returns {Number}
 */
function parseNumberArg(n, defaultValue = 0) {
  n = n != null && Number(n);
  return typeof n === 'number' && !isNaN(n) ? n : defaultValue;
}

/**
 * Checks if output type might have alpha.
 * 
 * @param {string} type - MIME type.
 * @returns {Boolean}
 */
function typeSupportsAlpha(type) {
  return type !== 'image/jpeg';
}

/**
 * Gets main options argument with default values.
 * 
 * @param {Object} [options] - Inputted options for resize.
 * @returns {Object} Options with defaults.
 */
function validateOptions(opts) {
  opts = { ...opts };
  return {
    type: opts.type || 'image/jpeg',
    alpha: typeSupportsAlpha(opts.type),
    width: Math.max(Math.round(parseNumberArg(opts.width)), 0),
    height: Math.max(Math.round(parseNumberArg(opts.height)), 0),
    quality: Math.min(Math.max(parseNumberArg(opts.quality, 1), 0), 1),
    xGravity: getYGravity(opts.gravity),
    yGravity: getXGravity(opts.gravity),
    fit: typeof opts.fit === 'string' && opts.fit.length > 0 ? opts.fit.toLowerCase() : 'stretch',
    noEnlarge: opts.noEnlarge === true,
    smoothen: opts.smoothen === true,
  };
}

/**
 * Gets main resize options argument with default values.
 * If the options will result in an empty image, null is returned.
 * 
 * @param {Any} img - Drawable image.
 * @param {Object} [opts] - Inputted options for resize.
 * @returns {Object} Options with defaults.
 */
function validateImageFit(img, opts) {

  // Check for image dimensions, which are hopefully known at this point.

  const { width, height } = getImageDimensions(img);
  if (!width || !height) {
    throw new ResizeError('Image dimensions could not be determined');
  }

  let cw = opts.width;
  let ch = opts.height;
  let iw = width;
  let ih = height;
  let fit = opts.fit;

  // If width or height are not provided, fill them in using aspect ratio.

  if (!cw || !ch) {
    fit = 'stretch';
    if (cw) {
      ch = (cw / iw) * ih;
    } else if (ch) {
      cw = (ch / ih) * iw;
    } else {
      cw = iw;
      ch = ih;
    }
  }

  // Get canvas and image dimensions.

  if (fit === 'outside' || fit === 'cover') {
    const scale = Math.max(cw / iw, ch / ih);
    iw *= scale;
    ih *= scale;
  } else if (fit === 'inside' || fit === 'contain') {
    const scale = Math.min(cw / iw, ch / ih);
    iw *= scale;
    ih *= scale;
  } else {
    iw = cw;
    ih = ch;
  }
  if (fit === 'outside' || fit === 'inside') {
    cw = iw;
    ch = ih;
  }

  // If no enlargement and a dimension is larger, scale image down to fit.

  if (opts.noEnlarge) {
    const scale = Math.min(width / iw, height / ih);
    if (scale < 1) {
      iw *= scale;
      ih *= scale;
      cw *= scale;
      ch *= scale;
    }
  }

  // Get offsets.

  let ix = (cw - iw) * 0.5 * (opts.xGravity + 1);
  let iy = (ch - ih) * 0.5 * (opts.yGravity + 1);

  // Round values.
  // TODO: Check if there's a better way to round. Maybe floor with some tolerance?

  cw = Math.round(cw);
  ch = Math.round(ch);
  iw = Math.round(iw);
  ih = Math.round(ih);
  ix = Math.round(ix);
  iy = Math.round(iy);

  // Check image dimensions.

  if (opts.type === 'image/vnd.microsoft.icon' && (cw > 256 || ch > 256)) {
    throw new ResizeError('Exceeds max ICO size (256x256)');
  }

  return {
    imageWidth: width,
    imageHeight: height,
    cw, ch,
    iw, ih,
    ix, iy
  };
}

/**
 * Renders to a canvas with smoothing.
 * 
 * Steps are set to roughly match downscaling appearance in Safari,
 * or when the corresponding image is reduced in size with CSS.
 * 
 * @param {Any} img
 * @returns {HTMLCanvasElement} 
 */
function getBlurredImage(img, fit, opts) {

  // TODO: Do some research here on actual step count required.

  const steps = (Math.min(fit.imageWidth / fit.iw, fit.imageHeight / fit.ih) - 1) * 0.375;
  if (steps <= 0) {
    return img;
  }

  const canvasEl = document.createElement('canvas');
  canvasEl.width = fit.imageWidth;
  canvasEl.height = fit.imageHeight;

  const ctx = canvasEl.getContext('2d', { alpha: true, desynchronized: true });
  ctx.filter = `blur(${steps}px)`;
  ctx.drawImage(img, 0, 0);
  return canvasEl;

}

/**
 * Renders to a canvas with smoothing.
 * 
 * @param {Any} img
 * @returns {HTMLCanvasElement} 
 */
function getSteppedImage(img, fit, opts) {

  // TODO: Step down canvas over and over here to achieve better results.

  return img;

}

/**
 * Renders to a regular canvas.
 * 
 * @param {Any} img
 * @param {Object} opts - Options for rendering to the canvas.
 * @returns {HTMLCanvasElement} 
 */
function renderToCanvas(img, fit, opts) {

  const canvasEl = document.createElement('canvas');
  canvasEl.width = fit.cw;
  canvasEl.height = fit.ch;
  const ctx = canvasEl.getContext('2d', { alpha: opts.alpha, desynchronized: true });

  // Smooth the input image if specified.
  // Safari smooths images well if scaling down, so this won't have much of an effect on Safari.
  // TODO: Ignore for Safari?

  if (opts.smoothen) {

    // Enable image smoothing if it's supported. This is mainly for scaling up.

    if (typeof ctx.imageSmoothingQuality !== UNDEF) {
      ctx.imageSmoothingQuality = 'high';
    }

    // Scale down with blurring.

    if (typeof ctx.filter !== UNDEF) {
      img = getBlurredImage(img, fit, opts);
    } else {
      img = getSteppedImage(img, fit, opts);
    }
  }

  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, fit.cw, fit.ch);
  }
  ctx.drawImage(img, fit.ix, fit.iy, fit.iw, fit.ih);
  return canvasEl;

}

/**
 * Loads a canvas from ImageData
 * 
 * @param {ImageData} imageData
 * @returns {HTMLCanvasElement}
 */
function loadImageDataIntoCanvas(imageData, opts) {
  
  const canvasEl = document.createElement('canvas');
  canvasEl.width = imageData.width;
  canvasEl.height = imageData.height;
  
  const ctx = canvasEl.getContext('2d', { alpha: opts.alpha, desynchronized: true });
  ctx.putImageData(imageData, 0, 0);
  
  return canvasEl;

}

/**
 * Gets a blob from a canvas.
 * 
 * @param {HTMLCanvasElement} canvasEl
 * @returns {Blob} 
 */
function getBlobFromCanvas(canvasEl, type, quality) {
  return new Promise((resolve, reject) => {
    canvasEl.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new ResizeError('Could not create Blob'));
      }
    }, type, quality);
  });
}

/**
 * Loads an URL into an image.
 * 
 * @param {string} url
 * @returns {Image}
 */
function loadUrlIntoImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve(img);
      } else {
        reject(new ResizeError('Image is empty'));
      }
    };
    img.onerror = () => {
      reject(new ResizeError('Image could not be loaded'));
    };
    img.src = url;
  });
}

/**
 * Loads a blob into an image.
 * 
 * @param {Blob} blob
 * @returns {Image}
 */
async function loadBlobIntoImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await loadUrlIntoImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Gets dimensions of an image source.
 * 
 * @param {Any} img
 * @returns {Object} Object containing width and height. 
 */
function getImageDimensions(img) {
  if (typeof HTMLImageElement !== UNDEF && img instanceof HTMLImageElement) {
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  } else if (typeof HTMLVideoElement !== UNDEF && img instanceof HTMLVideoElement) {
    return {
      width: img.videoWidth,
      height: img.videoHeight,
    };
  } else if (typeof VideoFrame !== UNDEF && img instanceof VideoFrame) {
    return {
      width: img.displayWidth,  // TODO: Use this or codecWidth ?
      height: img.displayHeight,
    };
  } else {
    return {
      width: img.width || 0,
      height: img.height || 0,
    };
  }
}

/**
 * Checks if something is drawable synchronously to a canvas, without requiring conversion.
 * 
 * Types gotten from:
 * https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage
 * 
 * @param {Any} img
 * @returns {Boolean} 
 */
function isDrawable(img) {
  return (typeof HTMLImageElement !== UNDEF && img instanceof HTMLImageElement)
    || (typeof SVGImageElement !== UNDEF && img instanceof SVGImageElement)
    || (typeof HTMLVideoElement !== UNDEF && img instanceof HTMLVideoElement)
    || (typeof HTMLCanvasElement !== UNDEF && img instanceof HTMLCanvasElement)
    || (typeof ImageBitmap !== UNDEF && img instanceof ImageBitmap)
    || (typeof OffscreenCanvas !== UNDEF && img instanceof OffscreenCanvas)
    || (typeof VideoFrame !== UNDEF && img instanceof VideoFrame);
}

/**
 * Ensures something is drawable to a canvas.
 * 
 * @param {Any} img
 * @returns {Any} drawable img.
 * @throws {Error} if img cannot be made drawable.
 */
async function validateImageAndMakeDrawable(img, opts) {

  if (!img) {
    throw new ResizeError('Image is required');
  }

  if (isDrawable(img)) {
    return img;
  }

  const isBlob = typeof Blob !== UNDEF && img instanceof Blob;
  const isImageData = typeof ImageData !== UNDEF && img instanceof ImageData;

  if (isBlob && img.size === 0) {
    
    throw new ResizeError('Blob is empty');

  } else if (typeof createImageBitmap === 'function' && (isBlob || isImageData)) {
    
    return createImageBitmap(img);

  } else if (isBlob) {

    return loadBlobIntoImage(img);
  
  } else if (isImageData) {
  
    return loadImageDataIntoCanvas(img, opts);
  
  } else if (typeof img === 'string' && img.length > 0) {
  
    return loadUrlIntoImage(img);
  
  } else {

    throw new ResizeError('Cannot make drawable');

  }
}

/**
 * Resizes an image asynchronously to a blob.
 * 
 * @param {Any} img
 * @param {Object} [opts] - Options for resize.
 * @returns {Promise<Blob>} 
 */
async function resizeImageToBlob(img, opts) {

  opts = validateOptions(opts);
  img = await validateImageAndMakeDrawable(img, opts);
  const fit = validateImageFit(img, opts);

  // Attempt to draw to an OffscreenCanvas first. This will be slower, but will stop
  // a lot of jank while the user is using the page.

  if (typeof OffscreenCanvas !== 'undefined' && !_workerError) {
    try {
      return await renderToBlobWithOffscreenCanvas(img, fit, opts);
    } catch (err) {
      // Ignore error.
    }
  }

  // As a backup, render to a regular canvas.

  const canvasEl = renderToCanvas(img, fit, opts);
  return getBlobFromCanvas(canvasEl, opts.type, opts.quality);

}

/**
 * Exports.
 */
export default resizeImageToBlob;
export { resizeImageToBlob };