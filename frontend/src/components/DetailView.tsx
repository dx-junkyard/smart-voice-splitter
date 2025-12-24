import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import WaveSurfer from 'wavesurfer.js';
import { getProfile, updateChunk, type Profile } from '../api';
import {
    ArrowLeft,
    Play,
    Pause,
    RotateCcw,
    Bookmark
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const DetailView: React.FC = () => {
    const { profileId } = useParams<{ profileId: string }>();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);

    // Player state
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);

    // A-B Loop state
    const [loopStart, setLoopStart] = useState<number | null>(null);
    const [loopEnd, setLoopEnd] = useState<number | null>(null);
    const [isLooping, setIsLooping] = useState(false);

    // References
    const waveformRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const activeChunkRef = useRef<HTMLDivElement | null>(null);
    const loopStateRef = useRef({ loopStart, loopEnd, isLooping });

    // Data handling
    const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
    const [savingStatus, setSavingStatus] = useState<Record<number, 'saving' | 'saved' | null>>({});
    const notesDebounceRefs = useRef<Record<number, NodeJS.Timeout>>({});

    const recording = profile?.recordings[0];
    const chunks = recording?.chunks || [];

    const getAudioUrl = (filePath: string | null) => {
        if (!filePath) return '';
        const relativePath = filePath.replace(/^uploads\//, '');
        return `http://localhost:8000/static/${relativePath}`;
    };

    useEffect(() => {
        loopStateRef.current = { loopStart, loopEnd, isLooping };
    }, [loopStart, loopEnd, isLooping]);

    useEffect(() => {
        if (profileId) {
            fetchProfile(Number(profileId));
        }
    }, [profileId]);

    const fetchProfile = async (id: number) => {
        try {
            const data = await getProfile(id);
            setProfile(data);

            const drafts: Record<number, string> = {};
            data.recordings.forEach(r => {
                r.chunks.forEach(c => {
                    drafts[c.id] = c.user_note || '';
                });
            });
            setNoteDrafts(drafts);
        } catch (error) {
            console.error('Failed to fetch profile', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!waveformRef.current || !recording?.file_path) return;

        const ws = WaveSurfer.create({
            container: waveformRef.current,
            waveColor: '#D1D5DB',
            progressColor: '#3B82F6',
            cursorColor: '#EF4444',
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
            height: 128,
            normalize: true,
            minPxPerSec: 50,
            url: getAudioUrl(recording.file_path),
        });

        wavesurferRef.current = ws;

        ws.on('ready', () => {
            setDuration(ws.getDuration());
        });

        ws.on('play', () => setIsPlaying(true));
        ws.on('pause', () => setIsPlaying(false));

        ws.on('timeupdate', (currentTime) => {
            setCurrentTime(currentTime);

            const { loopStart, loopEnd, isLooping } = loopStateRef.current;
            if (isLooping && loopStart !== null && loopEnd !== null) {
                if (currentTime >= loopEnd) {
                    ws.setTime(loopStart);
                }
            }
        });

        ws.on('finish', () => {
            setIsPlaying(false);
        });

        return () => {
            ws.destroy();
            wavesurferRef.current = null;
        };
    }, [recording?.file_path]);

    const currentChunkId = chunks.find(
        c => currentTime >= c.start_time && currentTime < c.end_time
    )?.id;

    useEffect(() => {
        if (currentChunkId && activeChunkRef.current) {
            activeChunkRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }
    }, [currentChunkId]);

    const togglePlay = () => {
        wavesurferRef.current?.playPause();
    };

    const skipBackward = () => {
        wavesurferRef.current?.skip(-5);
    };

    const handleSpeedChange = (speed: number) => {
        setPlaybackRate(speed);
        wavesurferRef.current?.setPlaybackRate(speed);
    };

    const handleSetLoopA = () => {
        setLoopStart(currentTime);
        setIsLooping(true);
    };

    const handleSetLoopB = () => {
        if (loopStart !== null && currentTime > loopStart) {
            setLoopEnd(currentTime);
            setIsLooping(true);
        }
    };

    const clearLoop = () => {
        setLoopStart(null);
        setLoopEnd(null);
        setIsLooping(false);
    };

    const handleChunkClick = (startTime: number) => {
        wavesurferRef.current?.setTime(startTime);
        wavesurferRef.current?.play();
    };

    const handleBookmark = async (e: React.MouseEvent, chunkId: number) => {
        e.stopPropagation();
        if (!profile) return;

        const chunk = chunks.find(c => c.id === chunkId);
        if (!chunk) return;

        const newStatus = !chunk.is_bookmarked;

        const updatedRecordings = profile.recordings.map(r => ({
            ...r,
            chunks: r.chunks.map(c =>
                c.id === chunkId ? { ...c, is_bookmarked: newStatus } : c
            )
        }));
        setProfile({ ...profile, recordings: updatedRecordings });

        try {
            await updateChunk(chunkId, { is_bookmarked: newStatus });
        } catch (err) {
            console.error("Failed to update bookmark", err);
        }
    };

    const handleNoteChange = (chunkId: number, newNote: string) => {
        setNoteDrafts(prev => ({ ...prev, [chunkId]: newNote }));
        setSavingStatus(prev => ({ ...prev, [chunkId]: 'saving' }));

        if (notesDebounceRefs.current[chunkId]) {
            clearTimeout(notesDebounceRefs.current[chunkId]);
        }

        notesDebounceRefs.current[chunkId] = setTimeout(async () => {
            try {
                await updateChunk(chunkId, { user_note: newNote });
                setSavingStatus(prev => ({ ...prev, [chunkId]: 'saved' }));
                setTimeout(() => setSavingStatus(prev => ({ ...prev, [chunkId]: null })), 2000);
            } catch (err) {
                console.error("Failed to save note", err);
            }
        }, 1000);
    };


    if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
    if (!profile) return <div className="flex items-center justify-center h-screen text-red-500">Profile not found</div>;

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            <div className="flex-none bg-white shadow-md z-10 border-b border-gray-200">
                <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center">
                        <Link to="/" className="text-gray-500 hover:text-gray-800 mr-4 p-1 rounded-full hover:bg-gray-100">
                            <ArrowLeft size={20} />
                        </Link>
                        <div>
                            <h1 className="text-lg font-bold text-gray-900 truncate max-w-md">{profile.title}</h1>
                        </div>
                    </div>
                    <div className="text-sm text-gray-500 font-mono">
                         {new Date(currentTime * 1000).toISOString().substr(14, 5)} / {new Date(duration * 1000).toISOString().substr(14, 5)}
                    </div>
                </div>

                <div className="px-6 py-4 bg-gray-50">
                    <div
                        ref={waveformRef}
                        className="w-full"
                        style={{ height: '128px' }}
                    ></div>
                </div>

                <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={skipBackward}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                            title="5秒戻る"
                        >
                            <RotateCcw size={20} />
                            <span className="sr-only">5秒戻る</span>
                        </button>

                        <button
                            onClick={togglePlay}
                            className="w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
                        >
                            {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                        </button>

                        <div className="flex items-center bg-gray-100 rounded-lg p-1 text-sm font-medium">
                            {[0.5, 0.75, 1.0].map((rate) => (
                                <button
                                    key={rate}
                                    onClick={() => handleSpeedChange(rate)}
                                    className={cn(
                                        "px-2 py-1 rounded transition-colors",
                                        playbackRate === rate ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                                    )}
                                >
                                    {rate === 1 ? '1.0' : rate}x
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-200">
                         <span className="text-xs font-bold text-gray-400 px-2 uppercase tracking-wider">リピート</span>
                         <button
                             onClick={handleSetLoopA}
                             className={cn(
                                 "px-3 py-1.5 text-xs font-medium rounded transition-colors",
                                 loopStart !== null ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                             )}
                         >
                             {loopStart !== null ? `A: ${loopStart.toFixed(1)}s` : 'A地点設定'}
                         </button>

                         <button
                             onClick={handleSetLoopB}
                             disabled={loopStart === null}
                             className={cn(
                                 "px-3 py-1.5 text-xs font-medium rounded transition-colors",
                                 loopEnd !== null ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50",
                                 loopStart === null && "opacity-50 cursor-not-allowed"
                             )}
                         >
                             {loopEnd !== null ? `B: ${loopEnd.toFixed(1)}s` : 'B地点設定'}
                         </button>

                         {(loopStart !== null || loopEnd !== null) && (
                             <button
                                 onClick={clearLoop}
                                 className="px-2 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded"
                             >
                                 解除
                             </button>
                         )}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-100 p-4">
                <div className="max-w-4xl mx-auto space-y-3">
                    {chunks.map((chunk) => {
                        const isActive = currentChunkId === chunk.id;
                        return (
                            <div
                                key={chunk.id}
                                ref={isActive ? activeChunkRef : null}
                                className={cn(
                                    "bg-white rounded-lg p-4 border transition-all duration-300 shadow-sm",
                                    isActive
                                        ? "border-blue-500 ring-2 ring-blue-100 shadow-md"
                                        : "border-gray-200 hover:border-gray-300"
                                )}
                            >
                                <div className="flex gap-4">
                                    <button
                                        onClick={() => handleChunkClick(chunk.start_time)}
                                        className={cn(
                                            "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors mt-1",
                                            isActive
                                                ? "bg-blue-600 text-white"
                                                : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                                        )}
                                    >
                                        <Play size={14} fill="currentColor" className="ml-0.5" />
                                    </button>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                                                    {new Date(chunk.start_time * 1000).toISOString().substr(14, 5)}
                                                </span>
                                                <h3 className={cn("font-medium", isActive ? "text-blue-900" : "text-gray-900")}>
                                                    {chunk.title}
                                                </h3>
                                            </div>
                                            <button
                                                onClick={(e) => handleBookmark(e, chunk.id)}
                                                className={cn(
                                                    "text-gray-300 hover:text-yellow-500 transition-colors",
                                                    chunk.is_bookmarked && "text-yellow-500"
                                                )}
                                            >
                                                <Bookmark size={18} fill={chunk.is_bookmarked ? "currentColor" : "none"} />
                                            </button>
                                        </div>

                                        <p className="text-gray-800 text-sm leading-relaxed mb-3">
                                            {chunk.transcript}
                                        </p>

                                        <div className="bg-gray-50 rounded-md p-2 border border-gray-100 focus-within:border-blue-200 focus-within:ring-1 focus-within:ring-blue-100 transition-all">
                                            <textarea
                                                value={noteDrafts[chunk.id] || ''}
                                                onChange={(e) => handleNoteChange(chunk.id, e.target.value)}
                                                placeholder="Take notes..."
                                                className="w-full bg-transparent border-none text-sm focus:ring-0 p-0 resize-none min-h-[40px] text-gray-600 placeholder-gray-400"
                                            />
                                            <div className="flex justify-end h-4">
                                                <span className="text-[10px] text-blue-500 font-medium">
                                                    {savingStatus[chunk.id] === 'saving' && 'Saving...'}
                                                    {savingStatus[chunk.id] === 'saved' && 'Saved'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default DetailView;
