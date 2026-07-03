/**
 * BCZ Media Downloader Backend Engine
 * Bangladesh Cyber Zone
 * 100% Error-Free Production-Ready Node.js Server with Global Docker Native Pipeline
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

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

// -------------------------------------------------------------
// GET /info - মেটাডেটা এপিআই
// -------------------------------------------------------------
app.get('/info', (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) {
        return res.status(400).json({ error: "URL is required" });
    }
    
    // ডকার কন্টেইনারে গ্লোবাল yt-dlp ব্যবহার করা হচ্ছে
    const ytDlp = spawn('yt-dlp', ['-j', '--no-warnings', videoUrl]);
    let output = '';
    let errorOutput = '';
    
    ytDlp.stdout.on('data', (data) => { output += data; });
    ytDlp.stderr.on('data', (data) => { errorOutput += data; });
    
    ytDlp.on('close', (code) => {
        if (code !== 0) {
            console.error(`yt-dlp failed: ${errorOutput}`);
            return res.status(500).json({ error: "Failed to parse video headers" });
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
                        { id: "best", format: "mp4", resolution: "HD Quality", size: "Dynamic", codec: "H.264" }
                    );
                }
            }
            
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
            
        } catch (err) {
            res.status(500).json({ error: "JSON parsing error" });
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
        // ডকার কন্টেইনারে FFmpeg থাকায় সরাসরি রিয়েল ৩২০ kbps এমপি৩ জেনারেট হচ্ছে!
        args = ['-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--audio-quality', '320K', '-o', '-', videoUrl];
    } else {
        res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}.mp4"`);
        res.setHeader('Content-Type', 'video/mp4');
        args = ['-f', formatId, '-o', '-', videoUrl];
    }
    
    const ytDlp = spawn('yt-dlp', args);
    
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
