/**
 * POST /api/video/download
 * Downloads a YouTube video via yt-dlp and stores in public/videos/.
 * Returns the servable path for the <video> element.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

export async function POST(request) {
  try {
    const { url } = await request.json();

    if (!url || !url.trim()) {
      return Response.json({ error: 'No URL provided' }, { status: 400 });
    }

    const videosDir = path.join(process.cwd(), 'public', 'videos');
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }

    const outputPath = path.join(videosDir, 'demo.mp4');

    // If file already exists, skip download and return immediately
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      if (stats.size > 100000) {
        return Response.json({
          path: '/videos/demo.mp4',
          cached: true,
          size: stats.size,
        });
      }
    }

    // Download with yt-dlp — prefer mp4 format ≤720p for browser compatibility
    const cmd = `yt-dlp -f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best" --merge-output-format mp4 -o "${outputPath}" --no-playlist "${url}" 2>&1`;

    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });

    if (!fs.existsSync(outputPath)) {
      return Response.json(
        { error: 'Download failed — file not created', details: stdout || stderr },
        { status: 500 }
      );
    }

    const stats = fs.statSync(outputPath);
    return Response.json({
      path: '/videos/demo.mp4',
      cached: false,
      size: stats.size,
    });
  } catch (err) {
    return Response.json(
      { error: err.message, details: err.stderr || '' },
      { status: 500 }
    );
  }
}
