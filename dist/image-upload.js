(function () {
  'use strict';

  async function prepareImage(file, signal) {
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image under 20 MB.');
    const localUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = localUrl;
      try { await image.decode(); } catch { throw new Error('This image could not be opened. Try a JPG, PNG or WebP file.'); }
      if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
      if (!blob || blob.size > 6 * 1024 * 1024) throw new Error('Choose a smaller image.');
      if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      return new File([blob], blob.type === 'image/webp' ? 'profile.webp' : 'profile.png', {type:blob.type});
    } finally {
      URL.revokeObjectURL(localUrl);
    }
  }

  function attach({input, upload, onBusy}) {
    const panel = document.createElement('div');
    panel.className = 'image-upload editor-wide';
    panel.innerHTML = '<div class="image-upload-preview"><img alt="Current image preview" hidden></div><div><input type="file" accept="image/*" aria-label="Choose a photo or logo" hidden><div class="image-upload-actions"><button type="button" class="secondary-button" data-upload>Upload / replace image</button><button type="button" class="secondary-button" data-clear>Remove image</button></div><p class="image-upload-status" role="status">Choose a photo or logo, then save the directory changes.</p></div>';
    input.closest('label').after(panel);
    const picker = panel.querySelector('input');
    const preview = panel.querySelector('img');
    const status = panel.querySelector('[role="status"]');
    const uploadButton = panel.querySelector('[data-upload]');
    const clearButton = panel.querySelector('[data-clear]');
    let controller = null;
    let disposed = false;
    function refreshPreview() {
      const value = input.value.trim();
      preview.hidden = !value;
      if (value) preview.src = value;
      else preview.removeAttribute('src');
    }
    preview.addEventListener('error', () => { preview.hidden = true; });
    input.addEventListener('input', refreshPreview);
    uploadButton.addEventListener('click', () => picker.click());
    clearButton.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('input', {bubbles:true}));
      status.textContent = 'Save changes to remove this image from the directory.';
    });
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file || controller) return;
      controller = new AbortController();
      uploadButton.disabled = clearButton.disabled = true;
      onBusy(true);
      try {
        status.textContent = 'Preparing image…';
        const prepared = await prepareImage(file, controller.signal);
        status.textContent = 'Uploading image…';
        const result = await upload(prepared, controller.signal);
        if (disposed || controller.signal.aborted) return;
        input.value = result.url;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        status.textContent = 'Image uploaded. Save changes to publish it in the directory.';
      } catch (error) {
        if (!disposed && error.name !== 'AbortError') status.textContent = error.message || 'The image could not be uploaded. Try again.';
      } finally {
        controller = null;
        picker.value = '';
        uploadButton.disabled = clearButton.disabled = false;
        onBusy(false);
      }
    });
    refreshPreview();
    return {
      get pending() { return Boolean(controller); },
      dispose() { disposed = true; controller?.abort(); input.removeEventListener('input', refreshPreview); panel.remove(); }
    };
  }
  window.LFMM_IMAGE_UPLOAD = {attach};
})();
