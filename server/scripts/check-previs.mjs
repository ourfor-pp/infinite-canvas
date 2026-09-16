import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
for (const tool of ['ffmpeg', 'ffprobe']) execFileSync(tool, ['-version'], { stdio: 'ignore' });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
try {
    const page = await browser.newPage();
    const ready = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')));
    if (!ready) throw new Error('Chromium WebGL2 不可用');
    console.log('预演运行依赖就绪：Chromium、WebGL2、FFmpeg、FFprobe');
} finally { await browser.close(); }
