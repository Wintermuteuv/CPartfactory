import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkflowNodes, applyParams, applyInitImage, applyStyleReference,
  INIT_LOAD_ID, INIT_ENCODE_ID, STYLE_LOAD_ID, IPADAPTER_LOADER_ID, IPADAPTER_APPLY_ID,
} from '../src/comfyui/workflow.js';

// Minimal API-format text2img graph mirroring CursedPit Workflow.json.
function baseTemplate() {
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: 1, steps: 28, cfg: 6.5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
        model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'pos', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'neg', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'x', images: ['8', 0] } },
  };
}

test('img2img: injects LoadImage + VAEEncode and rewires the sampler latent', () => {
  const template = baseTemplate();
  const refs = resolveWorkflowNodes(template);
  const wf = applyInitImage(applyParams(template, refs, { denoise: 0.5 }), refs, { imageName: 'ref.png' });

  // nodes injected
  assert.equal(wf[INIT_LOAD_ID].class_type, 'LoadImage');
  assert.equal(wf[INIT_LOAD_ID].inputs.image, 'ref.png');
  assert.equal(wf[INIT_ENCODE_ID].class_type, 'VAEEncode');

  // VAEEncode pulls pixels from LoadImage and the VAE from the checkpoint (slot 2)
  assert.deepEqual(wf[INIT_ENCODE_ID].inputs.pixels, [INIT_LOAD_ID, 0]);
  assert.deepEqual(wf[INIT_ENCODE_ID].inputs.vae, [refs.checkpoint, 2]);

  // sampler now denoises from the encoded reference, not the EmptyLatentImage
  assert.deepEqual(wf[refs.sampler].inputs.latent_image, [INIT_ENCODE_ID, 0]);
  assert.equal(wf[refs.sampler].inputs.denoise, 0.5);
});

test('img2img: subfolder is prefixed into the LoadImage path', () => {
  const template = baseTemplate();
  const refs = resolveWorkflowNodes(template);
  const wf = applyInitImage(template, refs, { imageName: 'ref.png', subfolder: 'clipspace' });
  assert.equal(wf[INIT_LOAD_ID].inputs.image, 'clipspace/ref.png');
});

test('img2img: missing imageName throws', () => {
  const template = baseTemplate();
  const refs = resolveWorkflowNodes(template);
  assert.throws(() => applyInitImage(template, refs, {}), /imageName is required/);
});

test('text2img path is untouched when applyInitImage is not called', () => {
  const template = baseTemplate();
  const refs = resolveWorkflowNodes(template);
  const wf = applyParams(template, refs, { denoise: 1 });
  assert.deepEqual(wf[refs.sampler].inputs.latent_image, [refs.latent, 0]);
  assert.equal(wf[INIT_LOAD_ID], undefined);
});

test('IP-Adapter: injects loader + apply and rewires the sampler MODEL', () => {
  const template = baseTemplate();
  const refs = resolveWorkflowNodes(template);
  const wf = applyStyleReference(applyParams(template, refs, {}), refs, {
    imageName: 'style.png', weight: 0.8, weightType: 'style transfer',
  });

  // unified loader composes off the checkpoint MODEL and carries the preset
  assert.equal(wf[IPADAPTER_LOADER_ID].class_type, 'IPAdapterUnifiedLoader');
  assert.deepEqual(wf[IPADAPTER_LOADER_ID].inputs.model, [refs.checkpoint, 0]);
  assert.equal(wf[IPADAPTER_LOADER_ID].inputs.preset, 'PLUS (high strength)');

  // apply node pulls model + ipadapter from loader and image from the style LoadImage
  assert.equal(wf[STYLE_LOAD_ID].inputs.image, 'style.png');
  assert.deepEqual(wf[IPADAPTER_APPLY_ID].inputs.model, [IPADAPTER_LOADER_ID, 0]);
  assert.deepEqual(wf[IPADAPTER_APPLY_ID].inputs.ipadapter, [IPADAPTER_LOADER_ID, 1]);
  assert.deepEqual(wf[IPADAPTER_APPLY_ID].inputs.image, [STYLE_LOAD_ID, 0]);
  assert.equal(wf[IPADAPTER_APPLY_ID].inputs.weight, 0.8);
  assert.equal(wf[IPADAPTER_APPLY_ID].inputs.weight_type, 'style transfer');

  // sampler now runs the IP-Adapter-patched model
  assert.deepEqual(wf[refs.sampler].inputs.model, [IPADAPTER_APPLY_ID, 0]);
});

test('IP-Adapter stacks on top of img2img (MODEL and LATENT both rewired)', () => {
  const template = baseTemplate();
  const refs = resolveWorkflowNodes(template);
  let wf = applyParams(template, refs, { denoise: 0.5 });
  wf = applyInitImage(wf, refs, { imageName: 'ref.png' });
  wf = applyStyleReference(wf, refs, { imageName: 'style.png' });

  // latent comes from the img2img encode, model from the IP-Adapter patch
  assert.deepEqual(wf[refs.sampler].inputs.latent_image, [INIT_ENCODE_ID, 0]);
  assert.deepEqual(wf[refs.sampler].inputs.model, [IPADAPTER_APPLY_ID, 0]);
  // IP-Adapter loader still composes off the original checkpoint MODEL
  assert.deepEqual(wf[IPADAPTER_LOADER_ID].inputs.model, [refs.checkpoint, 0]);
});

test('IP-Adapter: missing imageName throws', () => {
  const template = baseTemplate();
  const refs = resolveWorkflowNodes(template);
  assert.throws(() => applyStyleReference(template, refs, {}), /imageName is required/);
});
