/**
 * Pinned NER model. The model is NEVER packaged; the user opts in to download
 * it from this exact revision, and every file is SHA-256 verified before it is
 * stored. Changing the model means changing this file in a reviewed commit.
 *
 * LFS sha256 for the .onnx comes from the HF API (?blobs=true); the others were
 * computed from the files at this revision.
 */
export const NER_MODEL_ID = 'Xenova/bert-base-multilingual-cased-ner-hrl';
export const NER_REVISION = '263e82c06569c8c2ac46238a7ae5107598934234';
/**
 * Test hook: e2e builds may point at a loopback server (WXT_NER_HOST). Anything
 * that is not loopback is ignored, so a release can only ever fetch from HF.
 */
const override = (import.meta as { env?: Record<string, string | undefined> }).env?.WXT_NER_HOST;
export const NER_HOST =
  override && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(override)
    ? override
    : 'https://huggingface.co';

export interface NerFile {
  path: string;
  bytes: number;
  sha256: string;
}

export const NER_FILES: readonly NerFile[] = [
  { path: 'config.json', bytes: 1207, sha256: '7aa891abae067f95a40f5e2005b3de44824a083f256802934a993d301ec25076' },
  { path: 'tokenizer.json', bytes: 2919362, sha256: 'bf1b59b7b11c95f194f51708d918eea378e09d05f84c0e1656dc5180e8117088' },
  { path: 'tokenizer_config.json', bytes: 367, sha256: 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a' },
  { path: 'onnx/model_quantized.onnx', bytes: 178495423, sha256: '5b65139844be260b624a2a13782b01d122e613d64ce16ed0ba4d82e0b816f1a9' },
];

export const NER_TOTAL_BYTES = NER_FILES.reduce((n, f) => n + f.bytes, 0);

export const nerFileUrl = (path: string) =>
  `${NER_HOST}/${NER_MODEL_ID}/resolve/${NER_REVISION}/${path}`;
