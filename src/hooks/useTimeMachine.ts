import { useEffect, useRef, useState } from 'react';

interface TimeMachineConfig {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    enabled: boolean; // Master switch for recording
    bufferSeconds?: number; // Max history to keep
    fps?: number;
    quality?: number;
}

export interface TimeMachineControls {
    frame: ImageBitmap | null;
    isReplaying: boolean;
    bufferDuration: number; // How many seconds of history we have
    currentTime: number; // Current playback position (seconds from start of buffer)
    totalTime: number; // Total duration of buffer
    isPlaying: boolean;
    memoryUsageMB: number;
    enterReplay: () => void;
    exitReplay: () => void;
    play: () => void;
    pause: () => void;
    seek: (time: number) => void;
    getThumbnails: (count: number) => { time: number; frame: ImageBitmap }[];
}

export function useTimeMachine({
    videoRef,
    enabled,
    bufferSeconds = 30,
    fps = 20,
    quality = 0.5
}: TimeMachineConfig): TimeMachineControls {
    const [isReplaying, setIsReplaying] = useState(false);
    const [isPlaying, setIsPlaying] = useState(true); // Auto-play when entering replay?
    const [playbackIndex, setPlaybackIndex] = useState(0);
    const [frame, setFrame] = useState<ImageBitmap | null>(null);
    // const [bufferLength, setBufferLength] = useState(0); // Unused

    const bufferRef = useRef<ImageBitmap[]>([]);
    const requestRef = useRef<number>(0);
    const lastCaptureTimeRef = useRef<number>(0);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Cleanup
    useEffect(() => {
        return () => {
            bufferRef.current.forEach(f => f.close());
            bufferRef.current = [];
        };
    }, []);

    // Capture Loop (Only when NOT replaying)
    useEffect(() => {
        if (!canvasRef.current) {
            canvasRef.current = document.createElement('canvas');
        }

        const captureFrame = (timestamp: number) => {
            if (!enabled || isReplaying || !videoRef.current || videoRef.current.readyState !== 4) {
                requestRef.current = requestAnimationFrame(captureFrame);
                return;
            }

            if (timestamp - lastCaptureTimeRef.current < 1000 / fps) {
                requestRef.current = requestAnimationFrame(captureFrame);
                return;
            }
            lastCaptureTimeRef.current = timestamp;

            const video = videoRef.current;
            const canvas = canvasRef.current!;

            // Set canvas size based on quality
            const targetWidth = video.videoWidth * quality;
            const targetHeight = video.videoHeight * quality;

            if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
                canvas.width = targetWidth;
                canvas.height = targetHeight;
            }

            const ctx = canvas.getContext('2d', { alpha: false });
            if (!ctx) return;

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            createImageBitmap(canvas).then(bitmap => {
                bufferRef.current.push(bitmap);

                // Prune buffer
                const maxFrames = Math.ceil(bufferSeconds * fps);
                while (bufferRef.current.length > maxFrames) {
                    const oldFrame = bufferRef.current.shift();
                    oldFrame?.close();
                }

                // Update length state occasionally to avoid spamming renders? 
                // Actually, we only need this when entering replay.
                // But let's keep it synced for "Buffer Available" indicators if we want them.
                // setBufferLength(bufferRef.current.length); 
            });

            requestRef.current = requestAnimationFrame(captureFrame);
        };

        requestRef.current = requestAnimationFrame(captureFrame);

        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [enabled, isReplaying, fps, quality, bufferSeconds, videoRef]);

    // Playback Loop (Only when replaying AND playing)
    useEffect(() => {
        if (!isReplaying || !isPlaying) return;

        let lastFrameTime = 0;
        let animationFrameId: number;

        const renderLoop = (timestamp: number) => {
            if (timestamp - lastFrameTime >= 1000 / fps) {
                setPlaybackIndex(prev => {
                    const next = prev + 1;
                    if (next >= bufferRef.current.length) {
                        // Loop or stop? Let's loop.
                        return 0;
                    }
                    return next;
                });
                lastFrameTime = timestamp;
            }
            animationFrameId = requestAnimationFrame(renderLoop);
        };

        animationFrameId = requestAnimationFrame(renderLoop);
        return () => cancelAnimationFrame(animationFrameId);
    }, [isReplaying, isPlaying, fps]);

    // Update current frame based on index
    useEffect(() => {
        if (isReplaying && bufferRef.current.length > 0) {
            const idx = Math.min(Math.max(0, playbackIndex), bufferRef.current.length - 1);
            setFrame(bufferRef.current[idx]);
        }
    }, [playbackIndex, isReplaying]);

    // Controls
    const enterReplay = () => {
        if (bufferRef.current.length === 0) return;
        setIsReplaying(true);
        setIsPlaying(true);
        // setBufferLength(bufferRef.current.length);
        // Start at the beginning? Or end? 
        // "Rewind" implies going back. 
        // Usually you want to see the last few seconds.
        // Let's start at the BEGINNING of the buffer (oldest frame) so they watch the whole clip.
        setPlaybackIndex(0);
    };

    const exitReplay = () => {
        setIsReplaying(false);
        setIsPlaying(false);
        setFrame(null);
        // Optional: Clear buffer? 
        // bufferRef.current.forEach(f => f.close());
        // bufferRef.current = [];
        // No, keep buffer so they can replay again if they want.
        // But new frames will append to it.
    };

    const seek = (time: number) => {
        // time is in seconds
        const frameIndex = Math.floor(time * fps);
        setPlaybackIndex(frameIndex);
    };

    const [memoryUsageMB, setMemoryUsageMB] = useState(0);

    // ... inside capture loop or effect
    // We can approximate memory usage
    useEffect(() => {
        const interval = setInterval(() => {
            if (bufferRef.current.length > 0) {
                const sample = bufferRef.current[0];
                const sizePerFrame = sample.width * sample.height * 4; // RGBA
                const totalBytes = sizePerFrame * bufferRef.current.length;
                setMemoryUsageMB(Math.round(totalBytes / 1024 / 1024));
            } else {
                setMemoryUsageMB(0);
            }
        }, 1000); // Update every second
        return () => clearInterval(interval);
    }, []);

    const getThumbnails = (count: number) => {
        if (bufferRef.current.length === 0) return [];

        const thumbnails: { time: number; frame: ImageBitmap }[] = [];
        const step = Math.max(1, Math.floor(bufferRef.current.length / count));

        for (let i = 0; i < count; i++) {
            const index = Math.min(i * step, bufferRef.current.length - 1);
            thumbnails.push({
                time: index / fps,
                frame: bufferRef.current[index]
            });
        }
        return thumbnails;
    };

    return {
        frame,
        isReplaying,
        bufferDuration: bufferRef.current.length / fps,
        currentTime: playbackIndex / fps,
        totalTime: bufferRef.current.length / fps,
        isPlaying,
        memoryUsageMB,
        enterReplay,
        exitReplay,
        play: () => setIsPlaying(true),
        pause: () => setIsPlaying(false),
        seek,
        getThumbnails
    };
}
