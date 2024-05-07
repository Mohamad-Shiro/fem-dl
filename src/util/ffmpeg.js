import { spawn } from "node:child_process";
import { exec } from "node:child_process";

let ffmpegPath = "";
if (!process.env.FFMPEG_BIN) {
  exec("which ffmpeg", (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`Error: ${stderr}`);
      return;
    }
    // The path to ffmpeg will be in the stdout
    ffmpegPath = stdout.trim();
  });
} else {
  ffmpegPath = process.env.FFMPEG_BIN;
}

export default (
  args,
  { silent = false, pipe, handleProgress = () => {} } = {}
) =>
  new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args);
    let err = "";

    child.stdout.on("data", (data) => silent || console.log(data.toString()));
    // Listen for stderr output from FFmpeg process
    child.stderr.on("data", (data) => {
      handleProgress(data.toString());
    });

    if (pipe) child.stderr.pipe(pipe);

    child.on("error", reject);
    child.on("exit", (code) => (code ? reject(err) : resolve()));
  });
// spinner.text = `[${progressPercentage}%] Downloading ${colors.red('skate_phantom_flex_4k')} | Size: ${formatBytes(size)}`
