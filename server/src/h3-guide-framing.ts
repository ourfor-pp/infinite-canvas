import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
// Match Python round used by the installed ComfyUI common_upscale.
const roundEven = (n: number) => n % 1 === 0.5 ? 2 * Math.round(n / 2) : Math.round(n);
export function guideCrop(width: number, height: number, targetWidth: number, targetHeight: number) {
  if (![width, height, targetWidth, targetHeight].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid image dimensions');
  const x = width / height > targetWidth / targetHeight ? roundEven((width - height * targetWidth / targetHeight) / 2) : 0;
  const y = width / height < targetWidth / targetHeight ? roundEven((height - width * targetHeight / targetWidth) / 2) : 0;
  return { x, y, width: width - 2 * x, height: height - 2 * y };
}
export async function inspectGuide(path: string, targetWidth: number, targetHeight: number) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path], { timeout: 10000, maxBuffer: 65536 });
  const { width, height } = JSON.parse(stdout).streams[0];
  return { input: { width, height }, target: { width: targetWidth, height: targetHeight }, crop: guideCrop(width, height, targetWidth, targetHeight) };
}
