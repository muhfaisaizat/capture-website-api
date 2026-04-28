const {getSecret} = require('./config.js');
const puppeteer = require('puppeteer-core');
const chromium = require("@sparticuz/chromium");

async function doCaptureWork(queryParameters) {
    const options = await getOptions(queryParameters);
    const url = options.url;
    console.info('Capturing URL: ' + url + ' ...');
    return await tryWithPuppeteer(url, options);
}

function allowedRequest(queryParameters) {
    const secret = getSecret();
    if (!secret) {
        return true;
    }
    if (!queryParameters || !queryParameters.secret) {
        return false;
    }
    return queryParameters.secret === secret;
}

async function getOptions(queryParameters) {
    const result = parseQueryParameters(queryParameters);
    result.launchOptions = {
        headless: true,
        args: [
            ...chromium.default.args,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--hide-scrollbars',
            '--mute-audio',
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--disable-setuid-sandbox",
            "--no-first-run",
            "--no-zygote",
            '--use-fake-ui-for-media-stream' // Pages that ask for webcam/microphone access
        ],
        executablePath: process.env.CHROME_EXECUTABLE_PATH || await chromium.default.executablePath(),
    };
    fieldValuesToNumber(result, 'width', 'height', 'quality', 'scaleFactor', 'timeout', 'delay', 'offset');
    return result;
}

function parseQueryParameters(queryParameters) {
    return Object.keys(queryParameters).reduce((params, key) => {
        const q = queryParameters[key];
        let value;
        try {
            value = JSON.parse(q);
        } catch {
            value = q
        }
        return {
            ...params,
            [key]: value
        }
    }, queryParameters || {});
}

async function tryWithPuppeteer(url, options) {
    try {
        const buffer = await takePlainPuppeteerScreenshot(url, options);
        console.info(`Successfully captured URL: ${url}`);
        return {
            statusCode: 200,
            responseType: getResponseType(options),
            buffer: buffer
        }
    } catch (e) {
        console.log('Capture failed due to: ' + e.message);
        return {
            statusCode: 500,
            message: e.message
        }
    }
}

async function takePlainPuppeteerScreenshot(url, options) {
    options.encoding = 'binary';
    options.wait_before_screenshot_ms = options.wait_before_screenshot_ms || 5000;
    let browser;
    let page;
    let buffer;
    try {
        browser = await puppeteer.launch(options.launchOptions);
        page = await browser.newPage();

        // Set user agent agar tidak diblokir
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Set viewport awal
        await page.setViewport({
            width: options.width || 1280,
            height: 900,
            deviceScaleFactor: options.scaleFactor || 1
        });

        // Goto dengan fallback — coba networkidle2 dulu, kalau timeout pakai domcontentloaded
        try {
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 15000
            });
        } catch (e) {
            console.log('networkidle2 timeout, fallback to domcontentloaded');
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });
        }

        // Tunggu CSS & font selesai apply
        await page.waitForTimeout ? 
            await page.waitForTimeout(1000) : 
            await new Promise(r => setTimeout(r, 1000));

        // Scroll ke bawah perlahan agar lazy load terpicu
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 300;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= document.body.scrollHeight) {
                        clearInterval(timer);
                        window.scrollTo(0, 0); // Scroll balik ke atas
                        resolve();
                    }
                }, 100);
            });
        });

        // Tunggu sesuai parameter setelah scroll
        await new Promise(r => setTimeout(r, options.wait_before_screenshot_ms));

        // Auto detect tinggi setelah semua konten load
        await setViewport(page, options);

        // Tunggu sebentar setelah resize
        await new Promise(r => setTimeout(r, 500));

        // Screenshot
        const array = await page.screenshot({ fullPage: true });
        buffer = Buffer.from(array);

    } catch (e) {
        console.error('Error during Puppeteer screenshot capture: ', e);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
    return buffer;
}

async function setViewport(page, options) {
    const width = options.width || 1280;

    // Auto detect tinggi halaman
    const pageHeight = await page.evaluate(() => {
        return Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight,
            10000 // minimum fallback
        );
    });

    const height = options.height || pageHeight || 900;

    await page.setViewport({
        width: width,
        height: height,
        deviceScaleFactor: options.scaleFactor || 1
    });
}

function getResponseType(queryParams) {
    if (queryParams.type && queryParams.type === 'jpeg') {
        return 'jpg';
    }
    return 'png';
}

function fieldValuesToNumber(obj, ...fields) {
    fields.forEach(f => {
        if (obj[f]) {
            const val = Number(obj[f]);
            obj[f] = Number.isNaN(val) ? obj[f] : val;
        }
    });
}

module.exports = {
    doCaptureWork: doCaptureWork,
    allowedRequest: allowedRequest,
    getResponseType: getResponseType,
    fieldValuesToNumber: fieldValuesToNumber
}
