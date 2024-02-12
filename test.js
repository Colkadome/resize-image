// test.js

import { resizeImageToBlob } from './index.js';

/**
 * HTML elements.
 */
const jpegImageEl = document.getElementById('jpeg-image');
const pngImageEl = document.getElementById('png-image');
const testResultsEl = document.getElementById('test-results');
const testButtonEl = document.getElementById('test-button');

/**
 * List of all tests.
 */
const ALL_RESIZE_TESTS = [
  {
    name: 'Stretch',
    options: { fit: 'stretch', width: 100, height: 50 },
  },
  {
    name: 'Auto Width',
    options: { height: 50 },
  },
  {
    name: 'Auto Height',
    options: { width: 50 },
  },
  {
    name: 'Outside',
    options: { width: 100, height: 50, fit: 'outside' },
  },
  {
    name: 'cover',
    options: { width: 100, height: 50, fit: 'cover' },
  },
  {
    name: 'Inside',
    options: { width: 100, height: 50, fit: 'inside' },
  },
  {
    name: 'Contain',
    options: { width: 100, height: 50, fit: 'contain' },
  },
  {
    name: 'Large',
    options: { width: 512, height: 512, fit: 'contain' },
  },
  {
    name: 'Medium',
    options: { width: 256, height: 256, fit: 'contain' },
  },
  {
    name: 'Small',
    options: { width: 128, height: 128, fit: 'contain' },
  },
  {
    name: 'V Small',
    options: { width: 64, height: 64, fit: 'contain' },
  },
  {
    name: 'Icon',
    options: { width: 32, height: 32, fit: 'contain' },
  },
];

/**
 * Runs a single resize test.
 */
async function runSingleTest(name, img, options) {

  const result = [name];

  // Resize.
  result.push(
    await resizeImageToBlob(img, options).then(blob => {
      const image = new Image();
      image.src = URL.createObjectURL(blob);
      return image;
    }).catch(err => err.message)
  );

  // Resize with smoothing.
  result.push(
    await resizeImageToBlob(img, { ...options, smoothen: true }).then(blob => {
      const image = new Image();
      image.src = URL.createObjectURL(blob);
      return image;
    }).catch(err => err.message)
  );

  addResultToTable(result);

}

/**
 * Records the results to the table.
 */
function addResultToTable(result) {
  if (testResultsEl) {
    const rowEl = testResultsEl.insertRow();
    for (const item of result) {
      const cellEl = rowEl.insertCell();
      if (item instanceof HTMLElement) {
        cellEl.appendChild(item);
      } else {
        cellEl.textContent = item;
      }
    }
  }
}

/**
 * Runs all tests.
 */
async function runAllTests() {

  // Resize tests.
  for (const test of ALL_RESIZE_TESTS) {
    await runSingleTest(`JPEG ${test.name}`, jpegImageEl, test.options);
    await runSingleTest(`PNG ${test.name}`, pngImageEl, test.options);
  }

  // Data type tests.
  await runSingleTest('JPEG Blob', await fetch(jpegImageEl.src).then(res => res.blob()), null);
  await runSingleTest('PNG Blob', await fetch(pngImageEl.src).then(res => res.blob()), null);
  await runSingleTest('JPEG src', jpegImageEl.src, null);
  await runSingleTest('PNG src', pngImageEl.src, null);

  // Error tests.
  await runSingleTest('Error Blob', new Blob([]), null);
  await runSingleTest('Error Blob 2', new Blob(['xwerfxwerfxw']), null);
  await runSingleTest('Large ICO', jpegImageEl, { width: 300, height: 300, type: 'image/vnd.microsoft.icon' });

}

/**
 * Test button click.
 */
if (testButtonEl) {
  testButtonEl.disabled = false;
	testButtonEl.addEventListener('click', function (event) {
    testButtonEl.disabled = true;
    runAllTests().finally(() => {
      testButtonEl.disabled = false;
    });
  }, false);
}