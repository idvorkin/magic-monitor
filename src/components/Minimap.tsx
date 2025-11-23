import { useEffect, useRef } from 'react';

interface MinimapProps {
    stream: MediaStream | null;
    zoom: number;
    pan: { x: number; y: number };
    frame?: ImageBitmap | null;
}

export function Minimap({ stream, zoom, pan, frame }: MinimapProps) {
    const miniVideoRef = useRef<HTMLVideoElement>(null);
    const miniCanvasRef = useRef<HTMLCanvasElement>(null);

    // Sync the mini video with the main video stream
    useEffect(() => {
        if (!frame && stream && miniVideoRef.current) {
            miniVideoRef.current.srcObject = stream;
        }
    }, [stream, frame]);

    // Render frame if provided
    useEffect(() => {
        if (frame && miniCanvasRef.current) {
            const ctx = miniCanvasRef.current.getContext('2d');
            if (ctx) {
                miniCanvasRef.current.width = frame.width;
                miniCanvasRef.current.height = frame.height;
                ctx.drawImage(frame, 0, 0);
            }
        }
    }, [frame]);

    // if (zoom <= 1) return null; // Always show minimap

    // Calculate viewport rectangle
    // Assuming pan is in video pixels (unscaled)
    // And the video is centered by default.
    // If pan is (0,0), rect is centered.
    // If pan is positive (video moved right), we are looking at the left side, so rect moves left.

    // We'll use percentages for the overlay to be responsive
    const widthPercent = 100 / zoom;
    const heightPercent = 100 / zoom;

    // Pan is the offset of the video center from the screen center.
    // If pan.x = 100, the video is shifted 100px right.
    // This means the viewport (screen) is effectively -100px relative to video center.
    // We need to normalize pan to percentage of video size.
    // But we don't know the exact video size in pixels here easily without querying the element.
    // However, the pan logic in CameraStage divides by zoom, suggesting it tries to track "video pixels".
    // Let's assume pan is in "video pixels".
    // We need the video element width to normalize.

    // Let's try to get video dimensions from the stream settings if possible, or default
    const videoWidth = frame ? frame.width : (stream?.getVideoTracks()[0]?.getSettings().width || 640);
    const videoHeight = frame ? frame.height : (stream?.getVideoTracks()[0]?.getSettings().height || 480);

    // Calculate position as percentage
    // Center is 50%.
    // Offset is -pan (because moving video right means looking left)
    // Normalized offset = -pan / videoDimension * 100
    const leftPercent = 50 - (pan.x / videoWidth * 100) - (widthPercent / 2);
    const topPercent = 50 - (pan.y / videoHeight * 100) - (heightPercent / 2);

    return (
        <div className="absolute top-4 right-4 z-50 w-48 aspect-video bg-black/80 border-2 border-white/20 rounded-lg overflow-hidden shadow-lg relative">
            {frame ? (
                <canvas
                    ref={miniCanvasRef}
                    className="w-full h-full object-contain opacity-50"
                />
            ) : (
                <video
                    ref={miniVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain opacity-50"
                />
            )}

            {/* Viewport Rectangle */}
            <div
                className="absolute border-2 border-yellow-400 bg-yellow-400/20 shadow-[0_0_10px_rgba(250,204,21,0.5)]"
                style={{
                    width: `${widthPercent}%`,
                    height: `${heightPercent}%`,
                    left: `${leftPercent}%`,
                    top: `${topPercent}%`,
                }}
            />
        </div>
    );
}
