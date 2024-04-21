import {spawn} from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'


export default (args, {silent = false, pipe, handleProgress = () => {}} = {}) => new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args)
    let err = ''

    child.stdout.on('data', (data) => silent || console.log(data.toString()))
    // Listen for stderr output from FFmpeg process
    child.stderr.on('data', (data) => {
        handleProgress(data.toString());
    });

    if (pipe) child.stderr.pipe(pipe)

    child.on('error', reject)
    child.on('exit', (code) => code ? reject(err) : resolve())
})
// spinner.text = `[${progressPercentage}%] Downloading ${colors.red('skate_phantom_flex_4k')} | Size: ${formatBytes(size)}`
