#!/usr/bin/env node

import { FEM_ENDPOINT, FEM_API_ENDPOINT, FEM_CAPTIONS_ENDPOINT, CAPTION_EXT, PLAYLIST_EXT, QUALITY_FORMAT, FEM_COURSE_REG, SUPPORTED_FORMATS, USER_AGENT } from './constants.js'
import {sleep, isPathExists, ensureDir, extendedFetch, safeJoin, formatBytes, formatSize} from './util/common.js'
import ffmpeg from './util/ffmpeg.js'
import fs from 'node:fs/promises'
import prompts from 'prompts'
import ora from 'ora'
import colors from 'kleur'
import os from 'node:os'
import https, { Agent } from 'node:https'
import extendFetchCookie from 'fetch-cookie'
import {createWriteStream} from 'node:fs'

console.clear()

let fileStream = createWriteStream('/home/mohamad/dev/fem-dl/assets/ffmpeg_output.txt', {flags: 'a'});

https.globalAgent = new Agent({ keepAlive: true })

const env = process.env
const exitOnCancel = (state) => {
    if (state.aborted) process.nextTick(() => process.exit(0))
}


const {
    COURSE_SLUG,
    PREFERRED_QUALITY,
    DOWNLOAD_DIR,
    EXTENSION,
    INCLUDE_CAPTION,
    TOKEN
} = await prompts([{
    type: 'text',
    name: 'COURSE_SLUG',
    message: 'The url of the course you want to download',
    initial: env['FEM_DL_COURSE_URL'] || 'https://frontendmasters.com/courses/...',
    validate: v => !v.endsWith('...') && FEM_COURSE_REG.test(v),
    format: v => v.match(FEM_COURSE_REG)[2],
    onState: exitOnCancel
}, {
    type: 'password',
    name: 'TOKEN',
    message: 'Paste the value of "fem_auth_mod" cookie (visit: https://frontendmasters.com)',
    format: v => decodeURIComponent(v) === v ? encodeURIComponent(v) : v,
    initial: env['FEM_DL_COOKIES'],
    onState: exitOnCancel
}, {
    type: 'select',
    name: 'PREFERRED_QUALITY',
    message: 'Which stream quality do you prefer?',
    choices: [2160, 1440, 1080, 720, 360].map((value) => ({ title: value + 'p', value })),
    format: v => QUALITY_FORMAT[v],
    onState: exitOnCancel
}, {
    type: 'select',
    message: 'Which video format you prefer?',
    name: 'EXTENSION',
    initial: 1,
    choices: SUPPORTED_FORMATS.map((value) => ({ title: value, value })),
    onState: exitOnCancel
}, {
    type: 'confirm',
    initial: true,
    name: 'INCLUDE_CAPTION',
    message: 'Include episode caption?',
    onState: exitOnCancel
}, {
    type: 'text',
    message: 'Download directory path',
    name: 'DOWNLOAD_DIR',
    initial: env['FEM_DL_DOWNLOAD_PATH'] || safeJoin(os.homedir(), 'Downloads'),
    validate: v => isPathExists(v),
    onState: exitOnCancel
}])

console.clear()

const headers = {
    'User-Agent': USER_AGENT,
    'Origin': 'https://frontendmasters.com',
    'Referer': 'https://frontendmasters.com/'
}

const cookies = new extendFetchCookie.toughCookie.CookieJar()

await cookies.setCookie(`fem_auth_mod=${TOKEN}; Path=/; Domain=frontendmasters.com; HttpOnly; Secure`, FEM_ENDPOINT)

const fetch = extendedFetch({
    headers,
    retries: 5,
    retryDelay: 1000
}, cookies)

const spinner = ora(`Searching for ${COURSE_SLUG}...`).start()
const course = await fetch.json(`${FEM_API_ENDPOINT}/kabuki/courses/${COURSE_SLUG}`)

if (course.code === 404) {
    spinner.fail(`Couldn't find this course "${COURSE_SLUG}"`)
    process.exit()
}


for (const data of Object.values(course.lessonData)) course.lessonElements[course.lessonElements.findIndex(x => x === data.index)] = {
    title: data.title,
    slug: data.slug,
    url: `${data.sourceBase}/source?f=${PLAYLIST_EXT}`,
    index: data.index
}

const [lessons, totalEpisodes] = course.lessonElements.reduce((acc, cur) => {
    if (typeof cur === 'string') (acc[0][cur] = [], acc[2] = cur)
    else (acc[0][acc[2]].push(cur), acc[1]++)
    return acc
}, [{}, 0, ''])


let i = 1, x = 0, QUALITY = PREFERRED_QUALITY, downgradeAlert = false

const coursePath = safeJoin(DOWNLOAD_DIR, course.title)

for (const [lesson, episodes] of Object.entries(lessons)) {
    const
        lessonName = `${i++}. ${lesson}`,
        lessonPath = safeJoin(coursePath, lessonName)

    await ensureDir(lessonPath)

    for (const episode of episodes) {
        const
            fileName = `${episode.index + 1}. ${episode.title}.${EXTENSION}`,
            captionPath = safeJoin(lessonPath, `${episode.title}.${CAPTION_EXT}`),
            tempFilePath = safeJoin(lessonPath, `${episode.title}.tmp.${EXTENSION}`),
            finalFilePath = safeJoin(lessonPath, fileName)

        spinner.text = `[0%] Downloading ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Size: 0KB | Remaining: ${++x}/${totalEpisodes}`

        if (await isPathExists(finalFilePath)) {
            await sleep(100)
            continue
        }


        let { url: m3u8RequestUrl } = await fetch.json(episode.url)
        const availableQualities = await fetch.text(m3u8RequestUrl)

        // Automatically downgrade quality when preferred quality not found
        const qualities = Object.values(QUALITY_FORMAT)

        while (!QUALITY.some((it) => availableQualities.includes(it)) && availableQualities.includes('#EXTM3U')) {
            const index = qualities.findIndex(it => it.every(q => QUALITY.includes(q)))
            
            QUALITY = qualities[index - 1]

            if (typeof QUALITY === 'undefined') {
                console.warn(`This shouldn't happen, please fill an issue`)
                console.warn(`Selected Quality: ${PREFERRED_QUALITY}\nCourse: ${COURSE_SLUG}\nm3u8: ${availableQualities}`)
                process.exit()
            }
        }

        if (!downgradeAlert && !PREFERRED_QUALITY.some(it => QUALITY.includes(it))) {
            downgradeAlert = true
            const [formattedQuality] = Object.entries(QUALITY_FORMAT).find(([_, it]) => it.every(q => QUALITY.includes(q)))
            spinner.clear()
            console.log(`\nThe preferred quality was not found, downgraded to ${formattedQuality}p`)
        }

        const streamQuality = QUALITY.find(it => availableQualities.includes(it))
        const m3u8Url = [...m3u8RequestUrl.split('/').slice(0, -1), `${streamQuality}.${PLAYLIST_EXT}`].join('/')

        headers['Cookie'] = await cookies.getCookieString(m3u8Url)

        let duration = 0;
        const handleProgress = (progressData) => {
            // Regular expression to match the progress information in FFmpeg output
            const durationRegex = /Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/;
            const progressRegex = /size=(\s*\d+(?:\.\d+)?\w*)\s*time=(\d+:\d+:\d+\.\d+)/;

            if (duration === 0) {
                // Parse duration from FFmpeg output
                const matchDuration = progressData.match(durationRegex);
                if (matchDuration) {
                    const hours = parseInt(matchDuration[1], 10);
                    const minutes = parseInt(matchDuration[2], 10);
                    const seconds = parseInt(matchDuration[3], 10);
                    duration = hours * 3600 + minutes * 60 + seconds;
                }
            }

            // Parse the output to extract progress information
            const match = progressData.match(progressRegex);
            if (match) {
                const size = formatSize(match[1].trim());
                const [hours, minutes, seconds] = match[2].split(':').map(parseFloat);
                const time = hours * 3600 + minutes * 60 + seconds;

                // Calculate progress percentage or update spinner/log as needed
                const progressPercentage = Math.round((time / duration) * 100);
                fileStream.write(`[${progressPercentage}%] Downloading ${(lessonName)}/${(fileName)} | Size: ${size}\n`);
                spinner.text = `[${progressPercentage}%] Downloading ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Size: ${size} | Remaining: ${x}/${totalEpisodes}`;
            } else {
                // Output didn't match progress information, log it if needed
                // silent || console.log(output);
            }
        }


        try {
            await ffmpeg([
                '-y',
                '-headers', Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') + '\r\n',
                '-i',
                m3u8Url,
                '-map', '0',
                '-c',
                'copy', tempFilePath
            ], {
                silent: true,
                handleProgress
            })
        } catch (error) {
            console.error(`Failed to download ${lessonName}/${fileName}`)
            console.error(error)
            continue
        }


        // Merge caption
        if (INCLUDE_CAPTION) {
            spinner.text = `Downloading captions for ${episode.title}...`

            const captions = await fetch.text(`${FEM_CAPTIONS_ENDPOINT}/assets/courses/${course.datePublished}-${course.slug}/${episode.index}-${episode.slug}.${CAPTION_EXT}`)

            await fs.writeFile(captionPath, captions)

            spinner.text = `Merging captions to ${episode.title}...`

            let args = []

            switch (EXTENSION) {
                case 'mkv': args = [
                    '-y',
                    '-i', tempFilePath,
                    '-i', captionPath,
                    '-map', '0',
                    '-map', '1',
                    '-c',
                    'copy',
                    finalFilePath
                ]; break

                case 'mp4': args = [
                    '-y',
                    '-i', tempFilePath,
                    '-i', captionPath,
                    '-c',
                    'copy',
                    '-c:s', 'mov_text',
                    '-metadata:s:s:0', 'language=eng',
                    finalFilePath
                ]; break;
                default:
                    throw new Error(`Unknown extension found: ${EXTENSION}`)
            }

            await ffmpeg(args, { silent: true, handleProgress: (progressData) => {}})
            await fs.rm(captionPath)
        } else {
            await fs.copyFile(tempFilePath, finalFilePath)
        }

        await fs.rm(tempFilePath).catch(() => null)
    }
}


spinner.succeed('Finished')
