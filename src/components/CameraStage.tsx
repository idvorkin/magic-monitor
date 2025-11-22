import { useEffect, useRef, useState } from 'react';
import { useFlashDetector } from '../hooks/useFlashDetector';
import { useTimeMachine } from '../hooks/useTimeMachine';
import { Thumbnail } from './Thumbnail';

export function CameraStage() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState<string | null>(null);

    // Zoom/Pan State
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

    // Flash Detection State
    const [flashEnabled, setFlashEnabled] = useState(false);
    const [targetColor, setTargetColor] = useState<{ r: number; g: number; b: number } | null>(null);
    const [threshold, setThreshold] = useState(20);
    const [isPickingColor, setIsPickingColor] = useState(false);
    const [isHQ, setIsHQ] = useState(false);

    // Time Machine State
    // We always enable recording in the background for "Instant Replay" capability
    const timeMachine = useTimeMachine({
        videoRef,
        enabled: true,
        bufferSeconds: 60,
        fps: isHQ ? 30 : 15,
        quality: isHQ ? 0.5 : 0.35
    });

    const isFlashing = useFlashDetector({
        videoRef,
        enabled: flashEnabled,
        targetColor,
        threshold
    });

    useEffect(() => {
        async function setupCamera() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                        facingMode: 'user',
                    },
                });

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            } catch (err) {
                console.error('Error accessing camera:', err);
                setError('Could not access camera. Please allow camera permissions.');
            }
        }

        setupCamera();

        return () => {
            if (videoRef.current && videoRef.current.srcObject) {
                const stream = videoRef.current.srcObject as MediaStream;
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    // Render replay frame to canvas
    useEffect(() => {
        if (timeMachine.isReplaying && timeMachine.frame && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                canvasRef.current.width = timeMachine.frame.width;
                canvasRef.current.height = timeMachine.frame.height;
                ctx.drawImage(timeMachine.frame, 0, 0);
            }
        }
    }, [timeMachine.frame, timeMachine.isReplaying]);

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const newZoom = Math.min(Math.max(zoom - e.deltaY * 0.001, 1), 5);
        setZoom(newZoom);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (isPickingColor) {
            pickColor(e.clientX, e.clientY);
            return;
        }

        if (zoom > 1) {
            setIsDragging(true);
            setLastMousePos({ x: e.clientX, y: e.clientY });
        }
    };

    const pickColor = (x: number, y: number) => {
        if (!videoRef.current || !containerRef.current) return;

        const video = videoRef.current;
        const rect = video.getBoundingClientRect();

        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;

        const videoX = (x - rect.left) * scaleX;
        const videoY = (y - rect.top) * scaleY;

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(video, 0, 0);
        const pixel = ctx.getImageData(videoX, videoY, 1, 1).data;

        setTargetColor({ r: pixel[0], g: pixel[1], b: pixel[2] });
        setIsPickingColor(false);
        setFlashEnabled(true);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging && zoom > 1 && !isPickingColor) {
            const dx = e.clientX - lastMousePos.x;
            const dy = e.clientY - lastMousePos.y;

            setPan(prev => ({
                x: prev.x + dx / zoom,
                y: prev.y + dy / zoom
            }));

            setLastMousePos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full bg-black overflow-hidden flex items-center justify-center ${isPickingColor ? 'cursor-crosshair' : 'cursor-move'}`}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* Flash Warning Overlay */}
            <div className={`absolute inset-0 border-[20px] border-red-600 z-40 pointer-events-none transition-opacity duration-100 ${isFlashing ? 'opacity-100' : 'opacity-0'}`} />

            {/* Delay Indicator Overlay */}
            {timeMachine.isReplaying && (
                <div className="absolute top-8 right-8 z-40 bg-blue-600/80 backdrop-blur text-white px-4 py-2 rounded-lg font-mono text-xl font-bold animate-pulse border border-blue-400">
                    REPLAY MODE
                </div>
            )}

            {/* RAM Monitor */}
            <div className="absolute bottom-8 right-8 z-40 text-white/50 font-mono text-xs pointer-events-none">
                RAM: {timeMachine.memoryUsageMB} MB
            </div>

            {error && (
                <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/80 text-red-500">
                    <p className="text-xl font-bold">{error}</p>
                </div>
            )}

            {/* Live Video */}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`max-w-full max-h-full object-contain transition-transform duration-75 ease-out ${timeMachine.isReplaying ? 'hidden' : 'block'}`}
                style={{
                    transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`
                }}
            />

            {/* Replay Canvas */}
            <canvas
                ref={canvasRef}
                className={`max-w-full max-h-full object-contain transition-transform duration-75 ease-out ${timeMachine.isReplaying ? 'block' : 'hidden'}`}
                style={{
                    transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`
                }}
            />

            {/* Controls Overlay */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col gap-4 items-center z-50 w-full max-w-4xl px-4">

                {/* Replay Controls */}
                {timeMachine.isReplaying ? (
                    <div className="flex flex-col gap-2 w-full items-center">
                        <div className="bg-blue-900/80 backdrop-blur-md p-4 rounded-2xl flex items-center gap-4 w-full justify-center border border-blue-400 shadow-lg shadow-blue-900/50">
                            <button
                                onClick={timeMachine.exitReplay}
                                className="px-4 py-1 rounded font-bold bg-white/20 text-white hover:bg-white/30"
                            >
                                EXIT REPLAY
                            </button>

                            <div className="h-8 w-px bg-white/20 mx-2" />

                            <button
                                onClick={timeMachine.isPlaying ? timeMachine.pause : timeMachine.play}
                                className="text-2xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10"
                            >
                                {timeMachine.isPlaying ? '⏸️' : '▶️'}
                            </button>

                            <input
                                type="range"
                                min="0"
                                max={timeMachine.totalTime || 1}
                                step="0.1"
                                value={timeMachine.currentTime}
                                onChange={(e) => timeMachine.seek(parseFloat(e.target.value))}
                                className="flex-1 accent-blue-400 h-2 rounded-full bg-blue-950"
                            />
                            <span className="w-16 text-right font-mono text-sm">
                                {timeMachine.currentTime.toFixed(1)}s / {timeMachine.totalTime.toFixed(1)}s
                            </span>
                        </div>

                        {/* Filmstrip */}
                        <div className="flex gap-2 overflow-x-auto w-full pb-2 px-2 snap-x bg-black/40 backdrop-blur-sm rounded-xl p-2 border border-white/10">
                            {timeMachine.getThumbnails(10).map((thumb, i) => (
                                <Thumbnail
                                    key={i}
                                    frame={thumb.frame}
                                    label={`${thumb.time.toFixed(1)}s`}
                                    onClick={() => timeMachine.seek(thumb.time)}
                                    isActive={Math.abs(timeMachine.currentTime - thumb.time) < 1}
                                />
                            ))}
                        </div>
                    </div>
                ) : (
                    /* Live Controls */
                    <div className="bg-black/60 backdrop-blur-md p-4 rounded-2xl flex items-center gap-4 w-full justify-center border border-white/10">
                        <button
                            onClick={timeMachine.enterReplay}
                            className="px-4 py-2 rounded-lg font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center gap-2"
                        >
                            <span>⏪</span> REWIND
                        </button>

                        <div className="h-8 w-px bg-white/20 mx-2" />

                        {/* Flash Controls Inline */}
                        <div className="flex items-center gap-2">
                            <div
                                className="w-6 h-6 rounded-full border-2 border-white"
                                style={{ backgroundColor: targetColor ? `rgb(${targetColor.r},${targetColor.g},${targetColor.b})` : 'transparent' }}
                            />
                            <button
                                onClick={() => setIsPickingColor(!isPickingColor)}
                                className={`px-3 py-1 rounded font-bold text-sm ${isPickingColor ? 'bg-blue-500 text-white' : 'bg-white/20 text-white hover:bg-white/30'}`}
                            >
                                {isPickingColor ? 'Click Video' : 'Pick Color'}
                            </button>
                        </div>

                        <label className="flex items-center gap-2 text-white text-sm">
                            <span>Thresh:</span>
                            <input
                                type="range"
                                min="1"
                                max="50"
                                value={threshold}
                                onChange={(e) => setThreshold(parseInt(e.target.value))}
                                className="w-20 accent-red-500"
                            />
                        </label>

                        <button
                            onClick={() => setFlashEnabled(!flashEnabled)}
                            className={`px-3 py-1 rounded font-bold transition-colors text-sm ${flashEnabled ? 'bg-red-600 text-white' : 'bg-white/10 text-gray-400'}`}
                        >
                            {flashEnabled ? 'ARMED' : 'OFF'}
                        </button>

                        <div className="h-8 w-px bg-white/20 mx-2" />

                        <button
                            onClick={() => setIsHQ(!isHQ)}
                            className={`px-3 py-1 rounded font-bold transition-colors text-sm ${isHQ ? 'bg-purple-600 text-white' : 'bg-white/10 text-gray-400'}`}
                            title="High Quality Mode (Uses ~3.5GB RAM)"
                        >
                            {isHQ ? 'HQ' : 'LQ'}
                        </button>
                    </div>
                )}

                {/* Zoom Controls (Always Visible) */}
                <div className="bg-black/50 backdrop-blur-md p-4 rounded-full flex items-center gap-4">
                    <button
                        onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
                        className="text-white font-bold px-3 py-1 rounded hover:bg-white/20 text-sm"
                    >
                        Reset Zoom
                    </button>
                    <input
                        type="range"
                        min="1"
                        max="5"
                        step="0.1"
                        value={zoom}
                        onChange={(e) => setZoom(parseFloat(e.target.value))}
                        className="w-48 accent-blue-500"
                    />
                    <span className="text-white font-mono w-12 text-right">{zoom.toFixed(1)}x</span>
                </div>
            </div>
        </div >
    );
}
