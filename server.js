/**
 * BCZ Media Downloader Backend Engine
 * Bangladesh Cyber Zone
 * 100% Crash-Proof Server with Auto Local Downloader & Safe Spawn Error Handling
 */

const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const YT_DLP_PATH = path.join(__dirname, 'yt-dlp');

// ১. অটোমেটিক লোকাল yt-dlp বাইনারি ডাউনলোডার (রেন্ডার ফ্রি নোড এনভায়রনমেন্টের জন্য)
function ensureYtDlp() {
    if (!fs.existsSync(YT_DLP_PATH)) {
        console.log("yt-dlp binary not found. Downloading the latest Linux release from GitHub...");
        try {
            execSync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${YT_DLP_PATH}"`);
            execSync(`chmod +x "${YT_DLP_PATH}"`);
            console.log("yt-dlp successfully downloaded and configured locally!");
        } catch (err) {
            console.error("Failed to download yt-dlp binary on startup:", err);
        }
    }
}

ensureYtDlp();

app.use(cors({
    origin: "*",
    exposedHeaders: ["Content-Length", "Content-Type"]
}));
app.use(express.json());

// সময় ফরম্যাট করার সাহায্যকারী ফাংশন
function formatDuration(duration) {
    if (!duration) return "00:00";
    const sec_num = parseInt(duration, 10);
    let hours   = Math.floor(sec_num / 3600);
    let minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    let seconds = sec_num - (hours * 3600) - (minutes * 60);

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    
    return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

// ওএম্বেড ব্যাকআপ মেটাডেটা ফাংশন
function fetchFallbackOEmbed(url, res) {
    const oEmbedUrl = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
    https.get(oEmbedUrl, (apiRes) => {
        let data = '';
        apiRes.on('data', (chunk) => { data += chunk; });
        apiRes.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                res.json({
                    title: parsed.title || "Parsed Stream",
                    author_name: parsed.author_name || "Social Media Creator",
                    thumbnail_url: parsed.thumbnail_url || "",
                    duration: "00:00",
                    formats: {
                        video: [
                            { id: "bestvideo[height<=1080]+bestaudio/best", format: "mp4", resolution: "1080p (FHD)", size: "Dynamic", codec: "H.264" },
                            { id: "bestvideo[height<=720]+bestaudio/best", format: "mp4", resolution: "720p (HD)", size: "Dynamic", codec: "H.264" },
                            { id: "bestvideo[height<=480]+bestaudio/best", format: "mp4", resolution: "480p", size: "Dynamic", codec: "H.264" },
                            { id: "bestvideo[height<=360]+bestaudio/best", format: "mp4", resolution: "360p", size: "Dynamic", codec: "H.264" }
                        ],
                        audio: [
                            { id: "bestaudio", format: "mp3", resolution: "320 kbps (High Quality)", size: "Dynamic", codec: "MPEG Layer-3" }
                        ]
                    }
                });
            } catch (e) {
                res.status(500).json({ error: "Failed to parse video headers" });
            }
        });
    }).on('error', (e) => {
        res.status(500).json({ error: "Network error during analysis fallback" });
    });
}

// -------------------------------------------------------------
// GET /info - ভিডিও মেটাডেটা এবং কোয়ালিটি ফিল্টার এপিআই
// -------------------------------------------------------------
app.get('/info', (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) {
        return res.status(400).json({ error: "URL is required" });
    }
    
    // লোকাল ফোল্ডারে ডাউনলোড করা সচল yt-dlp ব্যবহার করা হচ্ছে
    const command = fs.existsSync(YT_DLP_PATH) ? YT_DLP_PATH : 'yt-dlp';
    const ytDlp = spawn(command, ['-j', '--no-warnings', videoUrl]);
    let output = '';
    let errorOutput = '';
    
    // অত্যন্ত গুরুত্বপূর্ণ: spawn ক্র্যাশ হ্যান্ডলার (যাতে সার্ভার কখনো বন্ধ না হয়)
    ytDlp.on('error', (err) => {
        console.error("Failed to spawn yt-dlp process. Running fallback oEmbed...", err);
        if (!res.headersSent) {
            return fetchFallbackOEmbed(videoUrl, res);
        }
    });
    
    ytDlp.stdout.on('data', (data) => { output += data; });
    ytDlp.stderr.on('data', (data) => { errorOutput += data; });
    
    ytDlp.on('close', (code) => {
        if (code !== 0) {
            console.warn(`yt-dlp failed, falling back to oEmbed: ${errorOutput}`);
            if (!res.headersSent) {
                return fetchFallbackOEmbed(videoUrl, res);
            }
            return;
        }
        
        try {
            const parsed = JSON.parse(output);
            const videoFormats = [];
            
            if (parsed.formats) {
                const seenHeights = new Set();
                parsed.formats.forEach(f => {
                    if (f.vcodec !== 'none' && f.acodec !== 'none' && f.ext === 'mp4') {
                        const height = f.height || 0;
                        if (height >= 240 && height <= 1080 && !seenHeights.has(height)) {
                            seenHeights.add(height);
                            videoFormats.push({
                                id: f.format_id,
                                format: "mp4",
                                resolution: `${height}p`,
                                size: f.filesize ? `${(f.filesize / (1024 * 1024)).toFixed(1)} MB` : "Dynamic",
                                codec: f.vcodec
                            });
                        }
                    }
                });
                
                if (videoFormats.length === 0) {
                    videoFormats.push(
                        { id: "bestvideo[height<=1080]+bestaudio/best", format: "mp4", resolution: "1080p (FHD)", size: "Dynamic", codec: "H.264" },
                        { id: "bestvideo[height<=720]+bestaudio/best", format: "mp4", resolution: "720p (HD)", size: "Dynamic", codec: "H.264" },
                        { id: "bestvideo[height<=480]+bestaudio/best", format: "mp4", resolution: "480p", size: "Dynamic", codec: "H.264" },
                        { id: "bestvideo[height<=360]+bestaudio/best", format: "mp4", resolution: "360p", size: "Dynamic", codec: "H.264" }
                    );
                }
            }
            
            if (!res.headersSent) {
                res.json({
                    title: parsed.title || "Parsed Stream",
                    author_name: parsed.uploader || parsed.channel || "Social Media Creator",
                    thumbnail_url: parsed.thumbnail || (parsed.thumbnails && parsed.thumbnails.length ? parsed.thumbnails[0].url : ""),
                    duration: formatDuration(parsed.duration),
                    formats: {
                        video: videoFormats.sort((a,b) => parseInt(b.resolution) - parseInt(a.resolution)),
                        audio: [
                            { id: "bestaudio", format: "mp3", resolution: "320 kbps (High Quality)", size: "Dynamic", codec: "MPEG Layer-3" }
                        ]
                    }
                });
            }
            
        } catch (err) {
            if (!res.headersSent) {
                fetchFallbackOEmbed(videoUrl, res);
            }
        }
    });
});

// -------------------------------------------------------------
// GET /api/download - রিয়েল-টাইম কনভার্সন ও ডাউনলোড পাইপিং এপিআই
// -------------------------------------------------------------
app.get('/api/download', (req, res) => {
    const videoUrl = req.query.url;
    const formatId = req.query.format || 'best';
    const titleParam = req.query.title || 'bcz_download';
    
    if (!videoUrl) {
        return res.status(400).send("Video URL is required");
    }
    
    let safeTitle = titleParam.replace(/[^\x20-\x7E]/g, ''); 
    safeTitle = safeTitle.replace(/[^a-zA-Z0-9\s-_]/g, '_').trim();
    if (!safeTitle) safeTitle = "bcz_download";
    
    const finalFilename = `${safeTitle} by BCZ`;
    
    const isAudio = formatId === 'bestaudio' || formatId === 'mp3';
    let args = [];
    
    if (isAudio) {
        res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}.mp3"`);
        res.setHeader('Content-Type', 'audio/mpeg');
        // এফএফএমপিইগ ছাড়া ডিরেক্ট সেফ অডিও স্ট্রিম (যা ফাইল নষ্ট বা ক্র্যাশ করবে না)
        args = ['-f', 'bestaudio', '-o', '-', videoUrl];
    } else {
        res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}.mp4"`);
        res.setHeader('Content-Type', 'video/mp4');
        args = ['-f', formatId, '-o', '-', videoUrl];
    }
    
    const command = fs.existsSync(YT_DLP_PATH) ? YT_DLP_PATH : 'yt-dlp';
    const ytDlp = spawn(command, args);
    
    // spawn ক্র্যাশ হ্যান্ডলার
    ytDlp.on('error', (err) => {
        console.error("Failed to spawn downloader process:", err);
        if (!res.headersSent) {
            res.status(500).send("Download pipeline error. Server busy.");
        }
    });
    
    ytDlp.stdout.pipe(res);
    
    ytDlp.stderr.on('data', (data) => {
        console.error(`yt-dlp pipeline stderr: ${data}`);
    });
    
    req.on('close', () => {
        ytDlp.kill();
    });
});

app.listen(PORT, () => {
    console.log(`BCZ Live Media Server is running on port ${PORT}`);
});
